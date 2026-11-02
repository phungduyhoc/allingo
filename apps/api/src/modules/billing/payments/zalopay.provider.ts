import { decodeMerchantRef } from './merchant-ref.js';
import { hmacHex, safeEqualHex, vnYymmdd } from './crypto.js';
import {
  PaymentProviderError,
  scalar,
  txnIdOf,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type HttpClient,
  type ParsedWebhook,
  type PaymentProvider,
  type QueryStatusInput,
  type ReturnVerification,
  type WebhookAck,
  type WebhookInput,
  type WebhookOutcome,
} from './payment-provider.js';

/**
 * ZaloPay – **API v2** (docs.zalopay.vn/v2: "Tạo đơn hàng" `/v2/create`, "Callback", "Truy vấn trạng thái" `/v2/query`,
 * "Redirect"). Sandbox `https://sb-openapi.zalopay.vn`.
 *
 * - Tạo đơn: `mac = HMAC-SHA256(key1, app_id|app_trans_id|app_user|amount|app_time|embed_data|item)`;
 *   `app_trans_id` bắt đầu bằng `yymmdd_` (ngày GMT+7), ≤ 40 ký tự; `amount` VND nguyên.
 * - Callback (POST JSON `{ data, mac, type }`): `mac = HMAC-SHA256(key2, data)`; `data` là chuỗi JSON (zp_trans_id, amount…).
 *   Callback chỉ gửi khi thanh toán THÀNH CÔNG. Phản hồi `{ return_code, return_message }`: 1 thành công · 2 trùng zp_trans_id ·
 *   0 lỗi tạm (ZaloPay gọi lại tối đa 3 lần) · -1 mac không hợp lệ.
 * - Truy vấn: `mac = HMAC-SHA256(key1, app_id|app_trans_id|key1)`; `return_code` 1 đã thanh toán · 2 thất bại · 3 chưa thanh toán/đang xử lý.
 * - Redirect: `checksum = HMAC-SHA256(key2, appid|apptransid|pmcid|bankcode|amount|discountamount|status)`.
 * CHƯA chạy với sandbox thật trong phiên – kiểm chứng bằng vector chữ ký tự tạo.
 */
export interface ZalopayConfig {
  appId?: string;
  key1?: string;
  key2?: string;
  endpoint: string;
  timeoutMs: number;
}

const ACKS: Record<WebhookOutcome, WebhookAck> = {
  ok: { status: 200, body: { return_code: 1, return_message: 'success' } },
  duplicate: { status: 200, body: { return_code: 2, return_message: 'duplicate zp_trans_id' } },
  already_confirmed: { status: 200, body: { return_code: 2, return_message: 'order already confirmed' } },
  order_not_found: { status: 200, body: { return_code: -1, return_message: 'order not found' } },
  amount_mismatch: { status: 200, body: { return_code: -1, return_message: 'invalid amount' } },
  invalid_signature: { status: 400, body: { return_code: -1, return_message: 'mac not equal' } },
  invalid_payload: { status: 400, body: { return_code: -1, return_message: 'invalid data' } },
  error: { status: 200, body: { return_code: 0, return_message: 'internal error' } },
};

/** Tách mã tham chiếu Allingo khỏi app_trans_id `yymmdd_<ref>` */
export function refFromAppTransId(appTransId: string | undefined | null): string | null {
  if (!appTransId) return null;
  const i = appTransId.indexOf('_');
  return i === 6 ? appTransId.slice(7) : null;
}

export class ZalopayProvider implements PaymentProvider {
  readonly code = 'zalopay' as const;
  readonly dbProvider = 'zalopay' as const;
  readonly methods = ['redirect', 'qr'] as const;
  readonly apiVersion = 'v2';

  constructor(
    private readonly cfg: ZalopayConfig,
    private readonly http: () => HttpClient,
  ) {}

  get sandbox(): boolean {
    return this.cfg.endpoint.includes('sb-openapi');
  }

  available(): boolean {
    return !!this.cfg.appId && !!this.cfg.key1 && !!this.cfg.key2;
  }

  private keys(): { appId: string; key1: string; key2: string } {
    if (!this.available()) throw new PaymentProviderError('zalopay', 'unavailable', 'ZaloPay credentials missing');
    return { appId: this.cfg.appId!, key1: this.cfg.key1!, key2: this.cfg.key2! };
  }

  appTransId(merchantRef: string, createdAt: Date): string {
    return `${vnYymmdd(createdAt)}_${merchantRef}`;
  }

  /** Tham số tạo đơn (đã có mac) – tách hàm để test vector */
  buildCreateParams(input: CreatePaymentInput): Record<string, string> {
    const k = this.keys();
    const p: Record<string, string> = {
      app_id: k.appId,
      app_user: input.userRef,
      app_trans_id: this.appTransId(input.merchantRef, input.createdAt),
      app_time: String(input.createdAt.getTime()),
      expire_duration_seconds: String(Math.max(300, Math.floor((input.expiresAt.getTime() - input.createdAt.getTime()) / 1000))),
      amount: String(Math.round(input.amount)),
      item: '[]',
      description: input.description,
      embed_data: JSON.stringify({ redirecturl: input.returnUrl }),
      bank_code: '',
      callback_url: input.ipnUrl,
    };
    p.mac = hmacHex('sha256', k.key1, [p.app_id, p.app_trans_id, p.app_user, p.amount, p.app_time, p.embed_data, p.item].join('|'));
    return p;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const p = this.buildCreateParams(input);
    const res = await this.http()(`${this.cfg.endpoint}/v2/create`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p).toString(), timeoutMs: this.cfg.timeoutMs });
    const text = await res.text();
    let r: Record<string, unknown> = {};
    try {
      r = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new PaymentProviderError('zalopay', String(res.status), 'create: invalid JSON response');
    }
    if (Number(r.return_code) !== 1 || typeof r.order_url !== 'string') throw new PaymentProviderError('zalopay', `${scalar(r.return_code) || String(res.status)}/${scalar(r.sub_return_code)}`, `create failed: ${scalar(r.sub_return_message) || scalar(r.return_message)}`.slice(0, 200));
    return { method: 'redirect', redirectUrl: r.order_url, qrCode: typeof r.qr_code === 'string' ? r.qr_code : null, deeplink: null, meta: { app_trans_id: p.app_trans_id, app_time: p.app_time, api_version: this.apiVersion } };
  }

  private envelope(input: WebhookInput): { data: string; mac: string } | null {
    const b = input.body as Record<string, unknown> | null;
    if (!b || typeof b.data !== 'string' || typeof b.mac !== 'string') return null;
    return { data: b.data, mac: b.mac };
  }

  verifyWebhook(input: WebhookInput): boolean {
    const e = this.envelope(input);
    if (!e || !this.available()) return false;
    return safeEqualHex(e.mac, hmacHex('sha256', this.keys().key2, e.data));
  }

  parseWebhook(input: WebhookInput): ParsedWebhook {
    const e = this.envelope(input);
    if (!e) throw new PaymentProviderError('zalopay', 'invalid_payload', 'missing data/mac');
    const d = JSON.parse(e.data) as Record<string, unknown>;
    const ref = refFromAppTransId(typeof d.app_trans_id === 'string' ? d.app_trans_id : null);
    if (!ref) throw new PaymentProviderError('zalopay', 'invalid_payload', 'invalid app_trans_id');
    if (scalar(d.app_id) !== String(this.cfg.appId)) throw new PaymentProviderError('zalopay', 'invalid_payload', 'app_id mismatch');
    const amount = Number(d.amount);
    const st = Number(d.server_time);
    // Callback chỉ được gửi khi giao dịch thành công (tài liệu Callback v2)
    return { merchantRef: ref, providerTxnId: txnIdOf(d.zp_trans_id), amount: Number.isInteger(amount) ? amount : Number.NaN, currency: 'VND', status: 'paid', providerCode: 'callback', message: null, paidAt: Number.isFinite(st) && st > 0 ? new Date(st) : null, raw: { ...d, type: (input.body as Record<string, unknown>).type ?? null } };
  }

  ack(outcome: WebhookOutcome): WebhookAck {
    return ACKS[outcome];
  }

  /** checksum của URL redirect */
  returnChecksum(q: Record<string, string>): string {
    return hmacHex('sha256', this.keys().key2, [q.appid, q.apptransid, q.pmcid, q.bankcode, q.amount, q.discountamount, q.status].map((x) => x ?? '').join('|'));
  }

  verifyReturn(query: Record<string, string>): ReturnVerification {
    const ref = refFromAppTransId(query.apptransid);
    const valid = this.available() && typeof query.checksum === 'string' && safeEqualHex(query.checksum, this.returnChecksum(query));
    return { valid, merchantRef: decodeMerchantRef(ref) ? ref : null, displayStatus: valid ? (query.status === '1' ? 'paid' : 'failed') : null };
  }

  buildQueryParams(appTransId: string): Record<string, string> {
    const k = this.keys();
    return { app_id: k.appId, app_trans_id: appTransId, mac: hmacHex('sha256', k.key1, `${k.appId}|${appTransId}|${k.key1}`) };
  }

  async queryStatus(input: QueryStatusInput): Promise<ParsedWebhook | null> {
    const appTransId = typeof input.init?.app_trans_id === 'string' ? input.init.app_trans_id : this.appTransId(input.merchantRef, input.createdAt);
    const res = await this.http()(`${this.cfg.endpoint}/v2/query`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(this.buildQueryParams(appTransId)).toString(), timeoutMs: this.cfg.timeoutMs });
    if (res.status >= 500) throw new PaymentProviderError('zalopay', String(res.status), 'query upstream error');
    const r = JSON.parse(await res.text()) as Record<string, unknown>;
    const code = Number(r.return_code);
    const amount = Number(r.amount);
    const status = code === 1 ? 'paid' : code === 2 ? 'failed' : 'pending';
    // -49 / sub_return_code âm: không tìm thấy đơn
    if (code !== 1 && code !== 2 && code !== 3) return null;
    return { merchantRef: input.merchantRef, providerTxnId: txnIdOf(r.zp_trans_id), amount: Number.isInteger(amount) ? amount : Number.NaN, currency: 'VND', status, providerCode: `${code}/${scalar(r.sub_return_code)}`, message: typeof r.return_message === 'string' ? r.return_message : null, paidAt: null, raw: { ...r, app_trans_id: appTransId, source: 'query' } };
  }
}
