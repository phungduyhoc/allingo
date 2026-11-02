import { ApiError } from '@allingo/api-client';
import type { Entitlements } from './types';

/**
 * Hạn mức (Sprint 5) – CHỈ để hiển thị: server kiểm tra quota/credit ở mọi endpoint (CLAUDE.md §5.7), client không chặn.
 * Nguồn: `GET /me/entitlements` (`quotas[].remaining`, `reset_at`) và lỗi 429 `quota_exceeded` (`error.details.quota`).
 * Kỳ reset là 00:00 giờ Việt Nam (Asia/Ho_Chi_Minh) bất kể múi giờ của trình duyệt.
 */

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export interface QuotaInfo {
  feature: string;
  period: string;
  /** null = không giới hạn */
  limit: number | null;
  used: number;
  /** null = không giới hạn */
  remaining: number | null;
  /** ISO UTC của lần reset kế tiếp; null khi không có */
  resetAt: string | null;
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Hạn mức của một tính năng (ưu tiên `remaining` của API; bản cũ thiếu trường thì suy ra limit − used, không âm) */
export function quotaOf(ent: Pick<Entitlements, 'quotas'> | null | undefined, feature: string): QuotaInfo | null {
  const q = ent?.quotas.find((x) => x.feature === feature);
  if (!q) return null;
  const remaining = q.limit === null ? null : (q.remaining ?? Math.max(0, q.limit - q.used));
  return { feature: q.feature, period: q.period, limit: q.limit, used: q.used, remaining: remaining === null ? null : Math.max(0, remaining), resetAt: text(q.reset_at) };
}

/**
 * 429 `quota_exceeded` → QuotaInfo. Đọc `details.quota` (v1.1) rồi tới các trường phẳng cũ (`details.feature/limit/reset_at`);
 * không phải lỗi hạn mức → null.
 */
export function parseQuotaExceeded(err: unknown): QuotaInfo | null {
  if (!(err instanceof ApiError) || err.code !== 'quota_exceeded') return null;
  const d = err.details ?? {};
  const q = (d.quota && typeof d.quota === 'object' ? d.quota : {}) as Record<string, unknown>;
  const limit = int(q.limit) ?? int(d.limit);
  const used = int(q.used) ?? int(d.used) ?? limit ?? 0;
  return {
    feature: text(q.feature) ?? text(d.feature) ?? 'unknown',
    period: text(q.period) ?? text(d.period) ?? 'day',
    limit,
    used,
    remaining: Math.max(0, int(q.remaining) ?? 0),
    resetAt: text(q.resets_at) ?? text(q.reset_at) ?? text(d.resets_at) ?? text(d.reset_at),
  };
}

/** 402 `insufficient_credits` → số credit cần/còn (nếu API trả) */
export function parseInsufficientCredits(err: unknown): { required: number | null; balance: number | null } | null {
  if (!(err instanceof ApiError) || err.code !== 'insufficient_credits') return null;
  return { required: int(err.details?.required), balance: int(err.details?.balance) };
}

/** Lỗi cần nâng cấp gói: 403 kèm `details.upgrade` (vd. chẩn đoán AI cho Free) */
export function needsUpgrade(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code !== 'exam_mode_locked' && err.details?.upgrade === true;
}

export interface ResetParts {
  /** HH:mm (24 giờ) theo giờ Việt Nam */
  time: string;
  /** Ngày theo giờ Việt Nam, định dạng của `locale` (vd. "3 tháng 11" / "November 3") */
  date: string;
  /** So với ngày hiện tại (giờ Việt Nam) */
  day: 'today' | 'tomorrow' | 'other';
}

function vnDayNumber(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: VN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000;
}

/** Thời điểm reset hạn mức hiển thị theo giờ Việt Nam ("00:00 ngày mai"); ISO sai → null */
export function resetParts(iso: string | null | undefined, locale: string, now: Date = new Date()): ResetParts | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = new Intl.DateTimeFormat(locale, { timeZone: VN_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const date = new Intl.DateTimeFormat(locale, { timeZone: VN_TIME_ZONE, day: 'numeric', month: 'long' }).format(at);
  const diff = vnDayNumber(at) - vnDayNumber(now);
  return { time, date, day: diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : 'other' };
}

// ----------------------------------------------------------------------------- Thông báo chung khi vượt hạn mức

export const QUOTA_EXCEEDED_EVENT = 'allingo:quota-exceeded';

/** Phát sự kiện toàn cục để `QuotaToastListener` hiện toast (một toast mỗi lúc, có CTA nâng cấp) */
export function notifyQuotaExceeded(err: unknown): void {
  const info = parseQuotaExceeded(err);
  if (!info || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<QuotaInfo>(QUOTA_EXCEEDED_EVENT, { detail: info }));
}
