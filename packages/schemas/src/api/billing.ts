import { z } from 'zod';
import { isoDateSchema, localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';

/**
 * DTO Billing v1.1 (Sprint 7): đơn hàng, thanh toán 3 cổng (VNPay · MoMo · ZaloPay) + mock, subscription, ledger, đối soát.
 * Tiền tệ VND, số nguyên đồng (không có phần lẻ). Hợp đồng: docs/spec/allingo-openapi.yaml nhóm Billing/Webhooks/Admin.
 */

export const PAYMENT_PROVIDER_CODES = ['vnpay', 'momo', 'zalopay', 'mock'] as const;
export type PaymentProviderCode = (typeof PAYMENT_PROVIDER_CODES)[number];
export const paymentProviderCodeSchema = z.enum(PAYMENT_PROVIDER_CODES);

export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PLAN_KINDS = ['free', 'monthly', 'yearly', 'lifetime', 'combo', 'credit_pack', 'b2b_seat'] as const;

/** Đơn hàng hết hạn sau (phút) nếu chưa thanh toán – job order.expire */
export const ORDER_EXPIRE_MINUTES_DEFAULT = 30;
/** Đơn pending quá (phút) → job payment.reconcile hỏi trạng thái cổng (queryStatus) */
export const PAYMENT_RECONCILE_AFTER_MINUTES_DEFAULT = 15;
/** Gói credit hết hạn sau (tháng) */
export const CREDIT_PACK_VALID_MONTHS = 12;
/** Nhắc gia hạn trước (ngày) */
export const SUBSCRIPTION_REMINDER_DAYS = [7, 3, 1] as const;
/** Số tiền tối thiểu cổng chấp nhận (VND) sau giảm giá */
export const MIN_PAYABLE_VND = 10_000;

/** Trọng số chữ số kiểm tra MST Việt Nam (9 chữ số đầu; chữ số thứ 10 = 10 − (Σ mod 11), Σ mod 11 = 0 → không hợp lệ) */
const VN_TAX_CODE_WEIGHTS = [31, 29, 23, 19, 17, 13, 7, 5, 3] as const;

/**
 * Chuẩn hoá + kiểm tra mã số thuế doanh nghiệp VN (v1.1 – S8): 10 chữ số (doanh nghiệp) hoặc 13 chữ số (chi nhánh/đơn vị phụ
 * thuộc, dạng `0123456789-001`). Bỏ khoảng trắng/dấu chấm; trả `null` khi sai định dạng hoặc sai chữ số kiểm tra.
 */
export function normalizeVnTaxCode(input: string): string | null {
  const s = input.replace(/[\s.]/g, '');
  const m = /^(\d{10})(?:-?(\d{3}))?$/.exec(s);
  if (!m) return null;
  const base = m[1]!;
  const sum = VN_TAX_CODE_WEIGHTS.reduce((acc, w, i) => acc + w * Number(base[i]), 0);
  const check = 10 - (sum % 11);
  if (check === 10 || check !== Number(base[9])) return null;
  if (m[2] === '000') return null;
  return m[2] ? `${base}-${m[2]}` : base;
}

export const BUYER_TYPES = ['personal', 'business'] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

/**
 * Thông tin người mua cho hoá đơn điện tử (v1.1 – S8). `type` mặc định: `business` khi có `tax_code`, ngược lại `personal`.
 * Doanh nghiệp: bắt buộc `tax_code` (MST hợp lệ 10/13 số), `company`, `address`. Cá nhân: tên/email tuỳ chọn (thiếu → hồ sơ).
 */
export const buyerInfoSchema = z
  .object({
    type: z.enum(BUYER_TYPES).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    email: z.email().max(254).optional(),
    tax_code: z.string().trim().max(20).optional(),
    company: z.string().trim().max(200).optional(),
    address: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    const type = v.type ?? (v.tax_code ? 'business' : 'personal');
    if (type !== 'business') return;
    if (!v.tax_code) ctx.addIssue({ code: 'custom', path: ['tax_code'], message: 'tax_code is required for business buyers', params: { reason: 'tax_code_required' } });
    else if (!normalizeVnTaxCode(v.tax_code)) ctx.addIssue({ code: 'custom', path: ['tax_code'], message: 'invalid Vietnamese tax code (10 or 13 digits)', params: { reason: 'invalid_tax_code' } });
    if (!v.company) ctx.addIssue({ code: 'custom', path: ['company'], message: 'company is required for business buyers', params: { reason: 'company_required' } });
    if (!v.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'address is required for business buyers', params: { reason: 'address_required' } });
  })
  .transform((v) => {
    const type: BuyerType = v.type ?? (v.tax_code ? 'business' : 'personal');
    return { ...v, type, tax_code: v.tax_code ? (normalizeVnTaxCode(v.tax_code) ?? v.tax_code) : undefined };
  });
export type BuyerInfo = z.output<typeof buyerInfoSchema>;

export const planPriceSchema = z.object({
  /** price_id dùng cho POST /orders (v1.1) */
  id: uuidSchema,
  amount: z.number(),
  currency: z.string(),
  compare_at: z.number().nullable(),
  valid_to: z.string().nullable().optional(),
});

/** POST /orders: `price_id` (ưu tiên, v1.1) hoặc `plan_id` (v1.0 – lấy giá hiện hành) */
export const orderCreateInputSchema = z
  .object({
    price_id: uuidSchema.optional(),
    plan_id: uuidSchema.optional(),
    promotion_code: z.string().trim().min(1).max(40).optional(),
    quantity: z.number().int().min(1).max(1).default(1),
    buyer_info: buyerInfoSchema.optional(),
  })
  .refine((v) => !!v.price_id || !!v.plan_id, { message: 'price_id or plan_id is required', path: ['price_id'] });
export type OrderCreateInput = z.infer<typeof orderCreateInputSchema>;

export const orderPaymentSchema = z.object({
  id: uuidSchema,
  provider: z.string(),
  status: z.string(),
  amount: z.number(),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
});

export const orderPlanSummarySchema = z.object({
  id: uuidSchema,
  code: z.string(),
  kind: z.enum(PLAN_KINDS),
  programs: z.array(z.string()),
  name: localizedTextSchema,
  credits_included: z.number().int(),
  credits_period: z.string().nullable(),
  duration_days: z.number().int().nullable(),
});

export const PROMOTION_KINDS = ['percent', 'fixed', 'credit_bonus', 'trial_days'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

/** Trạng thái hoá đơn điện tử (billing.invoices.status – v1.1 S8) */
export const INVOICE_STATUSES = ['pending', 'issued', 'error', 'failed', 'cancel_pending', 'cancelled', 'skipped'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** Số lần phát hành tối đa (1 + 5 lần thử lại) trước khi vào dead-letter */
export const INVOICE_MAX_ATTEMPTS = 6;
/** Khoảng chờ (phút) trước lần thử lại thứ 1…5 */
export const INVOICE_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;

export const orderInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES),
  provider: z.string(),
  series: z.string().nullable(),
  invoice_no: z.string().nullable(),
  /** Mã tra cứu trên cổng của nhà cung cấp hoá đơn */
  lookup_code: z.string().nullable(),
  lookup_url: z.string().nullable(),
  /** URL ký 10 phút (bucket invoices) – null khi chưa phát hành */
  pdf_url: z.string().nullable(),
  pdf_expires_at: z.string().nullable(),
  issued_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  buyer_type: z.enum(BUYER_TYPES).nullable(),
});
export type OrderInvoice = z.infer<typeof orderInvoiceSchema>;

export const orderPromotionSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  kind: z.enum(PROMOTION_KINDS),
  value: z.number(),
  /** credit_bonus: số credit tặng khi đơn được thanh toán */
  bonus_credits: z.number().int(),
});

export const orderSchema = z.object({
  id: uuidSchema,
  plan: orderPlanSummarySchema,
  price_id: uuidSchema,
  quantity: z.number().int(),
  currency: z.string(),
  subtotal: z.number(),
  discount: z.number(),
  total: z.number(),
  promotion_code: z.string().nullable(),
  status: z.enum(ORDER_STATUSES),
  payments: z.array(orderPaymentSchema),
  /** v1.1 – S8: trạng thái/số/ký hiệu/mã tra cứu/PDF (URL ký) của hoá đơn điện tử; null khi đơn chưa thanh toán */
  invoice: orderInvoiceSchema.nullable(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  /** Đơn còn trả được (pending|failed|cancelled và chưa hết hạn) */
  payable: z.boolean(),
  /** v1.1 – S8 */
  promotion: orderPromotionSchema.nullable().optional(),
  /** v1.1 – S8: thông tin xuất hoá đơn (đã chuẩn hoá MST) */
  buyer_info: z.object({ type: z.enum(BUYER_TYPES), name: z.string().nullable(), email: z.string().nullable(), tax_code: z.string().nullable(), company: z.string().nullable(), address: z.string().nullable() }).nullable().optional(),
});
export type Order = z.infer<typeof orderSchema>;

/** Cổng chấp nhận ở POST /orders/{id}/pay: payos/stripe có trong hợp đồng nhưng chưa có adapter → 503 `feature_disabled` */
export const PAY_PROVIDER_CODES = ['vnpay', 'momo', 'zalopay', 'payos', 'stripe', 'mock'] as const;

export const payInputSchema = z.object({
  provider: z.enum(PAY_PROVIDER_CODES),
  /** URL web nhận người dùng sau khi cổng chuyển về (phải thuộc WEB_PUBLIC_URL/CORS_ORIGINS); mặc định `${WEB}/checkout/result` */
  return_url: z.url().max(500).optional(),
  locale: z.enum(['vi', 'en']).optional(),
});
export type PayInput = z.infer<typeof payInputSchema>;

export const payResultSchema = z.object({
  payment_id: uuidSchema,
  order_id: uuidSchema,
  provider: paymentProviderCodeSchema,
  /** Cách client mở thanh toán: redirect (mở redirect_url), qr (hiển thị qr_code), deeplink (mở app ví) */
  method: z.enum(['redirect', 'qr', 'deeplink']),
  redirect_url: z.string().nullable(),
  qr_code: z.string().nullable(),
  deeplink: z.string().nullable(),
  expires_at: z.string(),
});
export type PayResult = z.infer<typeof payResultSchema>;

export const paymentProvidersSchema = z.object({
  /** Cờ ff.billing.checkout – false → ẩn nút mua */
  checkout_enabled: z.boolean(),
  /** Chỉ cổng khả dụng (đủ credential + bật trong PAYMENT_PROVIDERS); cổng thiếu cấu hình không được liệt kê */
  providers: z.array(z.object({ code: paymentProviderCodeSchema, methods: z.array(z.enum(['redirect', 'qr', 'deeplink'])), sandbox: z.boolean() })),
});
export type PaymentProviders = z.infer<typeof paymentProvidersSchema>;

/** v1.1 – S8: `plan_id`/`price_id` tuỳ chọn – mã đổi trực tiếp (trial_days, credit_bonus standalone) không cần gói; `program` cho trial */
export const promotionValidateInputSchema = z.object({ code: z.string().trim().min(1).max(40), plan_id: uuidSchema.optional(), price_id: uuidSchema.optional(), program: programCodeSchema.optional() });

export const PROMOTION_REJECT_REASONS = [
  'not_found',
  'inactive',
  'not_started',
  'expired',
  'plan_not_eligible',
  'max_uses_reached',
  'per_user_limit_reached',
  'below_minimum',
  // v1.1 – S8
  'new_users_only',
  'program_not_eligible',
  'min_subtotal_not_met',
  'requires_redeem',
  'requires_order',
  'plan_required',
  'trial_already_used',
  'already_pro',
  'guest_account',
] as const;
export type PromotionRejectReason = (typeof PROMOTION_REJECT_REASONS)[number];

export const promotionValidateResultSchema = z.object({
  valid: z.boolean(),
  code: z.string(),
  reason: z.enum(PROMOTION_REJECT_REASONS).nullable(),
  /** v1.1 – S8: percent | fixed | credit_bonus | trial_days (S7 trả `amount` – nay là `fixed`) */
  kind: z.enum(PROMOTION_KINDS).nullable(),
  value: z.number().nullable(),
  subtotal: z.number(),
  discount: z.number(),
  total: z.number(),
  currency: z.string(),
  /** v1.1 – S8 */
  promotion_id: uuidSchema.nullable().optional(),
  name: localizedTextSchema.nullable().optional(),
  /** order: áp vào POST /orders · redeem: đổi bằng POST /promotions/redeem */
  applies_to: z.enum(['order', 'redeem']).nullable().optional(),
  bonus_credits: z.number().int().optional(),
  trial_days: z.number().int().nullable().optional(),
  /** Luôn false – một mã/đơn, không cộng dồn */
  stackable: z.boolean().optional(),
});
export type PromotionValidateResult = z.infer<typeof promotionValidateResultSchema>;

/** POST /promotions/redeem (v1.1 – S8): trial_days → subscription trialing; credit_bonus standalone → cộng credit */
export const promotionRedeemInputSchema = z.object({ code: z.string().trim().min(1).max(40), program: programCodeSchema.optional() });
export type PromotionRedeemInput = z.infer<typeof promotionRedeemInputSchema>;

export const promotionConditionsSchema = z.object({
  program_codes: z.array(programCodeSchema).max(4).optional(),
  plan_kinds: z.array(z.enum(['monthly', 'yearly', 'lifetime', 'combo', 'credit_pack'])).max(5).optional(),
  /** Chỉ người dùng mới: chưa có đơn đã thanh toán và tài khoản tạo ≤ new_user_max_days (mặc định 30) ngày */
  new_users_only: z.boolean().optional(),
  new_user_max_days: z.number().int().min(1).max(365).optional(),
  min_subtotal: z.number().int().min(0).max(100_000_000).optional(),
  /** trial_days: gói cấp quyền khi dùng thử (mặc định `<program>_pro_monthly`) */
  trial_plan_code: z.string().max(64).optional(),
  /** credit_bonus: true = đổi trực tiếp không cần mua */
  standalone: z.boolean().optional(),
  /** credit_bonus: lô credit hết hạn sau N ngày (mặc định 365) */
  credit_valid_days: z.number().int().min(1).max(3650).optional(),
});
export type PromotionConditions = z.infer<typeof promotionConditionsSchema>;

const promoCode = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .transform((s) => s.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,40}$/, 'A-Z, 0-9, _ or -'));
/** Bí danh S7 `amount` = `fixed` */
const promoKind = z.preprocess((v) => (v === 'amount' ? 'fixed' : v), z.enum(PROMOTION_KINDS));

function checkPromotionValue(v: { kind?: PromotionKind; value?: number; valid_from?: string; valid_to?: string }, ctx: z.RefinementCtx): void {
  if (v.kind && v.value !== undefined) {
    const bad =
      (v.kind === 'percent' && (v.value <= 0 || v.value > 100)) ||
      (v.kind === 'fixed' && v.value < 1000) ||
      (v.kind === 'trial_days' && (!Number.isInteger(v.value) || v.value < 1 || v.value > 90)) ||
      (v.kind === 'credit_bonus' && (!Number.isInteger(v.value) || v.value < 1 || v.value > 1_000_000));
    if (bad) ctx.addIssue({ code: 'custom', path: ['value'], message: `value out of range for kind ${v.kind}` });
  }
  if (v.valid_from && v.valid_to && new Date(v.valid_to) <= new Date(v.valid_from)) ctx.addIssue({ code: 'custom', path: ['valid_to'], message: 'valid_to must be after valid_from' });
}

export const promotionCreateInputSchema = z
  .object({
    code: promoCode,
    kind: promoKind,
    value: z.number().positive(),
    name: localizedTextSchema.optional(),
    /** Mã gói áp dụng (rỗng = mọi gói) – server đổi sang plan_ids */
    plan_codes: z.array(z.string().max(64)).max(50).optional(),
    valid_from: z.iso.datetime({ offset: true }),
    valid_to: z.iso.datetime({ offset: true }),
    max_uses: z.number().int().min(1).nullable().optional(),
    per_user_limit: z.number().int().min(1).max(100).default(1),
    is_active: z.boolean().default(true),
    conditions: promotionConditionsSchema.default({}),
  })
  .superRefine(checkPromotionValue);
export type PromotionCreateInput = z.output<typeof promotionCreateInputSchema>;

export const promotionPatchInputSchema = z
  .object({
    kind: promoKind.optional(),
    value: z.number().positive().optional(),
    name: localizedTextSchema.nullable().optional(),
    plan_codes: z.array(z.string().max(64)).max(50).optional(),
    valid_from: z.iso.datetime({ offset: true }).optional(),
    valid_to: z.iso.datetime({ offset: true }).optional(),
    max_uses: z.number().int().min(1).nullable().optional(),
    per_user_limit: z.number().int().min(1).max(100).optional(),
    is_active: z.boolean().optional(),
    conditions: promotionConditionsSchema.optional(),
  })
  .superRefine(checkPromotionValue);
export type PromotionPatchInput = z.output<typeof promotionPatchInputSchema>;

export const promotionAdminSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  kind: z.enum(PROMOTION_KINDS),
  value: z.number(),
  name: localizedTextSchema.nullable(),
  plan_ids: z.array(uuidSchema),
  plan_codes: z.array(z.string()),
  conditions: promotionConditionsSchema,
  valid_from: z.string(),
  valid_to: z.string(),
  max_uses: z.number().int().nullable(),
  used_count: z.number().int(),
  per_user_limit: z.number().int(),
  is_active: z.boolean(),
  stackable: z.boolean(),
  /** Lượt theo trạng thái: reserved (đơn chờ thanh toán) · redeemed · released */
  stats: z.object({ reserved: z.number().int(), redeemed: z.number().int(), released: z.number().int(), discount_total: z.number(), credits_total: z.number().int() }),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PromotionAdmin = z.infer<typeof promotionAdminSchema>;

export const adminPromotionsQuerySchema = z.object({
  active: z.stringbool().optional(),
  kind: z.enum(PROMOTION_KINDS).optional(),
  q: z.string().trim().max(40).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const subscriptionSchema = z.object({
  id: uuidSchema,
  plan: orderPlanSummarySchema,
  program: z.string().nullable(),
  status: z.enum(['trialing', 'active', 'past_due', 'cancelled', 'expired', 'lifetime']),
  current_period_start: z.string(),
  current_period_end: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
  /** Đang hiệu lực (start ≤ now < end) */
  is_current: z.boolean(),
  /** Kỳ nối tiếp đã mua, bắt đầu sau kỳ hiện tại */
  upcoming: z.boolean(),
  days_left: z.number().int().nullable(),
  source_order_id: uuidSchema.nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const promotionRedeemResultSchema = z.object({
  code: z.string(),
  kind: z.enum(['trial_days', 'credit_bonus']),
  redemption_id: uuidSchema,
  /** credit_bonus: số credit đã cộng (ledger `promo`) */
  credits_granted: z.number().int(),
  balance: z.number().int(),
  /** trial_days: subscription `trialing` vừa cấp */
  subscription: subscriptionSchema.nullable(),
  trial_ends_at: z.string().nullable(),
});
export type PromotionRedeemResult = z.infer<typeof promotionRedeemResultSchema>;

export const ledgerEntrySchema = z.object({
  id: z.number().int(),
  delta: z.number().int(),
  balance_after: z.number().int(),
  reason: z.string(),
  ref: z.object({ type: z.string(), id: z.string().nullable() }).nullable(),
  expires_at: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const refundInputSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /** Thu hồi credit còn lại của đơn (mặc định true; không làm số dư âm – A9x) */
  revoke_credits: z.boolean().default(true),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

export const RECONCILIATION_MISMATCH_TYPES = ['missing_in_statement', 'missing_in_system', 'amount_mismatch', 'status_mismatch'] as const;
export const reconciliationMismatchSchema = z.object({
  type: z.enum(RECONCILIATION_MISMATCH_TYPES),
  provider_txn_id: z.string().nullable(),
  merchant_ref: z.string().nullable(),
  order_id: z.string().nullable(),
  system_amount: z.number().nullable(),
  statement_amount: z.number().nullable(),
  system_status: z.string().nullable(),
  statement_status: z.string().nullable(),
});
export type ReconciliationMismatch = z.infer<typeof reconciliationMismatchSchema>;

export const reconciliationRunInputSchema = z.object({
  provider: paymentProviderCodeSchema,
  /** Ngày giao dịch (lịch Asia/Ho_Chi_Minh); mặc định hôm qua */
  for_date: isoDateSchema.optional(),
  /** csv: so với sao kê tải lên (mẫu docs/runbooks/payments.md); query: hỏi queryStatus từng giao dịch */
  source: z.enum(['csv', 'query']).default('csv'),
  csv: z.string().max(5_000_000).optional(),
});
export type ReconciliationRunInput = z.infer<typeof reconciliationRunInputSchema>;

export const reconciliationRunSchema = z.object({
  id: uuidSchema,
  provider: z.string(),
  for_date: z.string(),
  status: z.enum(['matched', 'mismatched', 'error']),
  expected_total: z.number().nullable(),
  actual_total: z.number().nullable(),
  mismatches: z.array(reconciliationMismatchSchema),
  mismatch_count: z.number().int(),
  run_at: z.string(),
  source: z.string().nullable(),
  system_count: z.number().int().nullable(),
  statement_count: z.number().int().nullable(),
  matched_count: z.number().int().nullable(),
});
export type ReconciliationRun = z.infer<typeof reconciliationRunSchema>;

export const BILLING_JOBS = ['order.expire', 'payment.reconcile', 'subscription.expire', 'credit.grant_monthly', 'credit.expire', 'billing.reconcile', 'credit.grant_free_monthly', 'invoice.retry'] as const;
export type BillingJob = (typeof BILLING_JOBS)[number];

export const adminOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  provider: paymentProviderCodeSchema.optional(),
  user_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const notificationItemSchema = z.object({
  id: uuidSchema,
  channel: z.string(),
  template_code: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: z.string(),
  scheduled_at: z.string(),
  sent_at: z.string().nullable(),
  read_at: z.string().nullable(),
  /** v1.1 – S8: loại (learning | billing | marketing | system) + nội dung đã dựng theo ngôn ngữ người dùng (dự phòng khi web chưa có bản dịch) */
  category: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

// ----------------------------------------------------------------------------- Billing admin (v1.1 – S8)
export const PAYMENT_STATUSES = ['initiated', 'success', 'failed', 'refunded'] as const;
export const adminPaymentsQuerySchema = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  provider: paymentProviderCodeSchema.optional(),
  order_id: uuidSchema.optional(),
  user_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminPaymentSchema = z.object({
  id: uuidSchema,
  order_id: uuidSchema,
  user_id: uuidSchema,
  provider: z.string(),
  provider_txn_id: z.string().nullable(),
  merchant_ref: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  signature_valid: z.boolean().nullable(),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
  flags: z.array(z.string()),
});

export const adminInvoicesQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  order_id: uuidSchema.optional(),
  user_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminInvoiceSchema = z.object({
  id: uuidSchema,
  order_id: uuidSchema,
  user_id: uuidSchema,
  order_status: z.enum(ORDER_STATUSES),
  total: z.number(),
  status: z.enum(INVOICE_STATUSES),
  provider: z.string(),
  series: z.string().nullable(),
  invoice_no: z.string().nullable(),
  lookup_code: z.string().nullable(),
  buyer_type: z.enum(BUYER_TYPES).nullable(),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  next_retry_at: z.string().nullable(),
  issued_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AdminInvoice = z.infer<typeof adminInvoiceSchema>;

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired', 'lifetime'] as const;
export const adminSubscriptionsQuerySchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  user_id: uuidSchema.optional(),
  plan_code: z.string().max(64).optional(),
  program: programCodeSchema.optional(),
  /** Còn hiệu lực và hết kỳ trong N ngày tới */
  expiring_within_days: z.coerce.number().int().min(1).max(365).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** POST /admin/users/{userId}/credits – `note` (lý do) bắt buộc; delta âm không làm số dư âm (409) */
export const adminCreditAdjustInputSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'delta must not be 0')
    .refine((n) => Math.abs(n) <= 1_000_000, 'delta too large'),
  note: z.string().trim().min(3).max(500),
  /** Lô credit tặng có hạn (tuỳ chọn, chỉ delta > 0) */
  expires_at: z.iso.datetime({ offset: true }).optional(),
});
export type AdminCreditAdjustInput = z.infer<typeof adminCreditAdjustInputSchema>;
export const adminCreditAdjustResultSchema = z.object({
  user_id: uuidSchema,
  delta: z.number().int(),
  balance_after: z.number().int(),
  ledger_id: z.number().int(),
  reason: z.literal('admin_adjust'),
  note: z.string(),
  actor_id: uuidSchema,
});

export const deadLetterSchema = z.object({
  id: uuidSchema,
  queue: z.string(),
  job: z.string(),
  business_id: z.string(),
  payload: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  attempts: z.number().int().nullable(),
  failed_at: z.string(),
  resolved_at: z.string().nullable(),
  retried_at: z.string().nullable(),
  retried_by: uuidSchema.nullable(),
});
export type DeadLetter = z.infer<typeof deadLetterSchema>;
export const DEAD_LETTER_JOBS = ['invoice.issue', 'invoice.cancel'] as const;
export const adminDeadLettersQuerySchema = z.object({
  job: z.enum(DEAD_LETTER_JOBS).optional(),
  /** false (mặc định): chỉ mục chưa xử lý */
  include_resolved: z.stringbool().default(false),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Đối chiếu hoá đơn tháng: số hoá đơn hiệu lực = đơn paid − refunded (theo paid_at, lịch Asia/Ho_Chi_Minh) */
export const invoiceReconciliationSchema = z.object({
  month: z.string(),
  from: z.string(),
  to: z.string(),
  orders_paid: z.number().int(),
  orders_refunded: z.number().int(),
  expected_invoices: z.number().int(),
  invoices_issued: z.number().int(),
  invoices_cancelled: z.number().int(),
  invoices_pending: z.number().int(),
  invoices_failed: z.number().int(),
  matched: z.boolean(),
  /** Đơn paid chưa có hoá đơn phát hành */
  missing: z.array(z.object({ order_id: uuidSchema, invoice_status: z.string().nullable() })),
  /** Đơn đã hoàn tiền nhưng hoá đơn chưa huỷ */
  unexpected: z.array(z.object({ order_id: uuidSchema, invoice_status: z.string(), order_status: z.string() })),
});
export type InvoiceReconciliation = z.infer<typeof invoiceReconciliationSchema>;

/** Sự kiện Socket.IO (namespace /ws, room user:<id>) do billing đẩy – v1.1 S7 */
export const BILLING_REALTIME_EVENTS = {
  ORDER_UPDATED: 'order.updated',
  CREDITS_CHANGED: 'credits.changed',
  ENTITLEMENTS_CHANGED: 'entitlements.changed',
} as const;
