import { describe, expect, it } from 'vitest';
import { buyerInfoSchema, normalizeVnTaxCode, REFERRAL_DEFAULTS, NOTIFICATION_TEMPLATE_CODES } from '@allingo/schemas';
import { buildSimplePdf, isStructurallyValidPdf } from '../../src/modules/billing/invoices/minimal-pdf.js';
import { EInvoiceError, splitVat, stripVietnamese, vndInWords, type InvoiceHttpClient, type InvoiceIssueInput } from '../../src/modules/billing/invoices/einvoice-provider.js';
import { MisaMeInvoiceProvider } from '../../src/modules/billing/invoices/misa.provider.js';
import { MockEInvoiceProvider } from '../../src/modules/billing/invoices/mock.provider.js';
import { ViettelSInvoiceProvider } from '../../src/modules/billing/invoices/viettel.provider.js';
import { evaluatePromotion, isNewUser, type PromotionRow } from '../../src/modules/billing/pricing.js';
import { freeMonthlyRefId } from '../../src/modules/billing/free-credits.service.js';
import { vnMonth, vnMonthRange } from '../../src/modules/billing/payments/crypto.js';
import { detectReferralAbuse, isRetryableSkip, maskName, referralRewardDecision, resolveReferralConfig } from '../../src/modules/growth/referral/referral-rules.js';
import { decideDelivery, inQuietHours, makeUnsubscribeToken, quietHoursEnd, renderNotification, verifyUnsubscribeToken, type DeliveryPrefs } from '../../src/modules/growth/notify/renderer.js';
import { NOTIFICATION_TEMPLATES } from '../../src/modules/growth/notify/templates.js';
import { ResendEmailProvider } from '../../src/shared/notify/mailer.service.js';

const NOW = new Date('2026-11-02T05:00:00Z'); // 12:00 giờ VN

describe('S8 hoá đơn: MST, người mua, tiền bằng chữ, VAT, PDF', () => {
  it('MST VN 10/13 số có chữ số kiểm tra; chuẩn hoá khoảng trắng/dấu chấm/gạch', () => {
    expect(normalizeVnTaxCode('0100000003')).toBe('0100000003');
    expect(normalizeVnTaxCode('0300588569')).toBe('0300588569');
    expect(normalizeVnTaxCode('0100109106')).toBe('0100109106');
    expect(normalizeVnTaxCode(' 0100.109.106 ')).toBe('0100109106');
    expect(normalizeVnTaxCode('0100109106001')).toBe('0100109106-001');
    expect(normalizeVnTaxCode('0100109106-002')).toBe('0100109106-002');
    expect(normalizeVnTaxCode('0100109107')).toBeNull(); // sai chữ số kiểm tra
    expect(normalizeVnTaxCode('0100109106-000')).toBeNull();
    expect(normalizeVnTaxCode('123456789')).toBeNull();
    expect(normalizeVnTaxCode('01001091061')).toBeNull();
    expect(normalizeVnTaxCode('abc')).toBeNull();
  });

  it('buyer_info: doanh nghiệp bắt buộc MST hợp lệ + tên + địa chỉ; cá nhân không cần; type suy ra từ tax_code', () => {
    expect(buyerInfoSchema.safeParse({ name: 'An' }).data).toMatchObject({ type: 'personal' });
    const ok = buyerInfoSchema.safeParse({ tax_code: '0100109106001', company: 'Cty A', address: 'Hà Nội' });
    expect(ok.success && ok.data).toMatchObject({ type: 'business', tax_code: '0100109106-001' });
    const bad = buyerInfoSchema.safeParse({ type: 'business', tax_code: '0100109107' });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join('.')).sort()).toEqual(['address', 'company', 'tax_code']);
    expect(buyerInfoSchema.safeParse({ type: 'business', company: 'X', address: 'Y' }).success).toBe(false);
  });

  it('số tiền bằng chữ tiếng Việt (linh, mốt, lăm, tư, nghìn/triệu/tỷ)', () => {
    expect(vndInWords(0)).toBe('Không đồng');
    expect(vndInWords(199_000)).toBe('Một trăm chín mươi chín nghìn đồng');
    expect(vndInWords(1_490_000)).toBe('Một triệu bốn trăm chín mươi nghìn đồng');
    expect(vndInWords(2_005_000)).toBe('Hai triệu không trăm linh năm nghìn đồng');
    expect(vndInWords(21_015)).toBe('Hai mươi mốt nghìn không trăm mười lăm đồng');
    expect(vndInWords(24_000)).toBe('Hai mươi tư nghìn đồng');
    expect(vndInWords(1_000_000_000)).toBe('Một tỷ đồng');
    expect(vndInWords(159_200)).toBe('Một trăm năm mươi chín nghìn hai trăm đồng');
  });

  it('tách thuế từ giá đã gồm thuế: KCT/0 % không thuế; 8 %/10 % làm tròn đồng, cộng lại đúng tổng', () => {
    expect(splitVat(199_000, 'KCT')).toEqual({ totalWithoutVat: 199_000, vatAmount: 0 });
    expect(splitVat(199_000, '10')).toEqual({ totalWithoutVat: 180_909, vatAmount: 18_091 });
    const r = splitVat(1_490_000, '8');
    expect(r.totalWithoutVat + r.vatAmount).toBe(1_490_000);
    expect(stripVietnamese('Hoá đơn Đồng')).toBe('Hoa don Dong');
  });

  it('PDF tối thiểu: header/xref/offset đúng; mock provider phát hành (chống trùng refId), huỷ, lỗi giả lập', async () => {
    const pdf = buildSimplePdf([{ text: 'Hello (world)' }], { title: 'T' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(isStructurallyValidPdf(pdf)).toBe(true);
    expect(isStructurallyValidPdf(Buffer.from('%PDF-1.4 broken'))).toBe(false);
    const mock = new MockEInvoiceProvider({ name: 'Allingo', taxCode: '0100000003', address: 'HN' });
    const input: InvoiceIssueInput = { refId: 'order-1', issueDate: NOW, currency: 'VND', buyer: { type: 'personal', name: 'Nguyễn An', email: null, taxCode: null, company: null, address: null }, lines: [{ code: 'toeic_pro_monthly', name: 'Gói TOEIC Pro', unit: 'Gói', quantity: 1, unitPrice: 199_000, amountWithoutVat: 159_200, vatAmount: 0, amount: 159_200 }], subtotal: 199_000, discount: 39_800, vatRate: 'KCT', totalWithoutVat: 159_200, vatAmount: 0, total: 159_200, totalInWords: vndInWords(159_200), paymentMethod: 'TM/CK' };
    const a = await mock.issue(input);
    const b = await mock.issue(input);
    expect(b.invoiceNo).toBe(a.invoiceNo);
    expect(a).toMatchObject({ series: '1C26MAL', invoiceNo: '00000001' });
    expect(isStructurallyValidPdf(a.pdf!)).toBe(true);
    expect(a.pdf!.toString('latin1')).toContain('Nguyen An');
    await mock.cancel({ refId: 'order-1', providerRef: a.providerRef, series: a.series, invoiceNo: a.invoiceNo, issuedAt: NOW }, 'refund', NOW);
    expect((await mock.getStatus({ refId: 'order-1', providerRef: a.providerRef })).status).toBe('cancelled');
    expect((await mock.getPdf({ refId: 'order-1', providerRef: a.providerRef, series: null, invoiceNo: null, issuedAt: null })).toString('latin1')).toContain('HOA DON DA HUY');
    mock.failNext(1);
    await expect(mock.issue({ ...input, refId: 'order-2' })).rejects.toBeInstanceOf(EInvoiceError);
    expect((await mock.issue({ ...input, refId: 'order-2' })).invoiceNo).toBe('00000002');
  });

  it('MISA meInvoice (HTTP giả lập): token cache, InvoiceData đúng trường, TransactionID → mã tra cứu, PDF base64, lỗi 5xx/thiếu cấu hình', async () => {
    const calls: Array<{ url: string; body: unknown; auth?: string }> = [];
    const http: InvoiceHttpClient = async (url, init) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
      if (url.endsWith('/auth/token')) return { status: 200, text: async () => JSON.stringify({ Success: true, Data: 'tok-1' }) };
      if (url.endsWith('/invoice')) return { status: 200, text: async () => JSON.stringify({ success: true, data: JSON.stringify([{ RefID: 'o-1', TransactionID: 'TX123', InvNo: '00000042', InvSeries: '1C26TAA', ErrorCode: null }]) }) };
      if (url.includes('/invoice/download')) return { status: 200, text: async () => JSON.stringify({ Success: true, Data: JSON.stringify([{ TransactionID: 'TX123', Data: Buffer.from('%PDF-1.4 x').toString('base64') }]) }) };
      return { status: 503, text: async () => 'down' };
    };
    const p = new MisaMeInvoiceProvider({ baseUrl: 'https://testapi.meinvoice.vn/api/integration', appId: 'app', taxCode: '0100000003', username: 'u', password: 'p', series: '1C26TAA', signType: 2, timeoutMs: 1000 }, http);
    const input: InvoiceIssueInput = { refId: 'o-1', issueDate: NOW, currency: 'VND', buyer: { type: 'business', name: null, email: 'kt@cty.example', taxCode: '0100109106', company: 'Công ty A', address: 'Hà Nội' }, lines: [{ code: 'toeic_pro_yearly', name: 'Gói năm', unit: 'Gói', quantity: 1, unitPrice: 1_490_000, amountWithoutVat: 1_490_000, vatAmount: 0, amount: 1_490_000 }], subtotal: 1_490_000, discount: 0, vatRate: 'KCT', totalWithoutVat: 1_490_000, vatAmount: 0, total: 1_490_000, totalInWords: vndInWords(1_490_000), paymentMethod: 'TM/CK' };
    const r = await p.issue(input);
    expect(r).toMatchObject({ providerRef: 'TX123', invoiceNo: '00000042', series: '1C26TAA', lookupCode: 'TX123' });
    const data = (calls[1]!.body as { SignType: number; InvoiceData: Array<Record<string, unknown>> }).InvoiceData[0]!;
    expect(calls[1]!.auth).toBe('Bearer tok-1');
    expect(data).toMatchObject({ RefID: 'o-1', InvSeries: '1C26TAA', InvDate: '2026-11-02', BuyerTaxCode: '0100109106', BuyerLegalName: 'Công ty A', TotalAmountOC: 1_490_000, TotalAmountInWords: 'Một triệu bốn trăm chín mươi nghìn đồng' });
    expect((data.OriginalInvoiceDetail as Array<Record<string, unknown>>)[0]).toMatchObject({ ItemCode: 'toeic_pro_yearly', VATRateName: 'KCT', Quantity: 1 });
    expect((await p.getPdf({ refId: 'o-1', providerRef: 'TX123', series: null, invoiceNo: null, issuedAt: null })).toString()).toBe('%PDF-1.4 x');
    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
    await expect(p.getStatus({ refId: 'o-1', providerRef: 'TX123' })).rejects.toMatchObject({ providerCode: 'http_503', retryable: true });
    const unconfigured = new MisaMeInvoiceProvider({ baseUrl: 'x', series: 'S', signType: 2, timeoutMs: 1000 }, http);
    expect(unconfigured.available).toBe(false);
    await expect(unconfigured.issue(input)).rejects.toMatchObject({ providerCode: 'not_configured', retryable: false });
  });

  it('Viettel SInvoice là khung: ánh xạ createInvoice, mọi thao tác not_implemented', async () => {
    const v = new ViettelSInvoiceProvider({ baseUrl: 'https://api-vinvoice.viettel.vn', templateCode: '1/001', series: 'C26TAA' });
    expect(v.available).toBe(false);
    const body = ViettelSInvoiceProvider.createInvoiceBody({ refId: 'o', issueDate: NOW, currency: 'VND', buyer: { type: 'personal', name: 'A', email: null, taxCode: null, company: null, address: null }, lines: [], subtotal: 1, discount: 0, vatRate: 'KCT', totalWithoutVat: 1, vatAmount: 0, total: 1, totalInWords: 'x', paymentMethod: 'TM/CK' }, { templateCode: '1/001', series: 'C26TAA' });
    expect(body).toMatchObject({ generalInvoiceInfo: { templateCode: '1/001', invoiceSeries: 'C26TAA', transactionUuid: 'o' } });
    await expect(v.issue({} as InvoiceIssueInput)).rejects.toMatchObject({ providerCode: 'not_implemented' });
  });
});

const promo = (over: Partial<PromotionRow> = {}): PromotionRow => ({ id: 'p', code: 'X', kind: 'percent', value: 20, planIds: null, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2027-01-01T00:00:00Z'), maxUses: null, usedCount: 0, perUserLimit: 1, isActive: true, conditions: {}, ...over });

describe('S8 khuyến mãi: loại, điều kiện, ngữ cảnh', () => {
  const order = { mode: 'order' as const, planId: 'plan-m', planKind: 'monthly', planPrograms: ['toeic'], subtotal: 199_000, now: NOW, userPaidUses: 0, user: { createdAt: new Date(NOW.getTime() - 5 * 86_400_000), isGuest: false, paidOrders: 0 } };
  const reason = (p: PromotionRow, c: Partial<typeof order> & Record<string, unknown> = {}) => {
    const r = evaluatePromotion(p, { ...order, ...c });
    return r.ok ? 'ok' : r.reason;
  };

  it('WELCOME20: người dùng mới (≤ 30 ngày, chưa có đơn paid) được 20 %; đã mua/tài khoản cũ → new_users_only; lượt 2 → per_user_limit_reached', () => {
    const w = promo({ conditions: { new_users_only: true, new_user_max_days: 30, plan_kinds: ['monthly', 'yearly', 'lifetime', 'combo'] } });
    expect(evaluatePromotion(w, order)).toMatchObject({ ok: true, computation: { discount: 39_800, total: 159_200 } });
    expect(reason(w, { user: { createdAt: order.user.createdAt, isGuest: false, paidOrders: 1 } })).toBe('new_users_only');
    expect(reason(w, { user: { createdAt: new Date(NOW.getTime() - 31 * 86_400_000), isGuest: false, paidOrders: 0 } })).toBe('new_users_only');
    expect(reason(w, { userPaidUses: 1 })).toBe('per_user_limit_reached');
    expect(reason(w, { planKind: 'credit_pack' })).toBe('plan_not_eligible');
    expect(isNewUser({ createdAt: new Date(NOW.getTime() - 30 * 86_400_000), paidOrders: 0 }, NOW)).toBe(true);
  });

  it('fixed (bí danh amount), chương trình, tổng tối thiểu, max_uses tính cả lượt đang giữ; khách bị từ chối', () => {
    expect(evaluatePromotion(promo({ kind: 'fixed', value: 50_000 }), order)).toMatchObject({ ok: true, computation: { discount: 50_000, total: 149_000 } });
    expect(evaluatePromotion(promo({ kind: 'amount', value: 50_000 }), order)).toMatchObject({ ok: true, computation: { discount: 50_000 } });
    expect(reason(promo({ conditions: { program_codes: ['ielts'] } }))).toBe('program_not_eligible');
    expect(reason(promo({ conditions: { min_subtotal: 500_000 } }))).toBe('min_subtotal_not_met');
    expect(reason(promo({ maxUses: 3, usedCount: 2 }), { activeReservations: 1 })).toBe('max_uses_reached');
    expect(reason(promo({ maxUses: 3, usedCount: 2 }), { activeReservations: 0 })).toBe('ok');
    expect(reason(promo(), { user: { createdAt: NOW, isGuest: true, paidOrders: 0 } })).toBe('guest_account');
  });

  it('credit_bonus theo đơn (không giảm tiền) / standalone; trial_days chỉ đổi mã; mã đơn ở redeem → requires_order', () => {
    expect(evaluatePromotion(promo({ kind: 'credit_bonus', value: 500, conditions: { plan_kinds: ['yearly'] } }), { ...order, planKind: 'yearly' })).toMatchObject({ ok: true, appliesTo: 'order', computation: { discount: 0, total: 199_000, bonusCredits: 500 } });
    const gift = promo({ kind: 'credit_bonus', value: 200, conditions: { standalone: true } });
    expect(reason(gift)).toBe('requires_redeem');
    expect(evaluatePromotion(gift, { mode: 'redeem', planId: null, subtotal: 0, now: NOW, userPaidUses: 0 })).toMatchObject({ ok: true, appliesTo: 'redeem', computation: { bonusCredits: 200 } });
    const trial = promo({ kind: 'trial_days', value: 7, conditions: { program_codes: ['toeic', 'ielts'] } });
    expect(reason(trial)).toBe('requires_redeem');
    const redeem = { mode: 'redeem' as const, planId: null, subtotal: 0, now: NOW, userPaidUses: 0, program: 'toeic' };
    expect(evaluatePromotion(trial, redeem)).toMatchObject({ ok: true, computation: { trialDays: 7 } });
    expect(evaluatePromotion(trial, { ...redeem, trialUsed: true })).toMatchObject({ ok: false, reason: 'trial_already_used' });
    expect(evaluatePromotion(trial, { ...redeem, alreadyPro: true })).toMatchObject({ ok: false, reason: 'already_pro' });
    expect(evaluatePromotion(trial, { ...redeem, program: 'hsk' })).toMatchObject({ ok: false, reason: 'program_not_eligible' });
    expect(evaluatePromotion(promo(), { mode: 'redeem', planId: null, subtotal: 0, now: NOW, userPaidUses: 0 })).toMatchObject({ ok: false, reason: 'requires_order' });
    expect(evaluatePromotion(promo(), { mode: 'redeem', subtotal: 0, now: NOW, userPaidUses: 0 })).toMatchObject({ ok: false, reason: 'plan_required' });
  });
});

describe('S8 referral: chống lạm dụng, quyết định thưởng, cấu hình', () => {
  const cfg = REFERRAL_DEFAULTS;
  const base = { stage: 'started' as const, alreadyCredited: false, enabled: true, blockedReason: null, refereeVerified: true, referrerVerified: true, config: cfg, referrerRewardsThisMonth: 0 };

  it('cùng thiết bị/IP với người giới thiệu → self_referral; cùng fingerprint lượt khác → duplicate_device; cùng IP cùng người giới thiệu → duplicate_ip', () => {
    const signals = { fingerprints: ['fpA'], ips: ['10.0.0.1'] };
    expect(detectReferralAbuse({ refereeFp: 'fpA', refereeIp: '10.9.9.9', referrerSignals: signals, recentSameFp: 0, recentSameReferrerIp: 0 })).toBe('self_referral');
    expect(detectReferralAbuse({ refereeFp: 'fpB', refereeIp: '10.0.0.1', referrerSignals: signals, recentSameFp: 0, recentSameReferrerIp: 0 })).toBe('self_referral');
    expect(detectReferralAbuse({ refereeFp: 'fpB', refereeIp: '10.0.0.2', referrerSignals: signals, recentSameFp: 1, recentSameReferrerIp: 0 })).toBe('duplicate_device');
    expect(detectReferralAbuse({ refereeFp: 'fpB', refereeIp: '10.0.0.2', referrerSignals: signals, recentSameFp: 0, recentSameReferrerIp: 2 })).toBe('duplicate_ip');
    expect(detectReferralAbuse({ refereeFp: null, refereeIp: null, referrerSignals: signals, recentSameFp: 5, recentSameReferrerIp: 5 })).toBeNull();
  });

  it('thưởng 200/200 ở started, 500/500 ở upgraded; thứ 21 trong tháng (trần 20) → monthly_cap; chưa xác minh → email_unverified (thử lại được)', () => {
    expect(referralRewardDecision(base)).toEqual({ grant: true, referrer: 200, referee: 200 });
    expect(referralRewardDecision({ ...base, stage: 'upgraded' })).toEqual({ grant: true, referrer: 500, referee: 500 });
    expect(referralRewardDecision({ ...base, referrerRewardsThisMonth: 19 })).toMatchObject({ grant: true });
    expect(referralRewardDecision({ ...base, referrerRewardsThisMonth: 20 })).toEqual({ grant: false, reason: 'monthly_cap' });
    expect(referralRewardDecision({ ...base, refereeVerified: false })).toEqual({ grant: false, reason: 'email_unverified' });
    expect(referralRewardDecision({ ...base, blockedReason: 'duplicate_device' })).toEqual({ grant: false, reason: 'blocked' });
    expect(referralRewardDecision({ ...base, enabled: false })).toEqual({ grant: false, reason: 'disabled' });
    expect(referralRewardDecision({ ...base, alreadyCredited: true })).toEqual({ grant: false, reason: 'already_credited' });
    expect(isRetryableSkip('email_unverified')).toBe(true);
    expect(isRetryableSkip('monthly_cap')).toBe(false);
  });

  it('cấu hình gộp với mặc định, giá trị sai kiểu → mặc định; che tên', () => {
    expect(resolveReferralConfig({ monthly_cap: 3 })).toMatchObject({ monthly_cap: 3, rewards: cfg.rewards });
    expect(resolveReferralConfig({ rewards: { started: { referrer: 50 } } }).rewards.started).toEqual({ referrer: 50, referee: 200 });
    expect(resolveReferralConfig({ monthly_cap: -1 })).toEqual(cfg);
    expect(resolveReferralConfig(undefined)).toEqual(cfg);
    expect(maskName('Nguyễn Văn A')).toBe('Ng***');
    expect(maskName('')).toBe('***');
  });
});

describe('S8 thông báo: chính sách giao, giờ yên lặng, mẫu i18n, token huỷ đăng ký', () => {
  const prefs: DeliveryPrefs = { channels: { email: true, push: true, inapp: true }, categories: { learning: { email: true, push: true, inapp: true }, billing: { email: true, push: true, inapp: true }, marketing: { email: true, push: false, inapp: true } }, quiet_hours: { start: '22:00', end: '07:00' } };
  const counts = { marketingEmails7d: 0, pushesToday: 0 };
  const at = (hhmmVn: string) => new Date(`2026-11-02T${hhmmVn}:00+07:00`);
  const decide = (o: Partial<Parameters<typeof decideDelivery>[0]>) => decideDelivery({ channel: 'push', category: 'learning', transactional: false, quietPolicy: 'skip', prefs, counts, now: at('12:00'), ...o });

  it('giờ yên lặng 22:00–07:00 VN qua nửa đêm; kết thúc kế tiếp lúc 07:00', () => {
    expect(inQuietHours(at('23:30'), prefs.quiet_hours)).toBe(true);
    expect(inQuietHours(at('06:59'), prefs.quiet_hours)).toBe(true);
    expect(inQuietHours(at('07:00'), prefs.quiet_hours)).toBe(false);
    expect(inQuietHours(at('12:00'), { start: '12:00', end: '13:00' })).toBe(true);
    expect(quietHoursEnd(at('23:30'), prefs.quiet_hours).toISOString()).toBe(new Date('2026-11-03T07:00:00+07:00').toISOString());
  });

  it('push nhắc học trong giờ yên lặng → skip; thông báo billing → defer tới 07:00; giao dịch ignore', () => {
    expect(decide({ now: at('23:00') })).toEqual({ action: 'skip', reason: 'quiet_hours' });
    expect(decide({ now: at('23:00'), quietPolicy: 'defer', category: 'billing' })).toMatchObject({ action: 'defer', reason: 'quiet_hours' });
    expect(decide({ now: at('23:00'), quietPolicy: 'ignore', transactional: true, category: 'billing' })).toEqual({ action: 'send' });
    expect(decide({})).toEqual({ action: 'send' });
  });

  it('tần suất: ≤ 2 push không giao dịch/ngày, ≤ 1 email marketing/tuần; loại/kênh tắt; email giao dịch bỏ qua tuỳ chọn', () => {
    expect(decide({ counts: { marketingEmails7d: 0, pushesToday: 2 } })).toEqual({ action: 'skip', reason: 'rate_limited' });
    expect(decide({ counts: { marketingEmails7d: 0, pushesToday: 2 }, transactional: true })).toEqual({ action: 'send' });
    expect(decide({ channel: 'email', category: 'marketing', counts: { marketingEmails7d: 1, pushesToday: 0 } })).toEqual({ action: 'skip', reason: 'rate_limited' });
    expect(decide({ channel: 'email', category: 'learning', counts: { marketingEmails7d: 5, pushesToday: 0 } })).toEqual({ action: 'send' });
    const off = { ...prefs, categories: { ...prefs.categories, marketing: { email: false, push: false, inapp: true } } };
    expect(decide({ channel: 'email', category: 'marketing', prefs: off })).toEqual({ action: 'skip', reason: 'category_disabled' });
    expect(decide({ channel: 'push', category: 'learning', prefs: { ...prefs, channels: { push: false } } })).toEqual({ action: 'skip', reason: 'channel_disabled' });
    expect(decide({ channel: 'email', category: 'billing', transactional: true, prefs: { ...prefs, channels: { email: false }, categories: { ...prefs.categories, billing: { email: false, push: false, inapp: false } } } })).toEqual({ action: 'send' });
    expect(decide({ force: true, prefs: { ...prefs, channels: { push: false } } })).toEqual({ action: 'send' });
  });

  it('mọi mẫu dựng được vi + en (HTML + plain-text + push + in-app), không còn biến chưa thay; link huỷ đăng ký chỉ email không giao dịch', () => {
    const data = { order_id: 'o-1', plan_name: { vi: 'TOEIC Pro – Tháng', en: 'TOEIC Pro – Monthly' }, total: 199_000, credits_granted: 5000, bonus_credits: 500, invoice_no: '00000001', series: '1C26MAL', lookup_code: 'ABC', lookup_url: 'https://x.example', period_end: '2026-11-09T10:00:00Z', days_before: 3, trial_days: 7, credits: 200, stage: 'started', is_referrer: true, minutes: 15, streak: 4, attempts: 3, xp: 120, op: 'issue', attempts_n: 6, error_code: 'mock_unavailable' };
    const links = { appUrl: 'https://app.allingo.vn', manageUrl: 'https://app.allingo.vn/notifications/manage?token=t', unsubscribeUrl: 'https://api.allingo.vn/v1/notifications/unsubscribe?token=u' };
    expect(Object.keys(NOTIFICATION_TEMPLATES).sort()).toEqual([...NOTIFICATION_TEMPLATE_CODES].sort());
    for (const def of Object.values(NOTIFICATION_TEMPLATES)) {
      for (const loc of ['vi', 'en', 'ja']) {
        const r = renderNotification(def, loc, data, links);
        expect(r.locale).toBe(loc === 'vi' ? 'vi' : 'en');
        for (const part of [r.subject, r.html, r.text, r.push.title, r.push.body, r.inapp.title, r.inapp.body]) {
          expect(part.length).toBeGreaterThan(0);
          expect(part).not.toMatch(/\{\{|\[object Object\]/);
        }
        expect(r.html).toContain('<!doctype html>');
        expect(r.text).not.toMatch(/<[a-z]+[ >]/i);
        expect(r.html.includes('notifications/unsubscribe')).toBe(!def.transactional);
      }
    }
    const vi = renderNotification(NOTIFICATION_TEMPLATES['billing.order_paid'], 'vi', data, links);
    expect(vi.subject).toBe('Thanh toán thành công – TOEIC Pro – Tháng');
    expect(vi.text).toContain('199.000 ₫');
    expect(vi.url).toBe('/account/orders/o-1');
    const en = renderNotification(NOTIFICATION_TEMPLATES['billing.subscription_expiring'], 'en', data, links);
    expect(en.subject).toBe('TOEIC Pro – Monthly expires in 3 days');
    // HTML escape dữ liệu người dùng trong email HTML
    const xss = renderNotification(NOTIFICATION_TEMPLATES['billing.invoice_issued'], 'vi', { ...data, company: '<script>x</script>' }, links);
    expect(xss.html).not.toContain('<script>x</script>');
  });

  it('token huỷ đăng ký ký HMAC: xác minh đúng, sửa scope/người dùng/chữ ký → null', () => {
    const uid = '7d8f6c2e-1b4a-4c3d-9e8f-0a1b2c3d4e5f';
    const t = makeUnsubscribeToken('secret', uid, 'marketing');
    expect(verifyUnsubscribeToken('secret', t)).toEqual({ userId: uid, scope: 'marketing' });
    expect(verifyUnsubscribeToken('other', t)).toBeNull();
    expect(verifyUnsubscribeToken('secret', t.replace('.marketing.', '.all.'))).toBeNull();
    expect(verifyUnsubscribeToken('secret', `${t}x`)).toBeNull();
    expect(verifyUnsubscribeToken('secret', 'v1.abc.all')).toBeNull();
  });

  it('Resend: thân request có text/html, header List-Unsubscribe, đính kèm base64, tag không PII', () => {
    const body = ResendEmailProvider.body({ to: 'a@example.com', subject: 'S', text: 'T', html: '<p>H</p>', headers: { 'List-Unsubscribe': '<https://u>' }, attachments: [{ filename: 'hd.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' }], tags: { template: 'billing.order_paid' } }, 'Allingo <no-reply@allingo.vn>');
    expect(body).toMatchObject({ to: ['a@example.com'], text: 'T', html: '<p>H</p>', headers: { 'List-Unsubscribe': '<https://u>' }, attachments: [{ filename: 'hd.pdf', content: Buffer.from('%PDF').toString('base64') }], tags: [{ name: 'template', value: 'billing_order_paid' }] });
  });
});

describe('S8 Free credit tháng: kỳ VN', () => {
  it('kỳ tháng lịch VN, ref_id ổn định dạng uuid', () => {
    expect(vnMonth(new Date('2026-11-30T17:30:00Z'))).toBe('2026-12');
    expect(vnMonthRange('2026-12')).toEqual({ start: new Date('2026-12-01T00:00:00+07:00'), end: new Date('2027-01-01T00:00:00+07:00') });
    expect(freeMonthlyRefId('2026-12')).toBe(freeMonthlyRefId('2026-12'));
    expect(freeMonthlyRefId('2026-12')).not.toBe(freeMonthlyRefId('2027-01'));
    expect(freeMonthlyRefId('2026-12')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
