import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC hex (chữ thường) – VNPay SHA-512, MoMo/ZaloPay SHA-256 */
export function hmacHex(algo: 'sha256' | 'sha512', key: string, data: string): string {
  return createHmac(algo, key).update(Buffer.from(data, 'utf8')).digest('hex');
}

/** So sánh chữ ký hex không phân biệt hoa/thường, thời gian hằng */
export function safeEqualHex(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a.trim().toLowerCase(), 'utf8');
  const y = Buffer.from(b.trim().toLowerCase(), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

/** yyyyMMddHHmmss theo giờ Việt Nam (GMT+7) – vnp_CreateDate/vnp_ExpireDate */
export function vnDateTime(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/** yyyyMMddHHmmss (GMT+7) → Date; sai định dạng → null */
export function parseVnDateTime(s: string | undefined | null): Date | null {
  if (!s || !/^\d{14}$/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** yymmdd theo giờ VN – tiền tố app_trans_id của ZaloPay */
export function vnYymmdd(d: Date): string {
  return vnDateTime(d).slice(2, 8);
}

/** Ngày lịch VN (YYYY-MM-DD) của một thời điểm */
export function vnDate(d: Date): string {
  const s = vnDateTime(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Khoảng [start, end) UTC của một ngày lịch VN */
export function vnDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Kỳ tháng lịch VN (YYYY-MM) của một thời điểm */
export function vnMonth(d: Date): string {
  return vnDate(d).slice(0, 7);
}

/** Khoảng [start, end) UTC của một tháng lịch VN (YYYY-MM) */
export function vnMonthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const start = new Date(`${month}-01T00:00:00+07:00`);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start, end: new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00+07:00`) };
}
