import type { BuyerType } from '@allingo/schemas';
import { observeOutbound } from '../../../shared/telemetry/outbound.js';

/**
 * Hoá đơn điện tử (Sprint 8, ADR-0030 – Proposed): interface chung cho nhà cung cấp (MISA meInvoice mặc định, Viettel SInvoice
 * khung, Mock cho dev/test). Một đơn `paid` ↔ một hoá đơn; `refId` = order_id (nhà cung cấp chống trùng theo mã tham chiếu).
 * Không log thông tin người mua (tên/email/MST/địa chỉ – CLAUDE.md §9).
 */
export type EInvoiceProviderCode = 'misa' | 'viettel' | 'mock';

export type VatRate = 'KCT' | '0' | '5' | '8' | '10';

export interface InvoiceBuyer {
  type: BuyerType;
  /** Cá nhân: họ tên; doanh nghiệp: người mua hàng (tuỳ chọn) */
  name: string | null;
  email: string | null;
  /** MST đã chuẩn hoá (10 hoặc 13 số `0123456789-001`) – chỉ doanh nghiệp */
  taxCode: string | null;
  company: string | null;
  address: string | null;
}

export interface InvoiceLine {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  /** Thành tiền trước thuế (sau chiết khấu dòng) */
  amountWithoutVat: number;
  vatAmount: number;
  amount: number;
}

export interface InvoiceIssueInput {
  /** Mã tham chiếu duy nhất = order_id */
  refId: string;
  issueDate: Date;
  currency: 'VND';
  buyer: InvoiceBuyer;
  lines: InvoiceLine[];
  /** Tổng tiền hàng trước chiết khấu (= subtotal đơn) */
  subtotal: number;
  /** Chiết khấu thương mại (khuyến mãi) */
  discount: number;
  vatRate: VatRate;
  totalWithoutVat: number;
  vatAmount: number;
  /** Tổng thanh toán (= orders.total) */
  total: number;
  totalInWords: string;
  paymentMethod: string;
}

export interface InvoiceIssueResult {
  /** Mã giao dịch phía nhà cung cấp (TransactionID MISA) – dùng cho getPdf/cancel/getStatus */
  providerRef: string;
  series: string;
  invoiceNo: string | null;
  lookupCode: string | null;
  lookupUrl: string | null;
  issuedAt: Date;
  /** Nhà cung cấp trả kèm PDF (mock) – nếu không, gọi getPdf */
  pdf?: Buffer;
  raw?: Record<string, unknown>;
}

export interface InvoiceRef {
  refId: string;
  providerRef: string;
  series: string | null;
  invoiceNo: string | null;
  issuedAt: Date | null;
}

export interface InvoiceStatusResult {
  status: 'issued' | 'pending' | 'cancelled' | 'not_found' | 'error';
  invoiceNo?: string | null;
  lookupCode?: string | null;
  raw?: Record<string, unknown>;
}

export interface EInvoiceProvider {
  readonly code: EInvoiceProviderCode;
  /** Đủ cấu hình để gọi thật (mock luôn true) */
  readonly available: boolean;
  issue(input: InvoiceIssueInput): Promise<InvoiceIssueResult>;
  cancel(ref: InvoiceRef, reason: string, at: Date): Promise<{ cancelledAt: Date; raw?: Record<string, unknown> }>;
  getPdf(ref: InvoiceRef): Promise<Buffer>;
  getStatus(ref: Pick<InvoiceRef, 'refId' | 'providerRef'>): Promise<InvoiceStatusResult>;
}

/** Lỗi từ nhà cung cấp – `retryable = false` (vd dữ liệu người mua sai) vẫn thử lại theo backoff nhưng ghi rõ mã để admin sửa */
export class EInvoiceError extends Error {
  constructor(
    readonly providerCode: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'EInvoiceError';
  }
}

/** HTTP tối giản (fetch) – test thay bằng HTTP giả */
export type InvoiceHttpClient = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; timeoutMs: number }) => Promise<{ status: number; text(): Promise<string> }>;

export const fetchInvoiceHttp: InvoiceHttpClient = (url, init) =>
  observeOutbound('einvoice', url, init.method, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs);
    try {
      const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctrl.signal });
      return { status: r.status, text: () => r.text() };
    } finally {
      clearTimeout(timer);
    }
  });

// ----------------------------------------------------------------------------- tiền & thuế (thuần)
/**
 * Tách thuế từ tổng đã gồm thuế (giá bán Allingo luôn là giá cuối): KCT/0 % → không thuế; r % → trước thuế = round(total/(1+r)).
 */
export function splitVat(total: number, rate: VatRate): { totalWithoutVat: number; vatAmount: number } {
  if (rate === 'KCT' || rate === '0') return { totalWithoutVat: total, vatAmount: 0 };
  const r = Number(rate) / 100;
  const without = Math.round(total / (1 + r));
  return { totalWithoutVat: without, vatAmount: total - without };
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc nhóm 3 chữ số (0–999); `full` = nhóm không đứng đầu (đọc "không trăm", "linh") */
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (h > 0 || full) out.push(`${DIGITS[h]} trăm`);
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) out.push('linh');
  } else if (t === 1) out.push('mười');
  else out.push(`${DIGITS[t]} mươi`);
  if (u > 0) {
    if (u === 1 && t > 1) out.push('mốt');
    else if (u === 5 && t > 0) out.push('lăm');
    else if (u === 4 && t > 1) out.push('tư');
    else out.push(DIGITS[u]!);
  }
  return out.join(' ');
}

/** Số tiền bằng chữ tiếng Việt (bắt buộc trên hoá đơn): 199000 → "Một trăm chín mươi chín nghìn đồng" */
export function vndInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount));
  if (n === 0) return 'Không đồng';
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    // Nhóm "tỷ" lặp lại cho số ≥ 10^12 (nghìn tỷ…)
    const unit = i === 0 ? '' : i % 3 === 0 ? 'tỷ' : units[i % 3]!;
    if (g === 0) {
      if (i % 3 === 0 && i > 0 && parts.length) parts.push('tỷ');
      continue;
    }
    parts.push(readTriple(g, i < groups.length - 1));
    if (unit) parts.push(unit);
  }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} đồng`;
}

/** Bỏ dấu tiếng Việt (PDF mock dùng font chuẩn Helvetica/WinAnsi không có glyph tiếng Việt) */
export function stripVietnamese(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '?');
}
