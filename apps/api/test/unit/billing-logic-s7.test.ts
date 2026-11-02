import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTAS, FEATURE_GATES, GATE_KEYS, evaluateGate, type GateKey } from '@allingo/schemas';
import { PLANS } from '@allingo/db/seed';
import { replayLots, remainingFor, type LedgerLike } from '../../src/modules/billing/credit-lots.js';
import { evaluateFlag } from '../../src/modules/billing/feature-flags.service.js';
import { discountFor, evaluatePromotion, normalizePromoCode, type PromotionRow } from '../../src/modules/billing/pricing.js';
import { diffReconciliation, mismatchesToCsv, parseStatementCsv, type ReconRow } from '../../src/modules/billing/reconciliation.js';
import { addDays, creditWindowCount, dueCreditWindows, reminderThreshold } from '../../src/modules/billing/subscription-periods.js';

const NOW = new Date('2026-11-02T05:00:00Z');
const promo = (over: Partial<PromotionRow> = {}): PromotionRow => ({ id: 'p1', code: 'WELCOME10', kind: 'percent', value: 10, planIds: null, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2027-01-01T00:00:00Z'), maxUses: 100, usedCount: 0, perUserLimit: 1, isActive: true, ...over });

describe('tính giá & khuyến mãi (server-side)', () => {
  it('percent làm tròn xuống đồng, amount không vượt subtotal', () => {
    expect(discountFor({ kind: 'percent', value: 10 }, 199_000)).toBe(19_900);
    expect(discountFor({ kind: 'percent', value: 33 }, 199_999)).toBe(65_999);
    expect(discountFor({ kind: 'amount', value: 50_000 }, 30_000)).toBe(30_000);
    expect(discountFor({ kind: 'percent', value: 250 }, 1000)).toBe(1000);
    expect(normalizePromoCode(' welcome 10 ')).toBe('WELCOME10');
  });

  it('mã hợp lệ → tổng sau giảm; lý do từ chối theo thứ tự: not_found, inactive, not_started, expired, plan_not_eligible, max_uses_reached, per_user_limit_reached, below_minimum', () => {
    const ctx = { planId: 'plan-a', subtotal: 199_000, now: NOW, userPaidUses: 0 };
    expect(evaluatePromotion(promo(), ctx)).toEqual({ ok: true, computation: { subtotal: 199_000, discount: 19_900, total: 179_100 } });
    const reason = (p: PromotionRow | null, c = ctx) => {
      const r = evaluatePromotion(p, c);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason(null)).toBe('not_found');
    expect(reason(promo({ isActive: false }))).toBe('inactive');
    expect(reason(promo({ validFrom: new Date('2027-01-01T00:00:00Z'), validTo: new Date('2028-01-01T00:00:00Z') }))).toBe('not_started');
    expect(reason(promo({ validTo: new Date('2026-11-01T00:00:00Z') }))).toBe('expired');
    expect(reason(promo({ planIds: ['plan-b'] }))).toBe('plan_not_eligible');
    expect(reason(promo({ maxUses: 5, usedCount: 5 }))).toBe('max_uses_reached');
    expect(reason(promo(), { ...ctx, userPaidUses: 1 })).toBe('per_user_limit_reached');
    expect(reason(promo({ kind: 'amount', value: 195_000 }))).toBe('below_minimum');
    // từ chối → tổng giữ nguyên subtotal
    expect(evaluatePromotion(null, ctx).computation).toEqual({ subtotal: 199_000, discount: 0, total: 199_000 });
  });
});

const L = (id: number, delta: number, reason: string, extra: Partial<LedgerLike> = {}): LedgerLike => ({ id, delta, reason, refType: null, refId: null, expiresAt: null, createdAt: new Date(Date.UTC(2026, 0, id)), ...extra });

describe('credit theo lô (FIFO theo hạn)', () => {
  it('tiêu lô sắp hết hạn trước: gói 1000 (12 tháng) + free 300, tiêu 200 → gói còn 800; tiêu 1100 → gói 0, free 200', () => {
    const pack = { refType: 'order', refId: 'o1', expiresAt: new Date('2027-01-01T00:00:00Z') };
    const base = [L(1, 300, 'subscription_grant'), L(2, 1000, 'purchase', pack)];
    expect(remainingFor([...base, L(3, -200, 'consume')], { refType: 'order', refId: 'o1' })).toBe(800);
    const lots = replayLots([...base, L(3, -1100, 'consume')]);
    expect(lots.map((l) => l.remaining)).toEqual([200, 0]);
  });

  it('lô đã quá hạn chỉ bị tiêu khi lô còn hạn cạn; dòng expire/refund trừ đúng lô tham chiếu', () => {
    const pack = { refType: 'order', refId: 'o1', expiresAt: new Date(Date.UTC(2026, 0, 3)) };
    const rows = [L(1, 1000, 'purchase', pack), L(2, 100, 'promo'), L(5, -150, 'consume')];
    // ngày 5: pack đã hết hạn (ngày 3) → tiêu promo 100 trước, 50 còn lại từ pack (số dư vẫn tính pack)
    expect(remainingFor(rows, { refType: 'order', refId: 'o1' })).toBe(950);
    expect(remainingFor([...rows, L(6, -950, 'expire', { refType: 'order', refId: 'o1' })], { refType: 'order', refId: 'o1' })).toBe(0);
    // hoàn tiền đơn: trừ vào lô của đơn, không đụng lô khác
    const r2 = replayLots([L(1, 300, 'subscription_grant'), L(2, 1000, 'purchase', { refType: 'order', refId: 'o2', expiresAt: null }), L(3, -1000, 'refund', { refType: 'order', refId: 'o2' })]);
    expect(r2.map((l) => l.remaining)).toEqual([300, 0]);
  });
});

describe('kỳ subscription & credit tháng', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  it('số kỳ credit: 30 ngày → 1, 60 → 2, 365 → 12, 395 → 13, lifetime → 1', () => {
    expect(creditWindowCount(start, addDays(start, 30))).toBe(1);
    expect(creditWindowCount(start, addDays(start, 60))).toBe(2);
    expect(creditWindowCount(start, addDays(start, 365))).toBe(12);
    expect(creditWindowCount(start, addDays(start, 395))).toBe(13);
    expect(creditWindowCount(start, null)).toBe(1);
  });
  it('kỳ đến hạn theo thời gian: chưa bắt đầu 0, ngày 0 → 1, ngày 30 → 2, sau kết thúc → đủ 12', () => {
    const end = addDays(start, 365);
    expect(dueCreditWindows(start, end, addDays(start, -1))).toBe(0);
    expect(dueCreditWindows(start, end, start)).toBe(1);
    expect(dueCreditWindows(start, end, addDays(start, 29.9))).toBe(1);
    expect(dueCreditWindows(start, end, addDays(start, 30))).toBe(2);
    expect(dueCreditWindows(start, end, addDays(start, 400))).toBe(12);
  });
  it('mốc nhắc 7/3/1 ngày: chọn mốc nhỏ nhất đã tới; > 7 ngày hoặc đã hết hạn → null', () => {
    const end = addDays(NOW, 10);
    expect(reminderThreshold(end, NOW)).toBeNull();
    expect(reminderThreshold(end, addDays(NOW, 3.5))).toBe(7);
    expect(reminderThreshold(end, addDays(NOW, 7.5))).toBe(3);
    expect(reminderThreshold(end, addDays(NOW, 9.5))).toBe(1);
    expect(reminderThreshold(end, addDays(NOW, 11))).toBeNull();
  });
});

describe('đối soát (thuần)', () => {
  const sys: ReconRow[] = Array.from({ length: 20 }, (_, i) => ({ provider_txn_id: `T${1000 + i}`, merchant_ref: `ref${i}`, order_id: `o${i}`, amount: 199_000 + i * 1000, status: 'success' as const }));
  const csvOf = (rows: ReconRow[]) => ['provider_txn_id,merchant_ref,amount,currency,status,paid_at', ...rows.map((r) => `${r.provider_txn_id},${r.merchant_ref},${r.amount},VND,${r.status},2026-11-01T10:00:00+07:00`)].join('\n');

  it('20 giao dịch khớp → 0 lệch, tổng bằng nhau', () => {
    const d = diffReconciliation(sys, parseStatementCsv(csvOf(sys)));
    expect(d.mismatches).toEqual([]);
    expect(d.matched).toBe(20);
    expect(d.expectedTotal).toBe(d.actualTotal);
  });

  it('1 lệch số tiền + 1 thiếu trong sao kê + 1 thừa trong sao kê + 1 khác trạng thái → báo đúng loại; CSV báo cáo', () => {
    const st = sys.slice(1).map((r) => ({ ...r }));
    st[0]!.amount += 1; // T1001 lệch tiền
    st[1]!.status = 'refunded'; // T1002 khác trạng thái
    st.push({ provider_txn_id: 'T9999', merchant_ref: 'ghost', amount: 50_000, status: 'success' });
    const d = diffReconciliation(sys, parseStatementCsv(csvOf(st)));
    expect(d.mismatches.map((m) => `${m.type}:${m.provider_txn_id}`).sort()).toEqual(['amount_mismatch:T1001', 'missing_in_statement:T1000', 'missing_in_system:T9999', 'status_mismatch:T1002']);
    expect(d.matched).toBe(17);
    const csv = mismatchesToCsv(d.mismatches);
    expect(csv.split('\n')[0]).toBe('type,provider_txn_id,merchant_ref,order_id,system_amount,statement_amount,system_status,statement_status');
    expect(csv).toContain('amount_mismatch,T1001,ref1,o1,200000,200001,success,success');
  });

  it('CSV: bí danh cột theo cổng, dấu ; , ô có ngoặc kép, trạng thái tiếng Việt, tiền tố app_trans_id ZaloPay', () => {
    const rows = parseStatementCsv('vnp_TransactionNo;vnp_TxnRef;vnp_Amount_vnd;trang_thai\n14226112;abc;"199000";Thành công\n14226113;def;10000;failed', {});
    expect(rows).toEqual([
      { provider_txn_id: '14226112', merchant_ref: 'abc', amount: 199_000, status: 'success' },
      { provider_txn_id: '14226113', merchant_ref: 'def', amount: 10_000, status: 'failed' },
    ]);
    expect(parseStatementCsv('zp_trans_id,app_trans_id,amount\n1,261101_xyz,1000', { stripAppTransPrefix: true })[0]!.merchant_ref).toBe('xyz');
    expect(() => parseStatementCsv('foo,bar\n1,2')).toThrow(/header/);
  });
});

describe('feature flag', () => {
  it('tắt → chỉ tester trong user_ids; bật + plan_kinds/programs/percent', () => {
    expect(evaluateFlag(null, {}, true)).toBe(true);
    expect(evaluateFlag({ enabled: false, rules: { user_ids: ['u1'] } }, { userId: 'u1' }, true)).toBe(true);
    expect(evaluateFlag({ enabled: false, rules: {} }, { userId: 'u2' }, true)).toBe(false);
    expect(evaluateFlag({ enabled: true, rules: { plan_kinds: ['monthly'] } }, { userId: 'u', planKind: 'free' }, true)).toBe(false);
    expect(evaluateFlag({ enabled: true, rules: { programs: ['toeic'] } }, { userId: 'u', program: 'toeic' }, true)).toBe(true);
    expect(evaluateFlag({ enabled: true, rules: { percent: 0 } }, { userId: 'u' }, true)).toBe(false);
    expect(evaluateFlag({ enabled: true, rules: { percent: 100 } }, { userId: 'u' }, true)).toBe(true);
  });
});

/**
 * Ma trận plan × feature (thuần, theo seed PLANS + DEFAULT_QUOTAS): Free / Pro tháng / Pro năm / trọn đời / hết hạn (= Free).
 * Bản tích hợp với DB/Redis ở test/integration/billing-s7.test.ts.
 */
describe('ma trận gating plan × feature (seed)', () => {
  const featuresOf = (code: string) => new Set(Object.entries(PLANS.find((p) => p.code === code)!.features).filter(([, v]) => v).map(([k]) => k));
  const limitOf = (kind: string, f: string | null) => DEFAULT_QUOTAS.find((q) => q.plan_kind === kind && q.feature === f)?.limit ?? null;
  const plans: Array<[string, string, string]> = [
    ['free', 'free', 'free'],
    ['pro_monthly', 'toeic_pro_monthly', 'monthly'],
    ['pro_yearly', 'toeic_pro_yearly', 'yearly'],
    ['lifetime', 'toeic_pro_lifetime', 'lifetime'],
    ['expired_pro', 'free', 'free'],
  ];
  const decide = (planCode: string, kind: string, gate: GateKey, used: number) => {
    const g = FEATURE_GATES[gate];
    return evaluateGate(g, { features: featuresOf(planCode), quota: g.quota ? { limit: limitOf(kind, g.quota), used } : null }).reason;
  };

  it.each(plans)('%s: đề full lần 3/tháng, chẩn đoán AI, chấm Writing, giải thích lần 11/ngày', (label, code, kind) => {
    const pro = label !== 'free' && label !== 'expired_pro';
    expect(decide(code, kind, 'full_test', 2)).toBe(pro ? 'ok' : 'quota_exceeded');
    expect(decide(code, kind, 'full_test', 1)).toBe('ok');
    expect(decide(code, kind, 'ai_diagnose', 0)).toBe(pro ? 'ok' : 'upgrade_required');
    expect(decide(code, kind, 'grade_writing', 0)).toBe(pro ? 'ok' : 'upgrade_required');
    expect(decide(code, kind, 'ai_explain', 10)).toBe(pro ? 'ok' : 'quota_exceeded');
    expect(decide(code, kind, 'notes', 0)).toBe('ok');
  });

  it('mọi gate đều quyết định được cho mọi gói (không ném lỗi)', () => {
    for (const [, code, kind] of plans) for (const g of GATE_KEYS) expect(['ok', 'upgrade_required', 'quota_exceeded']).toContain(decide(code, kind, g, 0));
  });
});
