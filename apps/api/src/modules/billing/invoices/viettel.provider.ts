import { EInvoiceError, type EInvoiceProvider, type InvoiceIssueInput, type InvoiceIssueResult, type InvoiceRef, type InvoiceStatusResult } from './einvoice-provider.js';

export interface ViettelConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  supplierTaxCode?: string;
  templateCode: string;
  series: string;
}

/**
 * Viettel SInvoice – KHUNG (Sprint 8, ADR-0030): chỉ ánh xạ dữ liệu theo tài liệu "SInvoice API v2" công khai
 * (`POST {base}/InvoiceAPI/InvoiceWS/createInvoice/{supplierTaxCode}`, Basic auth, `generalInvoiceInfo` / `buyerInfo` /
 * `itemInfo` / `summarizeInfo`), CHƯA gọi mạng. Mọi thao tác ném `not_implemented` – chọn Viettel khi có hợp đồng thì hoàn thiện
 * (luồng ký, tải PDF `getInvoiceRepresentationFile`, huỷ `cancelTransactionInvoice`).
 */
export class ViettelSInvoiceProvider implements EInvoiceProvider {
  readonly code = 'viettel' as const;
  readonly available = false;

  constructor(private readonly cfg: ViettelConfig) {}

  /** Thân request createInvoice (tham khảo – chưa kiểm chứng) */
  static createInvoiceBody(input: InvoiceIssueInput, cfg: Pick<ViettelConfig, 'templateCode' | 'series'>): Record<string, unknown> {
    return {
      generalInvoiceInfo: { invoiceType: '1', templateCode: cfg.templateCode, invoiceSeries: cfg.series, currencyCode: 'VND', adjustmentType: '1', paymentStatus: true, transactionUuid: input.refId, invoiceIssuedDate: input.issueDate.getTime() },
      buyerInfo: { buyerName: input.buyer.name ?? '', buyerLegalName: input.buyer.company ?? '', buyerTaxCode: input.buyer.taxCode ?? '', buyerAddressLine: input.buyer.address ?? '', buyerEmail: input.buyer.email ?? '' },
      payments: [{ paymentMethodName: input.paymentMethod }],
      itemInfo: input.lines.map((l, i) => ({ lineNumber: i + 1, itemCode: l.code, itemName: l.name, unitName: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, itemTotalAmountWithoutTax: l.amountWithoutVat, taxPercentage: input.vatRate === 'KCT' ? -2 : Number(input.vatRate), taxAmount: l.vatAmount })),
      summarizeInfo: { totalAmountWithoutTax: input.totalWithoutVat, totalTaxAmount: input.vatAmount, totalAmountWithTax: input.total, totalAmountWithTaxInWords: input.totalInWords, discountAmount: input.discount },
    };
  }

  private notImplemented(): never {
    throw new EInvoiceError('not_implemented', `Viettel SInvoice adapter is a skeleton (S8) – ${this.cfg.baseUrl}`, false);
  }

  async issue(_input: InvoiceIssueInput): Promise<InvoiceIssueResult> {
    return this.notImplemented();
  }

  async cancel(_ref: InvoiceRef, _reason: string, _at: Date): Promise<{ cancelledAt: Date }> {
    return this.notImplemented();
  }

  async getPdf(_ref: InvoiceRef): Promise<Buffer> {
    return this.notImplemented();
  }

  async getStatus(_ref: Pick<InvoiceRef, 'refId' | 'providerRef'>): Promise<InvoiceStatusResult> {
    return this.notImplemented();
  }
}
