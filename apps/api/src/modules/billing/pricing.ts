import { MIN_PAYABLE_VND, type PromotionConditions, type PromotionKind, type PromotionRejectReason } from '@allingo/schemas';

/**
 * Tính giá & điều kiện khuyến mãi phía server – thuần, không I/O (Sprint 7, đầy đủ ở Sprint 8 – ADR-0030).
 * Tiền VND nguyên (làm tròn xuống đồng). Loại: percent | fixed (bí danh S7 `amount`) | credit_bonus | trial_days.
 * Không cộng dồn: một mã/đơn (stackable luôn false).
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
  /** S8 */
  conditions?: PromotionConditions;
  stackable?: boolean;
  name?: Record<string, string> | null;
}

export interface PriceComputation {
  subtotal: number;
  discount: number;
  total: number;
  /** S8: credit_bonus → số credit tặng khi thanh toán/đổi mã */
  bonusCredits?: number;
  /** S8: trial_days → số ngày dùng thử */
  trialDays?: number | null;
}

/** Ngữ cảnh đánh giá: `order` (POST /orders, /promotions/validate có gói) · `redeem` (POST /promotions/redeem, validate không gói) */
export interface PromotionContext {
  mode?: 'order' | 'redeem';
  /** Gói của đơn (mode order) */
  planId?: string | null;
  planKind?: string | null;
  planPrograms?: string[] | null;
  subtotal: number;
  now: Date;
  /** Lượt của người dùng: đơn đã thanh toán (S7) / giữ lượt còn hiệu lực + đã dùng (S8) */
  userPaidUses: number;
  /** Lượt toàn hệ thống đang giữ (đơn chờ thanh toán còn hạn) – cộng với used_count khi so max_uses */
  activeReservations?: number;
  user?: { createdAt: Date; isGuest: boolean; paidOrders: number } | null;
  /** trial_days: chương trình muốn dùng thử */
  program?: string | null;
  trialUsed?: boolean;
  alreadyPro?: boolean;
}

export type PromotionEvaluation =
  | { ok: true; computation: PriceComputation; appliesTo: 'order' | 'redeem' }
  | { ok: false; reason: PromotionRejectReason; computation: PriceComputation; appliesTo: 'order' | 'redeem' | null };

export function toVnd(n: number | string): number {
  return Math.floor(Number(n));
}

/** Loại chuẩn hoá (S7 `amount` → `fixed`) */
export function promotionKind(kind: string): PromotionKind {
  return kind === 'amount' ? 'fixed' : (kind as PromotionKind);
}

/** Mã chỉ đổi trực tiếp (không qua đơn): trial_days, credit_bonus standalone */
export function isRedeemOnly(p: Pick<PromotionRow, 'kind' | 'conditions'>): boolean {
  const k = promotionKind(p.kind);
  return k === 'trial_days' || (k === 'credit_bonus' && !!p.conditions?.standalone);
}

/** Số tiền giảm của một mã cho subtotal (percent: value % làm tròn xuống; fixed: value đồng), không vượt subtotal */
export function discountFor(promo: Pick<PromotionRow, 'kind' | 'value'>, subtotal: number): number {
  const v = Number(promo.value);
  const kind = promotionKind(promo.kind);
  if (!Number.isFinite(v) || v <= 0 || (kind !== 'percent' && kind !== 'fixed')) return 0;
  const d = kind === 'percent' ? Math.floor((subtotal * Math.min(v, 100)) / 100) : Math.floor(v);
  return Math.max(0, Math.min(d, subtotal));
}

/** Người dùng mới: chưa có đơn đã thanh toán và tài khoản tạo ≤ new_user_max_days (mặc định 30) ngày */
export function isNewUser(user: { createdAt: Date; paidOrders: number }, now: Date, maxDays = 30): boolean {
  return user.paidOrders === 0 && now.getTime() - user.createdAt.getTime() <= maxDays * 86_400_000;
}

/**
 * Kiểm tra mã + tính tổng. Trả `reason` đầu tiên không đạt theo thứ tự: không có/không hoạt động → chưa bắt đầu/hết hạn →
 * sai ngữ cảnh (requires_redeem / requires_order / plan_required) → khách → gói/chương trình/loại gói → người dùng mới →
 * trial đã dùng / đang Pro → hết lượt toàn hệ thống → hết lượt người dùng → tổng tối thiểu → dưới mức thanh toán tối thiểu.
 */
export function evaluatePromotion(promo: PromotionRow | null, ctx: PromotionContext): PromotionEvaluation {
  const base: PriceComputation = { subtotal: ctx.subtotal, discount: 0, total: ctx.subtotal };
  const mode = ctx.mode ?? 'order';
  const fail = (reason: PromotionRejectReason, appliesTo: 'order' | 'redeem' | null = promo ? (isRedeemOnly(promo) ? 'redeem' : 'order') : null): PromotionEvaluation => ({ ok: false, reason, computation: base, appliesTo });
  if (!promo) return fail('not_found', null);
  if (!promo.isActive) return fail('inactive');
  if (ctx.now < promo.validFrom) return fail('not_started');
  if (ctx.now >= promo.validTo) return fail('expired');
  const kind = promotionKind(promo.kind);
  const c = promo.conditions ?? {};
  const redeemOnly = isRedeemOnly(promo);
  if (mode === 'order' && redeemOnly) return fail('requires_redeem');
  if (mode === 'redeem' && !redeemOnly) return fail(ctx.planId === undefined ? 'plan_required' : 'requires_order');
  if (ctx.user?.isGuest) return fail('guest_account');
  if (mode === 'order') {
    if (promo.planIds && promo.planIds.length > 0 && (!ctx.planId || !promo.planIds.includes(ctx.planId))) return fail('plan_not_eligible');
    if (c.plan_kinds?.length && (!ctx.planKind || !c.plan_kinds.includes(ctx.planKind as (typeof c.plan_kinds)[number]))) return fail('plan_not_eligible');
    if (c.program_codes?.length && !(ctx.planPrograms ?? []).some((p) => (c.program_codes as string[]).includes(p))) return fail('program_not_eligible');
  } else if (kind === 'trial_days' && c.program_codes?.length && (!ctx.program || !(c.program_codes as string[]).includes(ctx.program))) return fail('program_not_eligible');
  if (c.new_users_only && ctx.user && !isNewUser(ctx.user, ctx.now, c.new_user_max_days ?? 30)) return fail('new_users_only');
  // Dùng thử một lần/người (mọi mã trial) – báo lý do cụ thể trước giới hạn lượt của mã
  if (kind === 'trial_days' && ctx.trialUsed) return fail('trial_already_used');
  if (kind === 'trial_days' && ctx.alreadyPro) return fail('already_pro');
  if (promo.maxUses !== null && promo.usedCount + (ctx.activeReservations ?? 0) >= promo.maxUses) return fail('max_uses_reached');
  if (ctx.userPaidUses >= promo.perUserLimit) return fail('per_user_limit_reached');
  if (kind === 'trial_days') return { ok: true, computation: { ...base, bonusCredits: 0, trialDays: Math.floor(promo.value) }, appliesTo: 'redeem' };
  if (kind === 'credit_bonus') {
    if (mode === 'order' && c.min_subtotal !== undefined && ctx.subtotal < c.min_subtotal) return fail('min_subtotal_not_met');
    return { ok: true, computation: { ...base, bonusCredits: Math.floor(promo.value), trialDays: null }, appliesTo: redeemOnly ? 'redeem' : 'order' };
  }
  if (c.min_subtotal !== undefined && ctx.subtotal < c.min_subtotal) return fail('min_subtotal_not_met');
  const discount = discountFor(promo, ctx.subtotal);
  const total = ctx.subtotal - discount;
  if (total < MIN_PAYABLE_VND) return fail('below_minimum');
  return { ok: true, computation: { subtotal: ctx.subtotal, discount, total, bonusCredits: 0, trialDays: null }, appliesTo: 'order' };
}

/** Chuẩn hoá mã người dùng nhập (không phân biệt hoa thường, bỏ khoảng trắng) */
export function normalizePromoCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}
