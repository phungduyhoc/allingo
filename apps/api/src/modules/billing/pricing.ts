import { MIN_PAYABLE_VND, type PromotionRejectReason } from '@allingo/schemas';

/**
 * Tính giá phía server (Sprint 7) – thuần, không I/O. Tiền VND nguyên (làm tròn xuống đồng).
 * Khuyến mãi S7: mã cố định từ seed, điều kiện cơ bản (hiệu lực, gói áp dụng, tổng lượt, lượt/người, tối thiểu sau giảm).
 * Khuyến mãi nâng cao (điều kiện theo người dùng, xếp chồng, referral) ở S8.
 */
export interface PromotionRow {
  id: string;
  code: string;
  kind: string;
  value: number;
  planIds: string[] | null;
  validFrom: Date;
  validTo: Date;
  maxUses: number | null;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
}

export interface PriceComputation {
  subtotal: number;
  discount: number;
  total: number;
}

export function toVnd(n: number | string): number {
  return Math.floor(Number(n));
}

/** Số tiền giảm của một mã cho subtotal (percent: value % làm tròn xuống; amount: value đồng), không vượt subtotal */
export function discountFor(promo: Pick<PromotionRow, 'kind' | 'value'>, subtotal: number): number {
  const v = Number(promo.value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const d = promo.kind === 'percent' ? Math.floor((subtotal * Math.min(v, 100)) / 100) : Math.floor(v);
  return Math.max(0, Math.min(d, subtotal));
}

/**
 * Kiểm tra mã + tính tổng. `userPaidUses` = số đơn ĐÃ THANH TOÁN của người dùng có mã này (đơn pending không giữ lượt).
 * Trả `reason` đầu tiên không đạt theo thứ tự: không có/không hoạt động → chưa bắt đầu/hết hạn → không áp dụng gói →
 * hết lượt toàn hệ thống → hết lượt của người dùng → dưới mức tối thiểu thanh toán.
 */
export function evaluatePromotion(
  promo: PromotionRow | null,
  ctx: { planId: string; subtotal: number; now: Date; userPaidUses: number },
): { ok: true; computation: PriceComputation } | { ok: false; reason: PromotionRejectReason; computation: PriceComputation } {
  const base: PriceComputation = { subtotal: ctx.subtotal, discount: 0, total: ctx.subtotal };
  if (!promo) return { ok: false, reason: 'not_found', computation: base };
  if (!promo.isActive) return { ok: false, reason: 'inactive', computation: base };
  if (ctx.now < promo.validFrom) return { ok: false, reason: 'not_started', computation: base };
  if (ctx.now >= promo.validTo) return { ok: false, reason: 'expired', computation: base };
  if (promo.planIds && promo.planIds.length > 0 && !promo.planIds.includes(ctx.planId)) return { ok: false, reason: 'plan_not_eligible', computation: base };
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) return { ok: false, reason: 'max_uses_reached', computation: base };
  if (ctx.userPaidUses >= promo.perUserLimit) return { ok: false, reason: 'per_user_limit_reached', computation: base };
  const discount = discountFor(promo, ctx.subtotal);
  const total = ctx.subtotal - discount;
  if (total < MIN_PAYABLE_VND) return { ok: false, reason: 'below_minimum', computation: base };
  return { ok: true, computation: { subtotal: ctx.subtotal, discount, total } };
}

/** Chuẩn hoá mã người dùng nhập (không phân biệt hoa thường, bỏ khoảng trắng) */
export function normalizePromoCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}
