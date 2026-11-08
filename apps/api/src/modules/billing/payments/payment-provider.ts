/**
 * Giao diện cổng thanh toán webhook-first (ADR-0012, Sprint 7). Mỗi adapter:
 *  - `createPayment` → URL chuyển hướng / QR / deeplink (ký HMAC đúng chuẩn cổng)
 *  - `verifyWebhook` (chữ ký) → `parseWebhook` (chuẩn hoá: mã tham chiếu, mã GD cổng, số tiền VND, trạng thái)
 *  - `ack` → phản hồi đúng định dạng cổng (VNPay RspCode, MoMo 204, ZaloPay return_code)
 *  - `queryStatus` → hỏi trạng thái khi webhook mất (job payment.reconcile, đối soát)
 *  - `refund?` → TODO S8 (S7 chỉ hoàn tiền thủ công qua admin)
 * Quyền chỉ được cấp từ webhook/queryStatus đã xác minh – return URL chỉ để hiển thị.
 */
import { observeOutbound } from '../../../shared/telemetry/outbound.js';

export type ProviderCode = 'vnpay' | 'momo' | 'zalopay' | 'mock';
/** Giá trị enum billing.payment_provider tương ứng (mock lưu là `manual`, bị chặn ở production) */
export type DbPaymentProvider = 'vnpay' | 'momo' | 'zalopay' | 'manual';
export type PaymentMethod = 'redirect' | 'qr' | 'deeplink';

export interface CreatePaymentInput {
  /** Mã tham chiếu Allingo gửi cổng (vnp_TxnRef / MoMo orderId / hậu tố app_trans_id) – suy ra được order_id (merchant-ref.ts) */
  merchantRef: string;
  orderId: string;
  /** Số tiền VND nguyên (đã kiểm tra = orders.total) */
  amount: number;
  currency: 'VND';
  /** Mô tả ASCII không dấu, ≤ 200 ký tự */
  description: string;
  /** URL cổng chuyển trình duyệt về (API GET /payments/return/{provider}) */
  returnUrl: string;
  /** URL cổng gọi IPN/callback (API /webhooks/payments/{provider}) */
  ipnUrl: string;
  ipAddress: string;
  locale: 'vi' | 'en';
  createdAt: Date;
  expiresAt: Date;
  /** Định danh người mua đã băm (không gửi id/email thật cho cổng) */
  userRef: string;
}

export interface CreatePaymentResult {
  method: PaymentMethod;
  redirectUrl: string | null;
  qrCode: string | null;
  deeplink: string | null;
  /** Thông tin lưu vào payments.raw_callback.init để queryStatus/đối soát (không chứa khoá bí mật) */
  meta: Record<string, unknown>;
}

export type ProviderPaymentStatus = 'paid' | 'failed' | 'cancelled' | 'pending';

export interface ParsedWebhook {
  merchantRef: string;
  /** Mã giao dịch phía cổng (vnp_TransactionNo / MoMo transId / zp_trans_id) – khoá idempotent (provider, provider_txn_id) */
  providerTxnId: string | null;
  /** VND nguyên (VNPay đã chia 100) – NaN/không nguyên → coi là lệch số tiền */
  amount: number;
  currency: string;
  status: ProviderPaymentStatus;
  /** Mã kết quả gốc của cổng (vnp_ResponseCode / resultCode / return_code) */
  providerCode: string;
  message?: string | null;
  paidAt?: Date | null;
  raw: Record<string, unknown>;
}

export interface WebhookInput {
  method: 'GET' | 'POST';
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

/** Kết quả xử lý một webhook (map sang phản hồi riêng của từng cổng) */
export type WebhookOutcome = 'ok' | 'duplicate' | 'already_confirmed' | 'invalid_signature' | 'invalid_payload' | 'order_not_found' | 'amount_mismatch' | 'error';

export interface WebhookAck {
  status: number;
  body: unknown;
}

export interface QueryStatusInput {
  merchantRef: string;
  createdAt: Date;
  amount: number;
  providerTxnId?: string | null;
  ipAddress?: string;
  /** Dữ liệu đã lưu lúc tạo thanh toán (payments.raw_callback.init) */
  init?: Record<string, unknown> | null;
}

export interface ReturnVerification {
  valid: boolean;
  merchantRef: string | null;
  /** Trạng thái cổng báo trên URL trả về (chỉ để hiển thị, KHÔNG cấp quyền) */
  displayStatus: ProviderPaymentStatus | null;
}

export interface PaymentProvider {
  readonly code: ProviderCode;
  readonly dbProvider: DbPaymentProvider;
  readonly methods: readonly PaymentMethod[];
  /** Phiên bản API/tài liệu tham chiếu */
  readonly apiVersion: string;
  readonly sandbox: boolean;
  /** Đủ credential/cấu hình */
  available(): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyWebhook(input: WebhookInput): boolean;
  parseWebhook(input: WebhookInput): ParsedWebhook;
  ack(outcome: WebhookOutcome): WebhookAck;
  verifyReturn(query: Record<string, string>): ReturnVerification;
  queryStatus(input: QueryStatusInput): Promise<ParsedWebhook | null>;
  /** TODO(S8): hoàn tiền tự động qua API cổng (VNPay refund 02/03, MoMo /v2/gateway/api/refund, ZaloPay /v2/refund) */
  refund?(input: { merchantRef: string; providerTxnId: string; amount: number; reason: string }): Promise<{ accepted: boolean; providerRefundId: string | null }>;
}

/** Lỗi gọi cổng (mạng, mã lỗi) – controller trả 502 `payment_failed` */
export class PaymentProviderError extends Error {
  constructor(
    readonly provider: ProviderCode,
    readonly providerCode: string,
    message: string,
  ) {
    super(message);
  }
}

/** HTTP client tối thiểu (tương thích fetch) – test thay bằng giả lập */
export interface HttpResponseLike {
  status: number;
  text(): Promise<string>;
}
export type HttpClient = (url: string, init: { method: 'POST' | 'GET'; headers: Record<string, string>; body?: string; timeoutMs: number }) => Promise<HttpResponseLike>;

export const defaultHttpClient: HttpClient = (url, init) =>
  // S11: span + histogram theo host cổng (không ghi query/body có chữ ký)
  observeOutbound('payment', url, init.method, async () => {
    const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(init.timeoutMs) });
    return { status: res.status, text: () => res.text() };
  });

/** Chuỗi từ giá trị vô hướng của JSON cổng (số/chuỗi/bool); object/null/undefined → '' */
export function scalar(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : '';
}

/** Mã GD cổng: chuỗi/số khác rỗng và khác 0 → chuỗi, ngược lại null */
export function txnIdOf(v: unknown): string | null {
  const s = scalar(v);
  return s && s !== '0' ? s : null;
}

/** Mô tả đơn ASCII an toàn cho mọi cổng (VNPay: không dấu, không ký tự đặc biệt) */
export function asciiDescription(text: string, max = 200): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 .:_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
