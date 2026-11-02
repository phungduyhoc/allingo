import { WEEKDAYS, type Weekday } from './types.js';

/** Tiện ích ngày ISO `YYYY-MM-DD` (lịch thuần, tính bằng UTC để không lệch múi giờ máy chạy) */
const DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function toEpochDay(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
}

export function fromEpochDay(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromEpochDay(toEpochDay(iso) + n);
}

/** Số ngày từ `a` tới `b` (b − a) */
export function daysBetween(a: string, b: string): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function weekdayOf(iso: string): Weekday {
  // 1970-01-01 là thứ Năm (index 3 trong mon..sun)
  const idx = (((toEpochDay(iso) + 3) % 7) + 7) % 7;
  return WEEKDAYS[idx]!;
}

/** Danh sách ngày trong [start, endInclusive] */
export function datesInRange(start: string, endInclusive: string): string[] {
  const out: string[] = [];
  for (let d = toEpochDay(start); d <= toEpochDay(endInclusive); d++) out.push(fromEpochDay(d));
  return out;
}

export const minIso = (a: string, b: string) => (a < b ? a : b);
export const maxIso = (a: string, b: string) => (a > b ? a : b);

/**
 * Ngày theo lịch của một múi giờ IANA tại thời điểm `at` (vd 'Asia/Ho_Chi_Minh' 2026-11-02T18:00Z → '2026-11-03').
 * Múi giờ không hợp lệ → ném RangeError (API validate trước).
 */
export function localDate(at: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof at === 'number' ? new Date(at) : at);
}

/** Giờ:phút theo múi giờ (`HH:MM`, 24 giờ) */
export function localTime(at: Date | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(typeof at === 'number' ? new Date(at) : at);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/** Phút trong ngày của `HH:MM` */
export function minuteOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Độ lệch (phút) của múi giờ so với UTC tại thời điểm `at` (vd Asia/Ho_Chi_Minh → 420) */
export function tzOffsetMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

/** Thời điểm UTC của 00:00 ngày `localDate` theo múi giờ (xử lý DST bằng hai lượt) */
export function zonedDayStart(localDate: string, timeZone: string): Date {
  const guess = Date.parse(`${localDate}T00:00:00Z`);
  const off1 = tzOffsetMinutes(guess, timeZone);
  let t = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(t, timeZone);
  if (off2 !== off1) t = guess - off2 * 60_000;
  return new Date(t);
}
