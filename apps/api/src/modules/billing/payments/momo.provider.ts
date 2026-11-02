import { decodeMerchantRef } from './merchant-ref.js';
import { hmacHex, safeEqualHex } from './crypto.js';
import {
  PaymentProviderError,
  scalar,
  txnIdOf,
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
 * MoMo – Cổng thanh toán MoMo **AIO v2** ("One-time payment", developers.momo.vn/v3/docs/payment/api/wallet/onetime;
 * endpoint `/v2/gateway/api/create`, `/v2/gateway/api/query`; IPN mục "Payment Notification").
 *
 * - Chữ ký = HMAC-SHA256(secretKey, chuỗi RAW `k=v&…` theo ĐÚNG thứ tự trường tài liệu quy định – là thứ tự a→z, không encode):
 *   create: accessKey, amount, extraData, ipnUrl, orderId, orderInfo, partnerCode, redirectUrl, requestId, requestType
 *   IPN/redirect: accessKey, amount, extraData, message, orderId, orderInfo, orderType, partnerCode, payType, requestId, responseTime, resultCode, transId
 *   query: accessKey, orderId, partnerCode, requestId
 * - `amount` VND nguyên (1.000 – 50.000.000); `resultCode = 0` thành công; 1006 người dùng từ chối/huỷ; 1000/7000/7002 đang xử lý.
 * - IPN: merchant phản hồi **HTTP 204** trong 15 s (không cần body). Sai chữ ký → 400.
 * CHƯA chạy với sandbox thật trong phiên – kiểm chứng bằng vector chữ ký tự tạo.
 */
export interface MomoConfig {
  partnerCode?: string;
  accessKey?: string;
  secretKey?: string;
  endpoint: string;
  requestType: string;
  timeoutMs: number;
}

export const MOMO_CREATE_FIELDS = ['accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId', 'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType'] as const;
export const MOMO_IPN_FIELDS = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'] as const;
export const MOMO_QUERY_FIELDS = ['accessKey', 'orderId', 'partnerCode', 'requestId'] as const;

/** Chuỗi raw MoMo theo danh sách trường (giá trị nguyên văn, không encode) */
export function momoRaw(fields: readonly string[], values: Record<string, unknown>): string {
  return fields.map((f) => `${f}=${scalar(values[f])}`).join('&');
}

export function momoStatus(resultCode: number | string | undefined): ProviderPaymentStatus {
  const c = Number(resultCode);
  if (c === 0) return 'paid';
  if (c === 1006 || c === 49) return 'cancelled';
  if (c === 1000 || c === 7000 || c === 7002 || c === 9000) return 'pending';
  return 'failed';
}

const ACKS: Record<WebhookOutcome, WebhookAck> = {
  ok: { status: 204, body: null },
  duplicate: { status: 204, body: null },
  already_confirmed: { status: 204, body: null },
  order_not_found: { status: 204, body: null },
  amount_mismatch: { status: 204, body: null },
  invalid_signature: { status: 400, body: { resultCode: 97, message: 'Invalid signature' } },
  invalid_payload: { status: 400, body: { resultCode: 20, message: 'Bad format request' } },
  // 5xx → MoMo gửi lại IPN
  error: { status: 500, body: { resultCode: 99, message: 'Internal error' } },
};

export class MomoProvider implements PaymentProvider {
  readonly code = 'momo' as const;
  readonly dbProvider = 'momo' as const;
  readonly methods = ['redirect', 'qr', 'deeplink'] as const;
  readonly apiVersion = 'AIO v2 (/v2/gateway/api)';

  constructor(
    private readonly cfg: MomoConfig,
    private readonly http: () => HttpClient,
  ) {}

  get sandbox(): boolean {
    return this.cfg.endpoint.includes('test-payment');
  }

  available(): boolean {
    return !!this.cfg.partnerCode && !!this.cfg.accessKey && !!this.cfg.secretKey;
  }

  private keys(): { partnerCode: string; accessKey: string; secretKey: string } {
    if (!this.available()) throw new PaymentProviderError('momo', 'unavailable', 'MoMo credentials missing');
    return { partnerCode: this.cfg.partnerCode!, accessKey: this.cfg.accessKey!, secretKey: this.cfg.secretKey! };
  }

  sign(fields: readonly string[], values: Record<string, unknown>): string {
    const k = this.keys();
    return hmacHex('sha256', k.secretKey, momoRaw(fields, { ...values, accessKey: k.accessKey }));
  }

  /** Thân yêu cầu create (đã ký) – tách hàm để test vector */
  buildCreateBody(input: CreatePaymentInput, requestId = `${input.merchantRef}-${input.createdAt.getTime()}`): Record<string, unknown> {
    const k = this.keys();
    const minutes = Math.max(1, Math.min(100, Math.floor((input.expiresAt.getTime() - input.createdAt.getTime()) / 60_000)));
    const body: Record<string, unknown> = {
      partnerCode: k.partnerCode,
      partnerName: 'Allingo',
      storeId: 'Allingo',
      requestId,
      amount: Math.round(input.amount),
      orderId: input.merchantRef,
      orderInfo: input.description,
      redirectUrl: input.returnUrl,
      ipnUrl: input.ipnUrl,
      lang: input.locale,
      requestType: this.cfg.requestType,
      autoCapture: true,
      extraData: '',
      orderExpireTime: minutes,
    };
    body.signature = this.sign(MOMO_CREATE_FIELDS, body);
    return body;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const body = this.buildCreateBody(input);
    const res = await this.http()(`${this.cfg.endpoint}/v2/gateway/api/create`, { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body), timeoutMs: this.cfg.timeoutMs });
    const text = await res.text();
    let r: Record<string, unknown> = {};
    try {
      r = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new PaymentProviderError('momo', String(res.status), 'create: invalid JSON response');
    }
    if (Number(r.resultCode) !== 0 || typeof r.payUrl !== 'string') throw new PaymentProviderError('momo', scalar(r.resultCode) || String(res.status), `create failed: ${scalar(r.message)}`.slice(0, 200));
    const deeplink = typeof r.deeplink === 'string' ? r.deeplink : null;
    const qr = typeof r.qrCodeUrl === 'string' ? r.qrCodeUrl : null;
    return { method: 'redirect', redirectUrl: r.payUrl, qrCode: qr, deeplink, meta: { request_id: body.requestId, request_type: body.requestType, api_version: this.apiVersion } };
  }

  private bodyOf(input: WebhookInput): Record<string, unknown> {
    if (input.body && typeof input.body === 'object') return input.body as Record<string, unknown>;
    return input.query;
  }

  private verifyFields(b: Record<string, unknown>): boolean {
    if (!this.available() || typeof b.signature !== 'string') return false;
    if (b.partnerCode !== this.cfg.partnerCode) return false;
    return safeEqualHex(b.signature, this.sign(MOMO_IPN_FIELDS, b));
  }

  verifyWebhook(input: WebhookInput): boolean {
    return this.verifyFields(this.bodyOf(input));
  }

  parseWebhook(input: WebhookInput): ParsedWebhook {
    const b = this.bodyOf(input);
    if (typeof b.orderId !== 'string' || b.amount === undefined) throw new PaymentProviderError('momo', 'invalid_payload', 'missing orderId/amount');
    const amount = Number(b.amount);
    const transId = txnIdOf(b.transId);
    const rt = Number(b.responseTime);
    return {
      merchantRef: b.orderId,
      providerTxnId: transId,
      amount: Number.isInteger(amount) ? amount : Number.NaN,
      currency: 'VND',
      status: momoStatus(b.resultCode as number),
      providerCode: scalar(b.resultCode),
      message: typeof b.message === 'string' ? b.message.slice(0, 200) : null,
      paidAt: Number.isFinite(rt) && rt > 0 ? new Date(rt) : null,
      raw: { ...b },
    };
  }

  ack(outcome: WebhookOutcome): WebhookAck {
    return ACKS[outcome];
  }

  verifyReturn(query: Record<string, string>): ReturnVerification {
    const valid = this.verifyFields(query);
    return { valid, merchantRef: decodeMerchantRef(query.orderId) ? (query.orderId ?? null) : null, displayStatus: valid ? momoStatus(query.resultCode) : null };
  }

  buildQueryBody(merchantRef: string, requestId = `${merchantRef}-q${Date.now()}`): Record<string, unknown> {
    const k = this.keys();
    const body: Record<string, unknown> = { partnerCode: k.partnerCode, requestId, orderId: merchantRef, lang: 'vi' };
    body.signature = this.sign(MOMO_QUERY_FIELDS, body);
    return body;
  }

  async queryStatus(input: QueryStatusInput): Promise<ParsedWebhook | null> {
    const body = this.buildQueryBody(input.merchantRef);
    const res = await this.http()(`${this.cfg.endpoint}/v2/gateway/api/query`, { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body), timeoutMs: this.cfg.timeoutMs });
    if (res.status >= 500) throw new PaymentProviderError('momo', String(res.status), 'query upstream error');
    const r = JSON.parse(await res.text()) as Record<string, unknown>;
    const code = Number(r.resultCode);
    // 42: orderId không tồn tại / 1000: chờ xác nhận
    if (code === 42) return null;
    const amount = Number(r.amount);
    return {
      merchantRef: typeof r.orderId === 'string' ? r.orderId : input.merchantRef,
      providerTxnId: txnIdOf(r.transId),
      amount: Number.isInteger(amount) ? amount : Number.NaN,
      currency: 'VND',
      status: momoStatus(code),
      providerCode: scalar(r.resultCode),
      message: typeof r.message === 'string' ? r.message.slice(0, 200) : null,
      paidAt: Number(r.lastUpdated) > 0 ? new Date(Number(r.lastUpdated)) : null,
      raw: { ...r, source: 'query' },
    };
  }
}
