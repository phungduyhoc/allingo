import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProviderCode } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { FeatureDisabled, NotFound } from '../../../shared/http/errors.js';
import { MockPaymentProvider } from './mock.provider.js';
import { MomoProvider } from './momo.provider.js';
import { defaultHttpClient, type HttpClient, type PaymentProvider } from './payment-provider.js';
import { VnpayProvider } from './vnpay.provider.js';
import { ZalopayProvider } from './zalopay.provider.js';

/**
 * Danh bạ cổng thanh toán (Sprint 7): cổng "khả dụng" = có trong PAYMENT_PROVIDERS VÀ đủ credential (mock: APP_ENV ≠ production).
 * Cổng không khả dụng không được liệt kê cho client; `/pay` với cổng đó → 503 `feature_disabled`, webhook → 404.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = getLogger({ component: 'billing.providers' });
  private http: HttpClient = defaultHttpClient;
  private readonly providers: Map<PaymentProviderCode, PaymentProvider>;
  private readonly enabled: Set<string>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.enabled = new Set(env.PAYMENT_PROVIDERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    const httpRef = () => this.http;
    const base = this.callbackBaseUrl();
    this.providers = new Map<PaymentProviderCode, PaymentProvider>([
      ['vnpay', new VnpayProvider({ tmnCode: env.VNPAY_TMN_CODE || undefined, hashSecret: env.VNPAY_HASH_SECRET || undefined, payUrl: env.VNPAY_PAY_URL, apiUrl: env.VNPAY_API_URL, timeoutMs: env.PAYMENT_HTTP_TIMEOUT_MS }, httpRef)],
      ['momo', new MomoProvider({ partnerCode: env.MOMO_PARTNER_CODE || undefined, accessKey: env.MOMO_ACCESS_KEY || undefined, secretKey: env.MOMO_SECRET_KEY || undefined, endpoint: env.MOMO_ENDPOINT, requestType: env.MOMO_REQUEST_TYPE, timeoutMs: env.PAYMENT_HTTP_TIMEOUT_MS }, httpRef)],
      ['zalopay', new ZalopayProvider({ appId: env.ZALOPAY_APP_ID || undefined, key1: env.ZALOPAY_KEY1 || undefined, key2: env.ZALOPAY_KEY2 || undefined, endpoint: env.ZALOPAY_ENDPOINT, timeoutMs: env.PAYMENT_HTTP_TIMEOUT_MS }, httpRef)],
      ['mock', new MockPaymentProvider({ secret: env.PAYMENT_MOCK_SECRET, checkoutBaseUrl: `${base}/v1/payments/mock/checkout`, enabled: env.APP_ENV !== 'production' })],
    ]);
    for (const code of this.enabled) {
      const p = this.providers.get(code as PaymentProviderCode);
      if (!p) this.logger.warn({ provider: code }, 'unknown payment provider in PAYMENT_PROVIDERS');
      else if (!p.available()) this.logger.warn({ provider: code }, 'payment provider enabled but credentials missing → unavailable');
    }
  }

  /** Gốc URL công khai mà cổng gọi về (IPN/return) */
  callbackBaseUrl(): string {
    return (this.env.PAYMENT_CALLBACK_BASE_URL || this.env.API_PUBLIC_URL).replace(/\/+$/, '');
  }

  ipnUrl(code: PaymentProviderCode): string {
    return `${this.callbackBaseUrl()}/v1/webhooks/payments/${code}`;
  }

  returnUrl(code: PaymentProviderCode): string {
    return `${this.callbackBaseUrl()}/v1/payments/return/${code}`;
  }

  isAvailable(code: string): boolean {
    const p = this.providers.get(code as PaymentProviderCode);
    return !!p && this.enabled.has(code) && p.available();
  }

  /** Cổng khả dụng theo thứ tự hiển thị */
  listAvailable(): PaymentProvider[] {
    return (['vnpay', 'momo', 'zalopay', 'mock'] as const).filter((c) => this.isAvailable(c)).map((c) => this.providers.get(c)!);
  }

  /** Cổng cho /pay (503 nếu không khả dụng) */
  require(code: string): PaymentProvider {
    if (!this.isAvailable(code)) throw new FeatureDisabled(`payments.${code}`);
    return this.providers.get(code as PaymentProviderCode)!;
  }

  /** Cổng cho webhook/return (404 nếu không khả dụng – không tiết lộ cấu hình) */
  forCallback(code: string): PaymentProvider {
    if (!this.isAvailable(code)) throw new NotFound('payment_provider', code);
    return this.providers.get(code as PaymentProviderCode)!;
  }

  /** Theo enum DB (đối soát/queryStatus của payments đã lưu) */
  byDbProvider(db: string): PaymentProvider | null {
    const code = db === 'manual' ? 'mock' : db;
    return this.isAvailable(code) ? this.providers.get(code as PaymentProviderCode)! : null;
  }

  mock(): MockPaymentProvider {
    return this.providers.get('mock') as MockPaymentProvider;
  }

  /** Test: thay HTTP client (không gọi mạng thật) */
  setHttpClient(client: HttpClient): () => void {
    const prev = this.http;
    this.http = client;
    return () => {
      this.http = prev;
    };
  }
}
