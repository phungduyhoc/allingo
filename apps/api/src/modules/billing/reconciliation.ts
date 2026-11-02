import type { ReconciliationMismatch } from '@allingo/schemas';

/**
 * Đối soát (Sprint 7) – thuần, không I/O: so giao dịch hệ thống (`billing.payments` success/refunded của một cổng trong một
 * ngày VN) với sao kê cổng (CSV tải lên theo mẫu `docs/runbooks/payments.md` hoặc kết quả queryStatus).
 *
 * Mẫu CSV (UTF-8, có dòng tiêu đề, phân cách `,`; chấp nhận `;`): `provider_txn_id,merchant_ref,amount,currency,status,paid_at`
 * – `amount` VND (KHÔNG nhân 100; `199000` hoặc `199000.00`, không dùng dấu chấm phân cách nghìn), `status` ∈ success|refunded|failed (chấp nhận bí danh 00/paid/thanh cong/hoan tien).
 * Bí danh cột theo cổng: VNPay `vnp_TransactionNo, vnp_TxnRef, vnp_Amount_vnd`; MoMo `transId, orderId`; ZaloPay `zp_trans_id, app_trans_id`.
 */
export interface ReconRow {
  provider_txn_id: string | null;
  merchant_ref: string | null;
  order_id?: string | null;
  amount: number;
  status: 'success' | 'refunded' | 'failed';
}

const HEADER_ALIASES: Record<string, keyof ReconRow | 'currency' | 'paid_at'> = {
  provider_txn_id: 'provider_txn_id',
  txn_id: 'provider_txn_id',
  transaction_no: 'provider_txn_id',
  vnp_transactionno: 'provider_txn_id',
  transid: 'provider_txn_id',
  zp_trans_id: 'provider_txn_id',
  merchant_ref: 'merchant_ref',
  vnp_txnref: 'merchant_ref',
  orderid: 'merchant_ref',
  app_trans_id: 'merchant_ref',
  amount: 'amount',
  vnp_amount_vnd: 'amount',
  so_tien: 'amount',
  currency: 'currency',
  status: 'status',
  trang_thai: 'status',
  paid_at: 'paid_at',
};

export function normalizeStatementStatus(s: string): ReconRow['status'] {
  const v = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  if (['success', 'paid', '00', '0', '1', 'thanh cong', 'completed', 'succeeded'].includes(v)) return 'success';
  if (['refunded', 'refund', 'hoan tien', 'da hoan tien'].includes(v)) return 'refunded';
  return 'failed';
}

/** Tách một dòng CSV (hỗ trợ "…" và "" thoát) */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export class CsvFormatError extends Error {}

export function parseStatementCsv(csv: string, opts: { stripAppTransPrefix?: boolean } = {}): ReconRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitCsvLine(lines[0]!, sep).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/\s+/g, '_')] ?? null);
  if (!header.includes('amount') || (!header.includes('provider_txn_id') && !header.includes('merchant_ref'))) throw new CsvFormatError('CSV header must include amount and provider_txn_id or merchant_ref');
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line, sep);
    const get = (k: string) => {
      const idx = header.indexOf(k as never);
      return idx >= 0 ? (cells[idx] ?? '') : '';
    };
    const amount = Number(get('amount').replace(/[\s,_]/g, ''));
    if (!Number.isFinite(amount)) throw new CsvFormatError(`line ${i + 2}: invalid amount`);
    let ref = get('merchant_ref') || null;
    if (ref && opts.stripAppTransPrefix && /^\d{6}_/.test(ref)) ref = ref.slice(7);
    return { provider_txn_id: get('provider_txn_id') || null, merchant_ref: ref, amount: Math.round(amount), status: normalizeStatementStatus(get('status') || 'success') };
  });
}

export interface ReconResult {
  mismatches: ReconciliationMismatch[];
  expectedTotal: number;
  actualTotal: number;
  matched: number;
}

/**
 * Khớp theo provider_txn_id (ưu tiên) rồi merchant_ref. Lệch: thiếu trong sao kê, thừa trong sao kê (hệ thống không có),
 * khác số tiền, khác trạng thái (success ↔ refunded/failed). Tổng = Σ giao dịch success.
 */
export function diffReconciliation(system: readonly ReconRow[], statement: readonly ReconRow[]): ReconResult {
  const mismatches: ReconciliationMismatch[] = [];
  const used = new Set<number>();
  const byTxn = new Map<string, number>();
  const byRef = new Map<string, number>();
  statement.forEach((s, i) => {
    if (s.provider_txn_id) byTxn.set(s.provider_txn_id, i);
    if (s.merchant_ref) byRef.set(s.merchant_ref, i);
  });
  let matched = 0;
  for (const sys of system) {
    let idx = sys.provider_txn_id ? byTxn.get(sys.provider_txn_id) : undefined;
    if (idx === undefined && sys.merchant_ref) idx = byRef.get(sys.merchant_ref);
    if (idx !== undefined && used.has(idx)) idx = undefined;
    const base = { provider_txn_id: sys.provider_txn_id, merchant_ref: sys.merchant_ref, order_id: sys.order_id ?? null, system_amount: sys.amount, system_status: sys.status };
    if (idx === undefined) {
      mismatches.push({ type: 'missing_in_statement', ...base, statement_amount: null, statement_status: null });
      continue;
    }
    used.add(idx);
    const st = statement[idx]!;
    if (st.amount !== sys.amount) mismatches.push({ type: 'amount_mismatch', ...base, statement_amount: st.amount, statement_status: st.status });
    else if (st.status !== sys.status) mismatches.push({ type: 'status_mismatch', ...base, statement_amount: st.amount, statement_status: st.status });
    else matched++;
  }
  statement.forEach((st, i) => {
    if (used.has(i) || st.status === 'failed') return;
    mismatches.push({ type: 'missing_in_system', provider_txn_id: st.provider_txn_id, merchant_ref: st.merchant_ref, order_id: null, system_amount: null, statement_amount: st.amount, system_status: null, statement_status: st.status });
  });
  const sum = (rows: readonly ReconRow[]) => rows.filter((r) => r.status === 'success').reduce((s, r) => s + r.amount, 0);
  return { mismatches, expectedTotal: sum(system), actualTotal: sum(statement), matched };
}

const csvCell = (v: unknown) => {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Báo cáo lệch dạng CSV (tải về từ màn admin) */
export function mismatchesToCsv(rows: readonly ReconciliationMismatch[]): string {
  const cols = ['type', 'provider_txn_id', 'merchant_ref', 'order_id', 'system_amount', 'statement_amount', 'system_status', 'statement_status'] as const;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}
