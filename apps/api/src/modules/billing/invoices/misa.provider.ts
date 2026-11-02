import { EInvoiceError, fetchInvoiceHttp, type EInvoiceProvider, type InvoiceHttpClient, type InvoiceIssueInput, type InvoiceIssueResult, type InvoiceRef, type InvoiceStatusResult } from './einvoice-provider.js';

export interface MisaConfig {
  baseUrl: string;
  appId?: string;
  taxCode?: string;
  username?: string;
  password?: string;
  series: string;
  signType: number;
  timeoutMs: number;
}

/** Đọc khoá không phân biệt hoa thường (tài liệu MISA dùng cả `Success`/`success`) */
function pick<T = unknown>(o: Record<string, unknown> | null | undefined, key: string): T | undefined {
  if (!o) return undefined;
  const k = Object.keys(o).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : (o[k] as T);
}

/** `Data` của MISA thường là CHUỖI JSON (mảng) – parse an toàn */
function parseData<T>(data: unknown): T | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'string') return data as T;
  try {
    return JSON.parse(data) as T;
  } catch {
    return data as unknown as T;
  }
}

const VAT_NAME: Record<string, string> = { KCT: 'KCT', '0': '0%', '5': '5%', '8': '8%', '10': '10%' };
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * MISA meInvoice – API tích hợp v2 (Sprint 8, ADR-0030 Proposed). Viết theo tài liệu công khai "meInvoice API integration"
 * (bản 2024, base `https://testapi.meinvoice.vn/api/integration`) từ hiểu biết – CHƯA chạy với tài khoản test thật.
 * Luồng: `POST /auth/token` {appid, taxcode, username, password} → Bearer token (cache 12 giờ) → `POST /invoice`
 * {SignType, InvoiceData[], PublishInvoiceData} (tạo + ký HSM + phát hành) → `Data` = chuỗi JSON [{RefID, TransactionID,
 * InvNo, InvCode, ErrorCode}]; PDF `POST /invoice/download?downloadDataType=pdf` [TransactionID]; huỷ `POST /invoice/cancel`;
 * trạng thái `POST /invoice/status?invoiceWithCode=true` [TransactionID]. Cần xác nhận khi có tài khoản: tên trường chính xác
 * của bản ghi trả về, mã lỗi trùng RefID, giới hạn ký hiệu/kiểu ký (runbook invoices §2).
 */
export class MisaMeInvoiceProvider implements EInvoiceProvider {
  readonly code = 'misa' as const;
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly cfg: MisaConfig,
    private http: InvoiceHttpClient = fetchInvoiceHttp,
  ) {}

  get available(): boolean {
    return !!(this.cfg.appId && this.cfg.taxCode && this.cfg.username && this.cfg.password);
  }

  setHttpClient(h: InvoiceHttpClient): void {
    this.http = h;
  }

  private url(path: string): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async call(path: string, body: unknown, auth = true): Promise<unknown> {
    if (!this.available) throw new EInvoiceError('not_configured', 'MISA meInvoice credentials missing', false);
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (auth) headers.authorization = `Bearer ${await this.getToken()}`;
    let res: { status: number; text(): Promise<string> };
    try {
      res = await this.http(this.url(path), { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: this.cfg.timeoutMs });
    } catch (err) {
      throw new EInvoiceError('network', `MISA request failed: ${(err as Error).message.slice(0, 120)}`);
    }
    const text = await res.text();
    if (res.status === 401 && auth) this.token = null;
    if (res.status >= 500 || res.status === 429) throw new EInvoiceError(`http_${res.status}`, `MISA HTTP ${res.status}`);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new EInvoiceError(`http_${res.status}`, 'MISA returned a non-JSON response');
    }
    const ok = pick<boolean>(json, 'success');
    if (!ok) {
      const code = String(pick(json, 'errorCode') ?? pick(json, 'descriptionErrorCode') ?? `http_${res.status}`);
      // Lỗi dữ liệu (thiếu/sai trường) không tự hết khi thử lại – vẫn để backoff nhưng đánh dấu non-retryable cho admin
      throw new EInvoiceError(code, `MISA error ${code}`, !/invalid|required|duplicate|notfound/i.test(code));
    }
    return pick(json, 'data');
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const data = await this.call('/auth/token', { appid: this.cfg.appId, taxcode: this.cfg.taxCode, username: this.cfg.username, password: this.cfg.password }, false);
    const value = typeof data === 'string' ? data : String(pick(data as Record<string, unknown>, 'token') ?? '');
    if (!value) throw new EInvoiceError('auth_failed', 'MISA token missing');
    this.token = { value, until: Date.now() + 12 * 3600_000 };
    return value;
  }

  /** Bản ghi InvoiceData theo tài liệu MISA (tách riêng để test ánh xạ trường) */
  static invoiceData(input: InvoiceIssueInput, series: string): Record<string, unknown> {
    const b = input.buyer;
    const vatName = VAT_NAME[input.vatRate] ?? 'KCT';
    return {
      RefID: input.refId,
      InvSeries: series,
      InvDate: ymd(input.issueDate),
      CurrencyCode: input.currency,
      ExchangeRate: 1,
      PaymentMethodName: input.paymentMethod,
      IsSendEmail: false,
      BuyerLegalName: b.type === 'business' ? (b.company ?? '') : '',
      BuyerTaxCode: b.type === 'business' ? (b.taxCode ?? '') : '',
      BuyerAddress: b.address ?? '',
      BuyerFullName: b.name ?? (b.type === 'personal' ? 'Khách lẻ' : ''),
      BuyerEmail: b.email ?? '',
      TotalSaleAmountOC: input.subtotal,
      TotalSaleAmount: input.subtotal,
      TotalDiscountAmountOC: input.discount,
      TotalDiscountAmount: input.discount,
      TotalAmountWithoutVATOC: input.totalWithoutVat,
      TotalAmountWithoutVAT: input.totalWithoutVat,
      TotalVATAmountOC: input.vatAmount,
      TotalVATAmount: input.vatAmount,
      TotalAmountOC: input.total,
      TotalAmount: input.total,
      TotalAmountInWords: input.totalInWords,
      OriginalInvoiceDetail: input.lines.map((l, i) => ({
        ItemType: 1,
        LineNumber: i + 1,
        SortOrder: i + 1,
        ItemCode: l.code,
        ItemName: l.name,
        UnitName: l.unit,
        Quantity: l.quantity,
        UnitPrice: l.unitPrice,
        AmountOC: l.quantity * l.unitPrice,
        Amount: l.quantity * l.unitPrice,
        DiscountRate: 0,
        DiscountAmountOC: l.quantity * l.unitPrice - l.amountWithoutVat,
        AmountWithoutVATOC: l.amountWithoutVat,
        VATRateName: vatName,
        VATAmountOC: l.vatAmount,
      })),
      TaxRateInfo: [{ VATRateName: vatName, AmountWithoutVATOC: input.totalWithoutVat, VATAmountOC: input.vatAmount }],
      OptionUserDefined: { MainCurrency: 'VND', AmountDecimalDigits: '0', QuantityDecimalDigits: '0', UnitPriceDecimalDigits: '0' },
    };
  }

  async issue(input: InvoiceIssueInput): Promise<InvoiceIssueResult> {
    const data = await this.call('/invoice', { SignType: this.cfg.signType, InvoiceData: [MisaMeInvoiceProvider.invoiceData(input, this.cfg.series)], PublishInvoiceData: null });
    const list = parseData<Array<Record<string, unknown>>>(data) ?? [];
    const r = Array.isArray(list) ? list.find((x) => pick(x, 'refId') === input.refId) ?? list[0] : null;
    if (!r) throw new EInvoiceError('empty_result', 'MISA returned no invoice result');
    const err = pick<string | null>(r, 'errorCode');
    if (err) {
      // Trùng RefID (đã phát hành ở lần trước nhưng phản hồi bị mất) → tra trạng thái theo TransactionID nếu có
      const tx = pick<string>(r, 'transactionId');
      if (/duplicate/i.test(err) && tx) return { providerRef: tx, series: this.cfg.series, invoiceNo: (pick<string>(r, 'invNo') ?? null) || null, lookupCode: tx, lookupUrl: `https://www.meinvoice.vn/tra-cuu/?sc=${encodeURIComponent(tx)}`, issuedAt: input.issueDate, raw: { duplicate: true } };
      throw new EInvoiceError(err, `MISA invoice error ${err}`, !/invalid|required/i.test(err));
    }
    const transactionId = String(pick(r, 'transactionId') ?? '');
    if (!transactionId) throw new EInvoiceError('empty_result', 'MISA result without TransactionID');
    return {
      providerRef: transactionId,
      series: String(pick(r, 'invSeries') ?? this.cfg.series),
      invoiceNo: (pick<string>(r, 'invNo') ?? null) || null,
      lookupCode: transactionId,
      lookupUrl: `https://www.meinvoice.vn/tra-cuu/?sc=${encodeURIComponent(transactionId)}`,
      issuedAt: input.issueDate,
      raw: { inv_code: pick(r, 'invCode') ?? null },
    };
  }

  async cancel(ref: InvoiceRef, reason: string, at: Date): Promise<{ cancelledAt: Date; raw?: Record<string, unknown> }> {
    await this.call('/invoice/cancel', { TransactionID: ref.providerRef, InvNo: ref.invoiceNo, RefDate: ymd(ref.issuedAt ?? at), CancelReason: reason.slice(0, 255) });
    return { cancelledAt: at };
  }

  async getPdf(ref: InvoiceRef): Promise<Buffer> {
    const data = await this.call('/invoice/download?downloadDataType=pdf', [ref.providerRef]);
    const list = parseData<Array<Record<string, unknown>>>(data) ?? [];
    const item = Array.isArray(list) ? list.find((x) => pick(x, 'transactionId') === ref.providerRef) ?? list[0] : null;
    const b64 = item ? pick<string>(item, 'data') : typeof data === 'string' ? data : undefined;
    if (!b64) throw new EInvoiceError('pdf_missing', 'MISA returned no PDF data');
    return Buffer.from(b64, 'base64');
  }

  async getStatus(ref: Pick<InvoiceRef, 'refId' | 'providerRef'>): Promise<InvoiceStatusResult> {
    const data = await this.call('/invoice/status?invoiceWithCode=true', [ref.providerRef]);
    const list = parseData<Array<Record<string, unknown>>>(data) ?? [];
    const item = Array.isArray(list) ? list[0] : null;
    if (!item) return { status: 'not_found' };
    const publish = Number(pick(item, 'publishStatus') ?? pick(item, 'eInvoiceStatus') ?? -1);
    const cancelled = !!pick(item, 'isCancel') || publish === 3;
    return { status: cancelled ? 'cancelled' : publish === 1 || publish === 2 ? 'issued' : 'pending', invoiceNo: (pick<string>(item, 'invNo') ?? null) || null, raw: { publish_status: publish } };
  }
}
