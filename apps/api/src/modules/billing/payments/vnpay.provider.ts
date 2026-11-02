import { randomUUID } from 'node:crypto';
import { decodeMerchantRef } from './merchant-ref.js';
import { hmacHex, parseVnDateTime, safeEqualHex, vnDateTime } from './crypto.js';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type HttpClient,
  type ParsedWebhook,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type QueryStatusInput,
  type ReturnVerification,
  type WebhookAck,
  type WebhookInput,
  type WebhookOutcome,
} from './payment-provider.js';

/**
 * VNPay – Cổng thanh toán VNPAY, API **2.1.0** (tài liệu "Tích hợp cổng thanh toán VNPAY" sandbox.vnpayment.vn/apis/docs,
 * mục "Thanh toán PAY", "IPN URL", "Truy vấn kết quả thanh toán (querydr)"; tham chiếu demo NodeJS chính thức `vnpay_nodejs`).
 *
 * - URL thanh toán: tham số `vnp_*` sắp xếp theo khoá tăng dần, giá trị `encodeURIComponent` với `%20` → `+`,
 *   nối `k=v&…` → `vnp_SecureHash = HMAC-SHA512(vnp_HashSecret, chuỗi)` (hex). `vnp_Amount` = số tiền VND × 100.
 * - IPN: VNPay gọi **GET** IPN URL với query; bỏ `vnp_SecureHash`/`vnp_SecureHashType`, ký lại như trên rồi so sánh.
 *   Thành công khi `vnp_ResponseCode = 00` VÀ `vnp_TransactionStatus = 00`; mã GD cổng = `vnp_TransactionNo`.
 *   Phản hồi JSON `{ RspCode, Message }`: 00 xác nhận · 01 không thấy đơn · 02 đơn đã xác nhận · 04 sai số tiền · 97 sai chữ ký · 99 lỗi khác.
 * - querydr: POST JSON tới merchant_webapi, `vnp_SecureHash = HMAC-SHA512(secret, RequestId|Version|Command|TmnCode|TxnRef|TransactionDate|CreateDate|IpAddr|OrderInfo)`;
 *   chữ ký phản hồi = HMAC-SHA512 của `ResponseId|Command|ResponseCode|Message|TmnCode|TxnRef|Amount|BankCode|PayDate|TransactionNo|TransactionType|TransactionStatus|OrderInfo|PromotionCode|PromotionAmount`.
 * CHƯA chạy với sandbox thật trong phiên (không có credential/mạng) – kiểm chứng bằng vector chữ ký tự tạo (test/fixtures/payments).
 */
export interface VnpayConfig {
  tmnCode?: string;
  hashSecret?: string;
  payUrl: string;
  apiUrl: string;
  timeoutMs: number;
}

const HASH_FIELDS = new Set(['vnp_SecureHash', 'vnp_SecureHashType']);
/** Hiệu lực URL thanh toán tối đa (phút) – không vượt quá hạn đơn */
const PAY_URL_TTL_MINUTES = 15;

/** Chuỗi ký VNPay 2.1.0: khoá tăng dần, giá trị encodeURIComponent (%20 → +), nối bằng & */
export function vnpaySignData(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => !HASH_FIELDS.has(k))
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? '').replace(/%20/g, '+')}`)
    .join('&');
}

export function vnpaySign(secret: string, params: Record<string, string>): string {
  return hmacHex('sha512', secret, vnpaySignData(params));
}

/** Trạng thái chuẩn hoá từ mã VNPay (24 = khách huỷ; 01 = GD chưa hoàn tất) */
export function vnpayStatus(responseCode: string | undefined, transactionStatus: string | undefined): ProviderPaymentStatus {
  if (responseCode === '00' && transactionStatus === '00') return 'paid';
  if (responseCode === '24') return 'cancelled';
  if (transactionStatus === '01') return 'pending';
  return 'failed';
}

const ACKS: Record<WebhookOutcome, WebhookAck> = {
  ok: { status: 200, body: { RspCode: '00', Message: 'Confirm Success' } },
  duplicate: { status: 200, body: { RspCode: '02', Message: 'Order already confirmed' } },
  already_confirmed: { status: 200, body: { RspCode: '02', Message: 'Order already confirmed' } },
  order_not_found: { status: 200, body: { RspCode: '01', Message: 'Order not found' } },
  amount_mismatch: { status: 200, body: { RspCode: '04', Message: 'Invalid amount' } },
  invalid_signature: { status: 400, body: { RspCode: '97', Message: 'Invalid Checksum' } },
  invalid_payload: { status: 400, body: { RspCode: '99', Message: 'Invalid request' } },
  error: { status: 200, body: { RspCode: '99', Message: 'Unknown error' } },
};

export class VnpayProvider implements PaymentProvider {
  readonly code = 'vnpay' as const;
  readonly dbProvider = 'vnpay' as const;
  readonly methods = ['redirect'] as const;
  readonly apiVersion = '2.1.0';

  constructor(
    private readonly cfg: VnpayConfig,
    private readonly http: () => HttpClient,
  ) {}

  get sandbox(): boolean {
    return this.cfg.payUrl.includes('sandbox');
  }

  available(): boolean {
    return !!this.cfg.tmnCode && !!this.cfg.hashSecret;
  }

  private secret(): string {
    if (!this.cfg.hashSecret || !this.cfg.tmnCode) throw new PaymentProviderError('vnpay', 'unavailable', 'VNPay credentials missing');
    return this.cfg.hashSecret;
  }

  /** Tham số URL thanh toán (đã gồm vnp_SecureHash) – tách hàm để test vector */
  buildPayParams(input: CreatePaymentInput): Record<string, string> {
    const expire = new Date(Math.min(input.expiresAt.getTime(), input.createdAt.getTime() + PAY_URL_TTL_MINUTES * 60_000));
    const params: Record<string, string> = {
      vnp_Version: this.apiVersion,
      vnp_Command: 'pay',
      vnp_TmnCode: this.cfg.tmnCode ?? '',
      vnp_Amount: String(Math.round(input.amount * 100)),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: input.merchantRef,
      vnp_OrderInfo: input.description,
      vnp_OrderType: 'other',
      vnp_Locale: input.locale === 'en' ? 'en' : 'vn',
      vnp_ReturnUrl: input.returnUrl,
      vnp_IpAddr: input.ipAddress || '127.0.0.1',
      vnp_CreateDate: vnDateTime(input.createdAt),
      vnp_ExpireDate: vnDateTime(expire),
    };
    params.vnp_SecureHash = vnpaySign(this.secret(), params);
    return params;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const params = this.buildPayParams(input);
    const qs = Object.keys(params)
      .filter((k) => k !== 'vnp_SecureHash')
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!).replace(/%20/g, '+')}`)
      .join('&');
    const redirectUrl = `${this.cfg.payUrl}?${qs}&vnp_SecureHash=${params.vnp_SecureHash}`;
    // vnp_CreateDate là vnp_TransactionDate bắt buộc của querydr
    return { method: 'redirect', redirectUrl, qrCode: null, deeplink: null, meta: { create_date: params.vnp_CreateDate, expire_date: params.vnp_ExpireDate, api_version: this.apiVersion } };
  }

  /** Tham số `vnp_*` dạng chuỗi (IPN là GET query; chấp nhận cả POST form/JSON) */
  private static vnp(src: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) if (k.startsWith('vnp_') && typeof v === 'string') out[k] = v;
    return out;
  }

  private paramsOf(input: WebhookInput): Record<string, string> {
    const body = input.method === 'POST' && input.body && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : {};
    return VnpayProvider.vnp({ ...input.query, ...body });
  }

  private verifyParams(p: Record<string, string>): boolean {
    if (!this.available() || !p.vnp_SecureHash) return false;
    if (p.vnp_TmnCode !== this.cfg.tmnCode) return false;
    return safeEqualHex(p.vnp_SecureHash, vnpaySign(this.secret(), p));
  }

  verifyWebhook(input: WebhookInput): boolean {
    return this.verifyParams(this.paramsOf(input));
  }

  parseWebhook(input: WebhookInput): ParsedWebhook {
    const p = this.paramsOf(input);
    if (!p.vnp_TxnRef || !p.vnp_Amount) throw new PaymentProviderError('vnpay', 'invalid_payload', 'missing vnp_TxnRef/vnp_Amount');
    const raw100 = Number(p.vnp_Amount);
    const amount = Number.isInteger(raw100) && raw100 % 100 === 0 ? raw100 / 100 : Number.NaN;
    const status = vnpayStatus(p.vnp_ResponseCode, p.vnp_TransactionStatus);
    const txn = p.vnp_TransactionNo && p.vnp_TransactionNo !== '0' ? p.vnp_TransactionNo : null;
    return { merchantRef: p.vnp_TxnRef, providerTxnId: txn, amount, currency: 'VND', status, providerCode: `${p.vnp_ResponseCode ?? ''}/${p.vnp_TransactionStatus ?? ''}`, message: null, paidAt: parseVnDateTime(p.vnp_PayDate), raw: { ...p } };
  }

  ack(outcome: WebhookOutcome): WebhookAck {
    return ACKS[outcome];
  }

  verifyReturn(query: Record<string, string>): ReturnVerification {
    const p = VnpayProvider.vnp(query);
    const valid = this.verifyParams(p);
    return { valid, merchantRef: decodeMerchantRef(p.vnp_TxnRef) ? (p.vnp_TxnRef ?? null) : null, displayStatus: valid ? vnpayStatus(p.vnp_ResponseCode, p.vnp_TransactionStatus) : null };
  }

  /** Thân yêu cầu querydr (đã ký) – tách hàm để test vector */
  buildQueryBody(input: QueryStatusInput, now = new Date(), requestId = randomUUID().replace(/-/g, '').slice(0, 32)): Record<string, string> {
    const transactionDate = typeof input.init?.create_date === 'string' ? input.init.create_date : vnDateTime(input.createdAt);
    const body: Record<string, string> = {
      vnp_RequestId: requestId,
      vnp_Version: this.apiVersion,
      vnp_Command: 'querydr',
      vnp_TmnCode: this.cfg.tmnCode ?? '',
      vnp_TxnRef: input.merchantRef,
      vnp_OrderInfo: `Query ${input.merchantRef}`,
      vnp_TransactionDate: transactionDate,
      vnp_CreateDate: vnDateTime(now),
      vnp_IpAddr: input.ipAddress || '127.0.0.1',
    };
    const data = [body.vnp_RequestId, body.vnp_Version, body.vnp_Command, body.vnp_TmnCode, body.vnp_TxnRef, body.vnp_TransactionDate, body.vnp_CreateDate, body.vnp_IpAddr, body.vnp_OrderInfo].join('|');
    body.vnp_SecureHash = hmacHex('sha512', this.secret(), data);
    return body;
  }

  /** Chữ ký phản hồi querydr */
  querySignature(r: Record<string, string>): string {
    const fields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];
    return hmacHex('sha512', this.secret(), fields.map((f) => r[f] ?? '').join('|'));
  }

  async queryStatus(input: QueryStatusInput): Promise<ParsedWebhook | null> {
    const body = this.buildQueryBody(input);
    const res = await this.http()(this.cfg.apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeoutMs: this.cfg.timeoutMs });
    if (res.status >= 500) throw new PaymentProviderError('vnpay', String(res.status), 'querydr upstream error');
    const r = JSON.parse(await res.text()) as Record<string, string>;
    if (r.vnp_ResponseCode === '91') return null; // không tìm thấy giao dịch
    if (r.vnp_ResponseCode !== '00') throw new PaymentProviderError('vnpay', r.vnp_ResponseCode ?? 'unknown', `querydr failed: ${r.vnp_Message ?? ''}`.slice(0, 200));
    if (!safeEqualHex(r.vnp_SecureHash, this.querySignature(r))) throw new PaymentProviderError('vnpay', 'invalid_signature', 'querydr response signature invalid');
    const raw100 = Number(r.vnp_Amount);
    const status: ProviderPaymentStatus = r.vnp_TransactionStatus === '00' ? 'paid' : r.vnp_TransactionStatus === '01' ? 'pending' : 'failed';
    return {
      merchantRef: r.vnp_TxnRef ?? input.merchantRef,
      providerTxnId: r.vnp_TransactionNo && r.vnp_TransactionNo !== '0' ? r.vnp_TransactionNo : null,
      amount: Number.isInteger(raw100) && raw100 % 100 === 0 ? raw100 / 100 : Number.NaN,
      currency: 'VND',
      status,
      providerCode: `${r.vnp_ResponseCode}/${r.vnp_TransactionStatus ?? ''}`,
      message: r.vnp_Message ?? null,
      paidAt: parseVnDateTime(r.vnp_PayDate),
      raw: { ...r, source: 'querydr' },
    };
  }
}
