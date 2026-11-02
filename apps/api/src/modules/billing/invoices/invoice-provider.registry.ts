import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import type { EInvoiceProvider, EInvoiceProviderCode, InvoiceHttpClient } from './einvoice-provider.js';
import { MisaMeInvoiceProvider } from './misa.provider.js';
import { MockEInvoiceProvider } from './mock.provider.js';
import { ViettelSInvoiceProvider } from './viettel.provider.js';

/**
 * Chọn nhà cung cấp hoá đơn theo EINVOICE_PROVIDER (S8). mock bị chặn ở production; provider thiếu credential vẫn được
 * chọn (job ghi lỗi `not_configured` → thử lại/dead-letter, admin thấy trong dead-letter) – không âm thầm dùng mock.
 */
@Injectable()
export class InvoiceProviderRegistry {
  private readonly logger = getLogger({ component: 'billing.invoices' });
  private readonly providers = new Map<EInvoiceProviderCode, EInvoiceProvider>();
  readonly activeCode: EInvoiceProviderCode;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.providers.set('mock', new MockEInvoiceProvider({ name: env.EINVOICE_SELLER_NAME, taxCode: env.EINVOICE_SELLER_TAX_CODE, address: env.EINVOICE_SELLER_ADDRESS }));
    this.providers.set(
      'misa',
      new MisaMeInvoiceProvider({ baseUrl: env.MISA_MEINVOICE_BASE_URL, appId: env.MISA_MEINVOICE_APP_ID, taxCode: env.MISA_MEINVOICE_TAX_CODE, username: env.MISA_MEINVOICE_USERNAME, password: env.MISA_MEINVOICE_PASSWORD, series: env.MISA_MEINVOICE_INV_SERIES, signType: env.MISA_MEINVOICE_SIGN_TYPE, timeoutMs: env.EINVOICE_HTTP_TIMEOUT_MS }),
    );
    this.providers.set('viettel', new ViettelSInvoiceProvider({ baseUrl: env.VIETTEL_SINVOICE_BASE_URL, username: env.VIETTEL_SINVOICE_USERNAME, password: env.VIETTEL_SINVOICE_PASSWORD, supplierTaxCode: env.EINVOICE_SELLER_TAX_CODE, templateCode: env.VIETTEL_SINVOICE_TEMPLATE_CODE, series: env.VIETTEL_SINVOICE_INV_SERIES }));
    if (env.EINVOICE_PROVIDER === 'mock' && env.APP_ENV === 'production') throw new Error('EINVOICE_PROVIDER=mock is not allowed in production');
    this.activeCode = env.EINVOICE_PROVIDER;
    const active = this.active();
    if (!active.available) this.logger.warn({ provider: active.code }, 'e-invoice provider not configured – invoices will fail and go to dead-letter');
  }

  active(): EInvoiceProvider {
    return this.providers.get(this.activeCode)!;
  }

  /** Provider đã phát hành một hoá đơn (huỷ/tải lại PDF dùng đúng provider của hoá đơn) */
  byCode(code: string): EInvoiceProvider | null {
    return this.providers.get(code as EInvoiceProviderCode) ?? null;
  }

  mock(): MockEInvoiceProvider {
    return this.providers.get('mock') as MockEInvoiceProvider;
  }

  /** Test: HTTP giả cho MISA */
  setMisaHttpClient(h: InvoiceHttpClient): void {
    (this.providers.get('misa') as MisaMeInvoiceProvider).setHttpClient(h);
  }
}
