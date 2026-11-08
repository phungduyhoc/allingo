import { ApiError } from '@allingo/api-client';
import { buyerInfoSchema, normalizeVnTaxCode, type BuyerInfo, type OrderStatus, type PromotionValidateResult } from '@allingo/schemas/api/billing';
import { type planSchema } from '@allingo/schemas/api/core';
import type { z } from 'zod';

/**
 * Hàm thuần cho billing ở web (S7/S8): định dạng VND, giá hiển thị (compare_at, mã khuyến mãi), nhóm gói theo program,
 * kiểm tra thông tin hoá đơn GIỐNG server (cùng `buyerInfoSchema`/`normalizeVnTaxCode` của @allingo/schemas), nhịp polling.
 * Chỉ để hiển thị – giá cuối cùng, mã giảm giá, quyền lợi đều do server quyết định (CLAUDE.md §5.7).
 */

export type Plan = z.infer<typeof planSchema>;
export type PlanPrice = NonNullable<Plan['price']>;

/** Mã dùng thử Pro 7 ngày của chiến dịch seed (S8) – đổi bằng POST /promotions/redeem */
export const TRIAL_PROMO_CODE = 'PRO7DAY';

export { normalizeVnTaxCode };

/** 199000 → "199.000 ₫" (vi) / "₫199,000" (en). VND là số nguyên đồng. */
export function formatVnd(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Math.round(amount));
}

/** % tiết kiệm so với giá gốc (`compare_at`); không có/không rẻ hơn → null */
export function savingsPercent(amount: number, compareAt: number | null | undefined): number | null {
  if (!compareAt || compareAt <= amount || compareAt <= 0) return null;
  return Math.round((1 - amount / compareAt) * 100);
}

/** Giá quy đổi theo tháng của gói có thời hạn (năm → /12), làm tròn nghìn đồng; gói tháng/không thời hạn → null */
export function monthlyEquivalent(amount: number, durationDays: number | null | undefined): number | null {
  if (!durationDays || durationDays <= 31) return null;
  const months = Math.round(durationDays / 30.4);
  if (months < 2) return null;
  return Math.round(amount / months / 1000) * 1000;
}

export interface PriceView {
  /** Giá niêm yết hiện hành */
  amount: number;
  /** Giá gốc gạch ngang (compare_at hoặc giá trước giảm của mã) */
  strike: number | null;
  /** Giá phải trả sau mã khuyến mãi (null = không có mã hợp lệ) */
  total: number;
  discount: number;
  savingsPct: number | null;
  promoApplied: boolean;
}

/**
 * Giá hiển thị trên thẻ gói: mã hợp lệ (`valid` + `applies_to = order`) → tổng sau giảm do SERVER tính (`total`), gạch giá
 * niêm yết; không có mã → gạch `compare_at` nếu cao hơn.
 */
export function priceView(price: Pick<PlanPrice, 'amount' | 'compare_at'>, promo?: PromotionValidateResult | null): PriceView {
  const applied = !!promo && promo.valid && (promo.applies_to ?? 'order') === 'order' && promo.discount > 0 && promo.subtotal === price.amount;
  if (applied) {
    return { amount: price.amount, strike: price.amount, total: promo.total, discount: promo.discount, savingsPct: savingsPercent(promo.total, price.amount), promoApplied: true };
  }
  const strike = price.compare_at && price.compare_at > price.amount ? price.compare_at : null;
  return { amount: price.amount, strike, total: price.amount, discount: 0, savingsPct: savingsPercent(price.amount, strike), promoApplied: false };
}

export interface ProgramPlans {
  free: Plan | null;
  monthly: Plan | null;
  yearly: Plan | null;
  lifetime: Plan | null;
  combo: Plan | null;
  creditPacks: Plan[];
}

/** Gói đang bán của một program (GET /plans?program=): Free, Pro tháng/năm/trọn đời của program đó, combo, gói credit */
export function groupPlans(plans: readonly Plan[], program: string): ProgramPlans {
  const ofProgram = (kind: Plan['kind']) => plans.find((p) => p.kind === kind && p.programs.includes(program) && !!p.price) ?? null;
  return {
    free: plans.find((p) => p.kind === 'free') ?? null,
    monthly: ofProgram('monthly'),
    yearly: ofProgram('yearly'),
    lifetime: ofProgram('lifetime'),
    combo: plans.find((p) => p.kind === 'combo' && !!p.price) ?? null,
    creditPacks: plans.filter((p) => p.kind === 'credit_pack' && !!p.price).sort((a, b) => (a.price?.amount ?? 0) - (b.price?.amount ?? 0)),
  };
}

/** Tìm gói theo price_id (trang checkout) */
export function findPlanByPrice(plans: readonly Plan[], priceId: string): Plan | null {
  return plans.find((p) => p.price?.id === priceId) ?? null;
}

// ----------------------------------------------------------------------------- Thông tin hoá đơn

export type BuyerField = 'name' | 'email' | 'tax_code' | 'company' | 'address';
/** Mã lỗi theo trường – khoá i18n `checkout.buyer.errors.<code>` */
export type BuyerErrorCode = 'tax_code_required' | 'invalid_tax_code' | 'company_required' | 'address_required' | 'invalid_email' | 'too_long' | 'invalid';

export interface BuyerDraft {
  type: 'personal' | 'business';
  name: string;
  email: string;
  tax_code: string;
  company: string;
  address: string;
}

export const EMPTY_BUYER: BuyerDraft = { type: 'personal', name: '', email: '', tax_code: '', company: '', address: '' };

/**
 * Kiểm tra thông tin xuất hoá đơn bằng ĐÚNG schema server (`buyerInfoSchema`): doanh nghiệp bắt buộc MST hợp lệ (10 số hoặc
 * 13 số `0123456789-001`, chữ số kiểm tra), tên công ty, địa chỉ; cá nhân chỉ tên/email tuỳ chọn. Trả body đã chuẩn hoá.
 */
export function validateBuyer(draft: BuyerDraft): { ok: true; value: BuyerInfo } | { ok: false; errors: Partial<Record<BuyerField, BuyerErrorCode>> } {
  const trimmed = (v: string) => (v.trim() ? v.trim() : undefined);
  const input =
    draft.type === 'business'
      ? { type: 'business' as const, name: trimmed(draft.name), email: trimmed(draft.email), tax_code: trimmed(draft.tax_code), company: trimmed(draft.company), address: trimmed(draft.address) }
      : { type: 'personal' as const, name: trimmed(draft.name), email: trimmed(draft.email) };
  const r = buyerInfoSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const errors: Partial<Record<BuyerField, BuyerErrorCode>> = {};
  for (const issue of r.error.issues) {
    const field = String(issue.path[0] ?? '') as BuyerField;
    if (!field || errors[field]) continue;
    const reason = (issue as { params?: { reason?: string } }).params?.reason;
    if (reason === 'tax_code_required' || reason === 'invalid_tax_code' || reason === 'company_required' || reason === 'address_required') errors[field] = reason;
    else if (field === 'email') errors[field] = 'invalid_email';
    else if (issue.code === 'too_big') errors[field] = 'too_long';
    else errors[field] = 'invalid';
  }
  return { ok: false, errors };
}

// ----------------------------------------------------------------------------- Lỗi API billing

/** 400 `details.promotion.reason` (POST /orders, /promotions/redeem) */
export function promotionReasonOf(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const p = err.details?.promotion as { reason?: unknown } | undefined;
  return typeof p?.reason === 'string' ? p.reason : null;
}

/** 400 `details.issues[{path, message, code}]` → { 'buyer_info.tax_code': 'custom' } */
export function issuePaths(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const issues = err.details?.issues;
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const i of issues as { path?: unknown; code?: unknown }[]) {
    const path = Array.isArray(i.path) ? i.path.join('.') : typeof i.path === 'string' ? i.path : '';
    if (path) out[path] ??= typeof i.code === 'string' ? i.code : 'invalid';
  }
  return out;
}

/** `details.reason` (vd. 403 `guest_account`, 409 `order_not_payable`, `idempotency_key_reused`) hoặc `details.code` */
export function detailReasonOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.details) return null;
  const r = err.details.reason ?? err.details.code;
  return typeof r === 'string' ? r : null;
}

// ----------------------------------------------------------------------------- Trạng thái đơn

/** Trạng thái kết thúc với trang kết quả (dừng polling) */
export function isSettledOrderStatus(status: OrderStatus): boolean {
  return status === 'paid' || status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'refunded';
}

/** Nhịp polling GET /orders/{id}: 2 s trong 30 s đầu, 5 s tới 3 phút, sau đó 10 s (Socket.IO `order.updated` làm mới ngay) */
export function orderPollInterval(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_000;
  if (elapsedMs < 180_000) return 5_000;
  return 10_000;
}

/** Giữ lại đường dẫn nội bộ an toàn cho `?next=` (chặn URL tuyệt đối / `//host`) */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next.length > 500 ? null : next;
}
