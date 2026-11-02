import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTAS, FEATURE_CODES, FEATURE_GATES, GATE_KEYS, PRO_ONLY_FEATURES, SCOPED_QUOTA_FEATURES, evaluateGate, gateForTestSetKind, orderCreateInputSchema, payInputSchema } from '../src/index.js';

/** Sprint 7 – bảng gating packages/config/entitlements.ts (bundle qua @allingo/schemas) */
describe('FEATURE_GATES (packages/config/entitlements.ts)', () => {
  const codes = new Set<string>(Object.values(FEATURE_CODES));

  it('mọi entitlement/quota/scopedQuota của gate là FEATURE_CODES hợp lệ; mọi gate có endpoint', () => {
    for (const key of GATE_KEYS) {
      const g = FEATURE_GATES[key] as { entitlement: string | null; quota: string | null; scopedQuota?: string; endpoints: readonly string[] };
      if (g.entitlement) expect(codes.has(g.entitlement), `${key}.entitlement`).toBe(true);
      if (g.quota) expect(codes.has(g.quota), `${key}.quota`).toBe(true);
      if (g.scopedQuota) expect(SCOPED_QUOTA_FEATURES).toContain(g.scopedQuota);
      expect(g.endpoints.length, key).toBeGreaterThan(0);
    }
  });

  it('mọi quota seed (trừ quota theo phạm vi) thuộc một gate; tính năng chỉ-Pro đều có gate cần entitlement', () => {
    const gateQuotas = new Set<string>(GATE_KEYS.map((k) => FEATURE_GATES[k].quota).filter((x): x is NonNullable<typeof x> => !!x));
    for (const q of DEFAULT_QUOTAS) if (!SCOPED_QUOTA_FEATURES.includes(q.feature)) expect(gateQuotas.has(q.feature), q.feature).toBe(true);
    const gateEnts = new Set<string>(GATE_KEYS.map((k) => FEATURE_GATES[k].entitlement).filter((x): x is NonNullable<typeof x> => !!x));
    for (const f of PRO_ONLY_FEATURES.filter((x) => x !== 'streak_freeze')) expect(gateEnts.has(f), f).toBe(true);
  });

  it('gateForTestSetKind: full → full_test, part_drill → part_drill, còn lại → mini_test', () => {
    expect(gateForTestSetKind('full')).toBe('full_test');
    expect(gateForTestSetKind('part_drill')).toBe('part_drill');
    expect(gateForTestSetKind('mini')).toBe('mini_test');
    expect(gateForTestSetKind('diagnostic')).toBe('mini_test');
  });

  it('evaluateGate: thiếu quyền → 403; nội dung miễn phí bỏ qua quyền nhưng vẫn tính quota → 429; không giới hạn → cho phép', () => {
    const none = new Set<string>();
    expect(evaluateGate(FEATURE_GATES.ai_diagnose, { features: none })).toMatchObject({ allowed: false, status: 403, code: 'forbidden' });
    expect(evaluateGate(FEATURE_GATES.full_test, { features: none, contentIsFree: true, quota: { limit: 2, used: 1 } })).toEqual({ allowed: true, reason: 'ok' });
    expect(evaluateGate(FEATURE_GATES.full_test, { features: none, contentIsFree: true, quota: { limit: 2, used: 2 } })).toMatchObject({ allowed: false, status: 429 });
    expect(evaluateGate(FEATURE_GATES.full_test, { features: new Set(['full_test']), quota: null })).toEqual({ allowed: true, reason: 'ok' });
    expect(evaluateGate(FEATURE_GATES.notes, { features: none })).toEqual({ allowed: true, reason: 'ok' });
  });
});

describe('billing DTO', () => {
  it('POST /orders cần price_id hoặc plan_id; quantity = 1', () => {
    expect(orderCreateInputSchema.safeParse({}).success).toBe(false);
    expect(orderCreateInputSchema.safeParse({ price_id: crypto.randomUUID() }).success).toBe(true);
    expect(orderCreateInputSchema.safeParse({ plan_id: crypto.randomUUID(), quantity: 2 }).success).toBe(false);
  });
  it('POST /orders/{id}/pay: provider trong danh sách', () => {
    expect(payInputSchema.safeParse({ provider: 'vnpay' }).success).toBe(true);
    expect(payInputSchema.safeParse({ provider: 'stripe' }).success).toBe(true);
    expect(payInputSchema.safeParse({ provider: 'paypal' }).success).toBe(false);
  });
});
