import { z } from 'zod';
import { isoDateSchema, localizedTextSchema, uuidSchema } from '../common.js';

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

export const buyerInfoSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().max(254).optional(),
  tax_code: z.string().trim().max(20).optional(),
  company: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
});
export type BuyerInfo = z.infer<typeof buyerInfoSchema>;

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
  invoice: z.object({ invoice_no: z.string().nullable(), pdf_url: z.string().nullable(), issued_at: z.string().nullable() }).nullable(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  /** Đơn còn trả được (pending|failed|cancelled và chưa hết hạn) */
  payable: z.boolean(),
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

export const promotionValidateInputSchema = z
  .object({ code: z.string().trim().min(1).max(40), plan_id: uuidSchema.optional(), price_id: uuidSchema.optional() })
  .refine((v) => !!v.price_id || !!v.plan_id, { message: 'price_id or plan_id is required', path: ['plan_id'] });

export const PROMOTION_REJECT_REASONS = ['not_found', 'inactive', 'not_started', 'expired', 'plan_not_eligible', 'max_uses_reached', 'per_user_limit_reached', 'below_minimum'] as const;
export type PromotionRejectReason = (typeof PROMOTION_REJECT_REASONS)[number];

export const promotionValidateResultSchema = z.object({
  valid: z.boolean(),
  code: z.string(),
  reason: z.enum(PROMOTION_REJECT_REASONS).nullable(),
  kind: z.enum(['percent', 'amount']).nullable(),
  value: z.number().nullable(),
  subtotal: z.number(),
  discount: z.number(),
  total: z.number(),
  currency: z.string(),
});
export type PromotionValidateResult = z.infer<typeof promotionValidateResultSchema>;

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

export const BILLING_JOBS = ['order.expire', 'payment.reconcile', 'subscription.expire', 'credit.grant_monthly', 'credit.expire', 'billing.reconcile'] as const;
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
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** Sự kiện Socket.IO (namespace /ws, room user:<id>) do billing đẩy – v1.1 S7 */
export const BILLING_REALTIME_EVENTS = {
  ORDER_UPDATED: 'order.updated',
  CREDITS_CHANGED: 'credits.changed',
  ENTITLEMENTS_CHANGED: 'entitlements.changed',
} as const;
