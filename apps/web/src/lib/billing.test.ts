import { describe, expect, it } from 'vitest';
import { ApiError } from '@allingo/api-client';
import {
  EMPTY_BUYER,
  findPlanByPrice,
  formatVnd,
  groupPlans,
  isSettledOrderStatus,
  issuePaths,
  monthlyEquivalent,
  normalizeVnTaxCode,
  orderPollInterval,
  priceView,
  promotionReasonOf,
  safeNextPath,
  savingsPercent,
  validateBuyer,
} from './billing';
import { MOCK_PLANS } from '@/mock/billing-fixtures';

describe('MST (mã số thuế) – cùng thuật toán server', () => {
  it('nhận 10 số đúng chữ số kiểm tra, bỏ khoảng trắng/dấu chấm', () => {
    expect(normalizeVnTaxCode('0100109106')).toBe('0100109106');
    expect(normalizeVnTaxCode('0310303533')).toBe('0310303533');
    expect(normalizeVnTaxCode(' 0100.109.106 ')).toBe('0100109106');
  });
  it('nhận 13 số (chi nhánh), có hoặc không gạch nối → chuẩn hoá dạng 0123456789-001', () => {
    expect(normalizeVnTaxCode('0100109106-001')).toBe('0100109106-001');
    expect(normalizeVnTaxCode('0100109106001')).toBe('0100109106-001');
  });
  it('từ chối sai chữ số kiểm tra, sai độ dài, đuôi 000, chữ cái', () => {
    expect(normalizeVnTaxCode('0123456789')).toBeNull();
    expect(normalizeVnTaxCode('1234567890')).toBeNull();
    expect(normalizeVnTaxCode('010010910')).toBeNull();
    expect(normalizeVnTaxCode('0100109106-000')).toBeNull();
    expect(normalizeVnTaxCode('01001091O6')).toBeNull();
  });
});

describe('validateBuyer – thông tin hoá đơn (buyerInfoSchema của server)', () => {
  it('cá nhân: mọi trường tuỳ chọn; email sai → lỗi email', () => {
    expect(validateBuyer({ ...EMPTY_BUYER })).toEqual({ ok: true, value: { type: 'personal' } });
    const bad = validateBuyer({ ...EMPTY_BUYER, email: 'not-an-email' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.email).toBe('invalid_email');
  });
  it('doanh nghiệp: thiếu MST/công ty/địa chỉ → mã lỗi theo trường', () => {
    const r = validateBuyer({ ...EMPTY_BUYER, type: 'business' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ tax_code: 'tax_code_required', company: 'company_required', address: 'address_required' });
  });
  it('doanh nghiệp: MST sai chữ số kiểm tra → invalid_tax_code', () => {
    const r = validateBuyer({ ...EMPTY_BUYER, type: 'business', tax_code: '0123456789', company: 'Cty A', address: 'Hà Nội' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.tax_code).toBe('invalid_tax_code');
  });
  it('doanh nghiệp hợp lệ → body chuẩn hoá (MST 13 số có gạch nối, bỏ trường trống)', () => {
    const r = validateBuyer({ type: 'business', name: '', email: 'ketoan@cty.vn', tax_code: '0100109106001', company: ' Cty A ', address: 'Hà Nội' });
    expect(r).toEqual({ ok: true, value: { type: 'business', email: 'ketoan@cty.vn', tax_code: '0100109106-001', company: 'Cty A', address: 'Hà Nội' } });
  });
  it('cá nhân bỏ qua các trường doanh nghiệp đã nhập dở', () => {
    const r = validateBuyer({ ...EMPTY_BUYER, type: 'personal', tax_code: '123', company: 'X', name: 'Lan' });
    expect(r).toEqual({ ok: true, value: { type: 'personal', name: 'Lan' } });
  });
});

describe('giá hiển thị', () => {
  const yearly = { amount: 1_490_000, compare_at: 2_388_000 };
  it('compare_at cao hơn → gạch giá gốc + % tiết kiệm', () => {
    expect(priceView(yearly)).toEqual({ amount: 1_490_000, strike: 2_388_000, total: 1_490_000, discount: 0, savingsPct: 38, promoApplied: false });
    expect(priceView({ amount: 199_000, compare_at: null })).toMatchObject({ strike: null, savingsPct: null, total: 199_000 });
  });
  it('mã hợp lệ cho đúng giá → tổng do server tính, gạch giá niêm yết', () => {
    const promo = { valid: true, code: 'WELCOME20', reason: null, kind: 'percent' as const, value: 20, subtotal: 199_000, discount: 39_800, total: 159_200, currency: 'VND', applies_to: 'order' as const };
    expect(priceView({ amount: 199_000, compare_at: null }, promo)).toEqual({ amount: 199_000, strike: 199_000, total: 159_200, discount: 39_800, savingsPct: 20, promoApplied: true });
  });
  it('mã không hợp lệ / mã đổi trực tiếp / subtotal khác giá → bỏ qua mã', () => {
    const base = { code: 'X', kind: 'percent' as const, value: 20, currency: 'VND', discount: 1000, total: 198_000, subtotal: 199_000 };
    expect(priceView({ amount: 199_000, compare_at: null }, { ...base, valid: false, reason: 'expired' }).promoApplied).toBe(false);
    expect(priceView({ amount: 199_000, compare_at: null }, { ...base, valid: true, reason: null, applies_to: 'redeem' }).promoApplied).toBe(false);
    expect(priceView({ amount: 49_000, compare_at: null }, { ...base, valid: true, reason: null }).promoApplied).toBe(false);
  });
  it('savingsPercent / monthlyEquivalent / formatVnd', () => {
    expect(savingsPercent(2_490_000, 5_960_000)).toBe(58);
    expect(savingsPercent(100, 100)).toBeNull();
    expect(monthlyEquivalent(1_490_000, 365)).toBe(124_000);
    expect(monthlyEquivalent(199_000, 30)).toBeNull();
    expect(monthlyEquivalent(2_990_000, null)).toBeNull();
    expect(formatVnd(159_200, 'vi').replace(/\s/g, ' ')).toBe('159.200 ₫');
    expect(formatVnd(159_200, 'en')).toBe('₫159,200');
  });
});

describe('nhóm gói theo program', () => {
  it('Free + Pro tháng/năm/trọn đời của program + combo + gói credit (rẻ → đắt)', () => {
    const g = groupPlans(MOCK_PLANS, 'ielts');
    expect(g.free?.code).toBe('free');
    expect([g.monthly?.code, g.yearly?.code, g.lifetime?.code]).toEqual(['ielts_pro_monthly', 'ielts_pro_yearly', 'ielts_pro_lifetime']);
    expect(g.combo?.code).toBe('combo_all_yearly');
    expect(g.creditPacks.map((p) => p.code)).toEqual(['credits_1000', 'credits_5000']);
  });
  it('tìm gói theo price_id', () => {
    const p = MOCK_PLANS.find((x) => x.code === 'toeic_pro_monthly')!;
    expect(findPlanByPrice(MOCK_PLANS, p.price!.id)?.code).toBe('toeic_pro_monthly');
    expect(findPlanByPrice(MOCK_PLANS, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('lỗi API billing', () => {
  it('details.promotion.reason (400 POST /orders)', () => {
    const err = new ApiError(400, { error: { code: 'validation_failed', message: 'x', details: { promotion: { code: 'WELCOME20', reason: 'new_users_only' } } } });
    expect(promotionReasonOf(err)).toBe('new_users_only');
    expect(promotionReasonOf(new Error('x'))).toBeNull();
  });
  it('details.issues → đường dẫn trường', () => {
    const err = new ApiError(400, { error: { code: 'validation_failed', message: 'x', details: { issues: [{ path: 'buyer_info.tax_code', message: 'invalid', code: 'custom' }, { path: ['return_url'], code: 'return_url_not_allowed' }] } } });
    expect(issuePaths(err)).toEqual({ 'buyer_info.tax_code': 'custom', return_url: 'return_url_not_allowed' });
  });
});

describe('trạng thái đơn, polling, next', () => {
  it('trạng thái kết thúc (dừng polling)', () => {
    expect(isSettledOrderStatus('pending')).toBe(false);
    for (const s of ['paid', 'failed', 'expired', 'cancelled', 'refunded'] as const) expect(isSettledOrderStatus(s)).toBe(true);
  });
  it('nhịp polling 2 s → 5 s → 10 s', () => {
    expect(orderPollInterval(0)).toBe(2000);
    expect(orderPollInterval(45_000)).toBe(5000);
    expect(orderPollInterval(200_000)).toBe(10_000);
  });
  it('?next= chỉ nhận đường dẫn nội bộ', () => {
    expect(safeNextPath('/checkout?price_id=1')).toBe('/checkout?price_id=1');
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
