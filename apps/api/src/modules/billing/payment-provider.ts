/**
 * Giao diện cổng thanh toán webhook-first (ADR-0012). Sprint 0 chỉ có MockPaymentProvider; VNPay/MoMo/ZaloPay ở Sprint 7.
 */
export interface CreatePaymentInput {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  ipAddress?: string;
}
export interface CreatePaymentResult {
  provider: string;
  redirectUrl?: string;
  qrContent?: string;
  deeplink?: string;
  providerRef?: string;
}
export interface ParsedWebhook {
  orderId: string;
  providerTxnId: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'cancelled';
  raw: Record<string, unknown>;
}
export interface PaymentProvider {
  readonly code: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): boolean;
  parseWebhook(body: unknown): ParsedWebhook;
  queryStatus(orderId: string): Promise<ParsedWebhook | null>;
}

/** Cổng giả lập cho dev/test: thanh toán thành công ngay khi gọi webhook với secret 'mock' */
export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'manual';
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { provider: this.code, redirectUrl: `${input.returnUrl}?mock=1&order_id=${input.orderId}`, providerRef: `mock-${input.orderId}` };
  }
  verifyWebhook(headers: Record<string, string | string[] | undefined>): boolean {
    return headers['x-mock-signature'] === 'mock';
  }
  parseWebhook(body: unknown): ParsedWebhook {
    const b = body as Partial<ParsedWebhook>;
    return { orderId: b.orderId ?? '', providerTxnId: b.providerTxnId ?? `mock-${b.orderId}`, amount: b.amount ?? 0, currency: b.currency ?? 'VND', status: b.status ?? 'paid', raw: (body as Record<string, unknown>) ?? {} };
  }
  async queryStatus(): Promise<ParsedWebhook | null> {
    return null;
  }
}
