import { SUBSCRIPTION_REMINDER_DAYS } from '@allingo/schemas';

/**
 * Kỳ subscription & kỳ credit tháng (Sprint 7) – thuần, không I/O.
 *  - Kỳ credit = cửa sổ 30 ngày tính từ `current_period_start`; số kỳ = max(1, round(số ngày của kỳ / 30))
 *    → tháng (30 ngày) = 1, năm (365 ngày) = 12, gia hạn nối tiếp là subscription riêng nên tự có kỳ của nó.
 *  - Kỳ k đến hạn khi now ≥ start + 30k ngày. Job credit.grant_monthly cấp các kỳ đến hạn chưa cấp (idempotent theo
 *    (subscription_id, period) = số dòng subscription_grant đã có của subscription).
 */
export const DAY_MS = 86_400_000;
export const CREDIT_WINDOW_DAYS = 30;

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

export function creditWindowCount(start: Date, end: Date | null): number {
  if (!end) return 1;
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  return Math.max(1, Math.round(days / CREDIT_WINDOW_DAYS));
}

/** Số kỳ credit đã đến hạn tại `now` (0 nếu kỳ chưa bắt đầu) */
export function dueCreditWindows(start: Date, end: Date | null, now: Date): number {
  if (now.getTime() < start.getTime()) return 0;
  if (end && now.getTime() >= end.getTime()) return creditWindowCount(start, end);
  const elapsed = Math.floor((now.getTime() - start.getTime()) / (CREDIT_WINDOW_DAYS * DAY_MS)) + 1;
  return Math.min(creditWindowCount(start, end), elapsed);
}

/**
 * Mốc nhắc hết hạn: d* = mốc NHỎ NHẤT trong 7/3/1 ngày mà thời gian còn lại ≤ d (gửi mốc cụ thể nhất, bỏ các mốc lớn đã qua).
 * null khi còn > 7 ngày hoặc đã hết hạn.
 */
export function reminderThreshold(end: Date, now: Date, thresholds: readonly number[] = SUBSCRIPTION_REMINDER_DAYS): number | null {
  const left = end.getTime() - now.getTime();
  if (left <= 0) return null;
  const hits = thresholds.filter((d) => left <= d * DAY_MS);
  return hits.length ? Math.min(...hits) : null;
}

export function daysLeft(end: Date | null, now: Date): number | null {
  if (!end) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}
