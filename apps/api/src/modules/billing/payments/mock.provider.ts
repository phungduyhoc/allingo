import { randomBytes } from 'node:crypto';
import { hmacHex, safeEqualHex } from './crypto.js';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatePaymentResult,
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
 * Cổng giả lập cho dev/test/E2E (bị chặn ở production). Mô phỏng một cổng thật:
 *  - `createPayment` → URL trang thanh toán giả `GET /v1/payments/mock/checkout?ref=…` (nút Thành công / Thất bại / Thành công nhưng mất webhook)
 *  - webhook JSON `{ ref, txn_id, amount, currency, status }` ký `x-mock-signature = HMAC-SHA256(PAYMENT_MOCK_SECRET, ref|txn_id|amount|currency|status)`
 *  - trạng thái phía "cổng" giữ trong bộ nhớ process → `queryStatus` trả về (test job payment.reconcile khi webhook mất)
 */
export interface MockWebhookPayload {
  ref: string;
  txn_id: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'cancelled';
}

export function mockSignatureData(p: MockWebhookPayload): string {
  return [p.ref, p.txn_id, p.amount, p.currency, p.status].join('|');
}

export function signMockWebhook(secret: string, p: MockWebhookPayload): string {
  return hmacHex('sha256', secret, mockSignatureData(p));
}

interface GatewayEntry {
  amount: number;
  status: ProviderPaymentStatus;
  txnId: string | null;
  returnUrl: string;
  createdAt: Date;
}

const ACKS: Record<WebhookOutcome, WebhookAck> = {
  ok: { status: 200, body: { ok: true, outcome: 'ok' } },
  duplicate: { status: 200, body: { ok: true, outcome: 'duplicate' } },
  already_confirmed: { status: 200, body: { ok: true, outcome: 'already_confirmed' } },
  order_not_found: { status: 200, body: { ok: false, outcome: 'order_not_found' } },
  amount_mismatch: { status: 200, body: { ok: false, outcome: 'amount_mismatch' } },
  invalid_signature: { status: 400, body: { ok: false, outcome: 'invalid_signature' } },
  invalid_payload: { status: 400, body: { ok: false, outcome: 'invalid_payload' } },
  error: { status: 500, body: { ok: false, outcome: 'error' } },
};

export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'mock' as const;
  readonly dbProvider = 'manual' as const;
  readonly methods = ['redirect'] as const;
  readonly apiVersion = 'mock-1';
  readonly sandbox = true;
  /** Trạng thái phía cổng giả (theo merchant ref) */
  private readonly gateway = new Map<string, GatewayEntry>();

  constructor(
    private readonly cfg: { secret: string; checkoutBaseUrl: string; enabled: boolean },
  ) {}

  available(): boolean {
    return this.cfg.enabled;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.cfg.enabled) throw new PaymentProviderError('mock', 'unavailable', 'mock provider disabled');
    this.gateway.set(input.merchantRef, { amount: input.amount, status: 'pending', txnId: null, returnUrl: input.returnUrl, createdAt: input.createdAt });
    const url = `${this.cfg.checkoutBaseUrl}?ref=${encodeURIComponent(input.merchantRef)}`;
    return { method: 'redirect', redirectUrl: url, qrCode: null, deeplink: null, meta: { api_version: this.apiVersion } };
  }

  /** Mô phỏng người dùng hoàn tất ở cổng → trả payload webhook đã ký (cổng sẽ gửi nếu không "mất webhook") */
  simulate(ref: string, outcome: 'paid' | 'failed' | 'cancelled', opts: { amount?: number } = {}): { payload: MockWebhookPayload; signature: string; returnUrl: string | null } {
    const entry = this.gateway.get(ref);
    const txn = `MOCK${randomBytes(6).toString('hex').toUpperCase()}`;
    const amount = opts.amount ?? entry?.amount ?? 0;
    this.gateway.set(ref, { amount, status: outcome, txnId: txn, returnUrl: entry?.returnUrl ?? '', createdAt: entry?.createdAt ?? new Date() });
    const payload: MockWebhookPayload = { ref, txn_id: txn, amount, currency: 'VND', status: outcome };
    return { payload, signature: signMockWebhook(this.cfg.secret, payload), returnUrl: entry?.returnUrl ?? null };
  }

  gatewayEntry(ref: string): GatewayEntry | null {
    return this.gateway.get(ref) ?? null;
  }

  verifyWebhook(input: WebhookInput): boolean {
    if (!this.cfg.enabled) return false;
    const sig = input.headers['x-mock-signature'];
    const b = input.body as Partial<MockWebhookPayload> | null;
    if (typeof sig !== 'string' || !b || typeof b.ref !== 'string' || typeof b.txn_id !== 'string') return false;
    return safeEqualHex(sig, signMockWebhook(this.cfg.secret, { ref: b.ref, txn_id: b.txn_id, amount: Number(b.amount), currency: String(b.currency ?? ''), status: b.status as MockWebhookPayload['status'] }));
  }

  parseWebhook(input: WebhookInput): ParsedWebhook {
    const b = input.body as MockWebhookPayload;
    if (!b || typeof b.ref !== 'string') throw new PaymentProviderError('mock', 'invalid_payload', 'missing ref');
    return { merchantRef: b.ref, providerTxnId: b.txn_id, amount: Number(b.amount), currency: b.currency, status: b.status, providerCode: b.status, message: null, paidAt: new Date(), raw: { ...b } };
  }

  ack(outcome: WebhookOutcome): WebhookAck {
    return ACKS[outcome];
  }

  verifyReturn(query: Record<string, string>): ReturnVerification {
    const entry = query.ref ? this.gateway.get(query.ref) : undefined;
    return { valid: !!entry, merchantRef: query.ref ?? null, displayStatus: entry?.status ?? null };
  }

  async queryStatus(input: QueryStatusInput): Promise<ParsedWebhook | null> {
    const e = this.gateway.get(input.merchantRef);
    if (!e) return null;
    return { merchantRef: input.merchantRef, providerTxnId: e.txnId, amount: e.amount, currency: 'VND', status: e.status, providerCode: e.status, message: null, paidAt: e.status === 'paid' ? new Date() : null, raw: { source: 'mock_query', status: e.status } };
  }
}
