import { createHash } from 'node:crypto';
import { EInvoiceError, stripVietnamese, type EInvoiceProvider, type InvoiceIssueInput, type InvoiceIssueResult, type InvoiceRef, type InvoiceStatusResult } from './einvoice-provider.js';
import { buildSimplePdf, type PdfLine } from './minimal-pdf.js';

interface MockInvoice {
  input: InvoiceIssueInput;
  result: InvoiceIssueResult;
  status: 'issued' | 'cancelled';
  cancelledAt?: Date;
  pdf: Buffer;
}

const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, '.');

/**
 * Nhà cung cấp hoá đơn giả (dev/test, Sprint 8): số hoá đơn tăng dần theo ký hiệu `1C26MAL` (MOCK), mã tra cứu băm từ refId,
 * PDF tối thiểu tự dựng (minimal-pdf.ts). Chống trùng theo refId (gọi lại trả hoá đơn cũ). Mô phỏng lỗi: `failNext(n)`
 * (n lần tiếp theo lỗi tạm thời) và `failAlways(true)`. Trạng thái giữ trong bộ nhớ process (khởi động lại: số hoá đơn đếm lại
 * từ 1, huỷ hoá đơn không còn trong bộ nhớ coi như thành công) – chỉ dùng dev/test.
 */
export class MockEInvoiceProvider implements EInvoiceProvider {
  readonly code = 'mock' as const;
  readonly available = true;
  private seq = 0;
  private readonly store = new Map<string, MockInvoice>();
  private failures = 0;
  private always = false;
  /** Số lần gọi issue (test) */
  issueCalls = 0;

  constructor(private readonly seller: { name: string; taxCode: string; address: string }) {}

  failNext(n: number): void {
    this.failures = n;
  }

  failAlways(on: boolean): void {
    this.always = on;
  }

  private maybeFail(op: string): void {
    if (this.always || this.failures > 0) {
      if (this.failures > 0) this.failures--;
      throw new EInvoiceError('mock_unavailable', `mock e-invoice provider unavailable (${op})`);
    }
  }

  async issue(input: InvoiceIssueInput): Promise<InvoiceIssueResult> {
    this.issueCalls++;
    this.maybeFail('issue');
    const existing = this.store.get(input.refId);
    if (existing) return existing.result;
    this.seq++;
    const invoiceNo = String(this.seq).padStart(8, '0');
    const lookupCode = createHash('sha256').update(`mock:${input.refId}`).digest('hex').slice(0, 12).toUpperCase();
    const result: InvoiceIssueResult = {
      providerRef: `MOCK-${input.refId}`,
      series: '1C26MAL',
      invoiceNo,
      lookupCode,
      lookupUrl: `https://einvoice.mock.allingo.dev/lookup?code=${lookupCode}`,
      issuedAt: input.issueDate,
      raw: { mock: true },
    };
    const pdf = this.render(input, result);
    this.store.set(input.refId, { input, result: { ...result, pdf }, status: 'issued', pdf });
    return { ...result, pdf };
  }

  private render(input: InvoiceIssueInput, r: InvoiceIssueResult, cancelled = false): Buffer {
    const b = input.buyer;
    const t = (s: string | null | undefined) => stripVietnamese(s ?? '');
    const lines: PdfLine[] = [
      { text: 'HOA DON GIA TRI GIA TANG (BAN THE HIEN - MOCK)', size: 14, bold: true, gap: 20 },
      { text: 'Ban dung thu - khong co gia tri phap ly', size: 9 },
      { text: `Ky hieu: ${r.series}   So: ${r.invoiceNo}   Ngay: ${input.issueDate.toISOString().slice(0, 10)}`, gap: 22 },
      { text: `Ma tra cuu: ${r.lookupCode}` },
      { text: `Don vi ban: ${t(this.seller.name)}   MST: ${this.seller.taxCode}`, bold: true, gap: 22 },
      { text: `Dia chi: ${t(this.seller.address)}` },
      { text: b.type === 'business' ? `Don vi mua: ${t(b.company)}   MST: ${b.taxCode ?? ''}` : `Nguoi mua: ${t(b.name) || 'Khach le'}`, bold: true, gap: 22 },
      ...(b.type === 'business' ? [{ text: `Dia chi: ${t(b.address)}` }] : []),
      { text: 'STT  Ten hang hoa, dich vu                         SL   Don gia        Thanh tien', bold: true, gap: 26 },
      ...input.lines.map((l, i) => ({ text: `${i + 1}    ${t(l.name).slice(0, 44).padEnd(44)}  ${l.quantity}    ${fmt(l.unitPrice).padStart(12)}   ${fmt(l.amountWithoutVat).padStart(12)}` })),
      { text: `Cong tien hang: ${fmt(input.subtotal)} VND`, gap: 22 },
      { text: `Chiet khau thuong mai: ${fmt(input.discount)} VND` },
      { text: `Thue suat GTGT: ${input.vatRate === 'KCT' ? 'KCT (khong chiu thue)' : `${input.vatRate}%`}   Tien thue: ${fmt(input.vatAmount)} VND` },
      { text: `Tong tien thanh toan: ${fmt(input.total)} VND`, bold: true },
      { text: `So tien bang chu: ${t(input.totalInWords)}` },
      ...(cancelled ? [{ text: '*** HOA DON DA HUY ***', size: 16, bold: true, gap: 30 }] : []),
    ];
    return buildSimplePdf(lines, { title: `Invoice ${r.series}-${r.invoiceNo}`, producer: 'Allingo MockEInvoiceProvider' });
  }

  async cancel(ref: InvoiceRef, _reason: string, at: Date): Promise<{ cancelledAt: Date; raw?: Record<string, unknown> }> {
    this.maybeFail('cancel');
    const inv = this.store.get(ref.refId);
    // Trạng thái mock chỉ trong bộ nhớ: sau khi khởi động lại không còn hoá đơn → coi như huỷ thành công (chỉ dev/test)
    if (!inv) return { cancelledAt: at, raw: { mock: true, state_lost: true } };
    if (inv.status !== 'cancelled') {
      inv.status = 'cancelled';
      inv.cancelledAt = at;
      inv.pdf = this.render(inv.input, inv.result, true);
    }
    return { cancelledAt: inv.cancelledAt!, raw: { mock: true } };
  }

  async getPdf(ref: InvoiceRef): Promise<Buffer> {
    const inv = this.store.get(ref.refId);
    if (!inv) throw new EInvoiceError('not_found', 'invoice not found', false);
    return inv.pdf;
  }

  async getStatus(ref: Pick<InvoiceRef, 'refId' | 'providerRef'>): Promise<InvoiceStatusResult> {
    const inv = this.store.get(ref.refId);
    if (!inv) return { status: 'not_found' };
    return { status: inv.status, invoiceNo: inv.result.invoiceNo, lookupCode: inv.result.lookupCode };
  }
}
