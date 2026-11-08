import { ApiError } from '@allingo/api-client';
import { parseFeatureDisabled, type FeatureDisabledInfo } from './flags';
import { notifyQuotaExceeded } from './quota';

/**
 * Lỗi API dùng chung cho mọi màn (S11): 429 `rate_limited` (giới hạn tốc độ toàn cục theo IP / token bucket theo route / khoá đăng
 * nhập) và 503 `feature_disabled` của kill-switch. Hàm thuần đọc envelope + sự kiện window để listener (toast) ở layout gốc hiển
 * thị MỘT thông báo – không tự gọi lại request (không vòng lặp retry). 429 `quota_exceeded` (hạn mức gói) giữ luồng S5 (`quota.ts`).
 */

export interface RateLimitInfo {
  /** Giây phải chờ (≥ 1) – từ `details.retry_after_sec` hoặc header `Retry-After` (fetch wrapper chép vào details) */
  retryAfterSec: number | null;
  /** `login_locked` (đăng nhập sai nhiều lần) | `global_ip` (giới hạn toàn cục) | `bucket` (token bucket theo route) | `other` */
  kind: 'login_locked' | 'global_ip' | 'bucket' | 'other';
  bucket: string | null;
}

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
};

/** 429 `rate_limited` → thông tin chờ; lỗi khác (kể cả 429 `quota_exceeded`) → null */
export function parseRateLimited(err: unknown): RateLimitInfo | null {
  if (!(err instanceof ApiError) || err.code !== 'rate_limited') return null;
  const d = err.details ?? {};
  const bucket = typeof d.bucket === 'string' ? d.bucket : null;
  const kind: RateLimitInfo['kind'] = d.reason === 'login_locked' ? 'login_locked' : d.scope === 'global_ip' ? 'global_ip' : bucket ? 'bucket' : 'other';
  return { retryAfterSec: posInt(d.retry_after_sec), kind, bucket };
}

/** Thời gian chờ để hiển thị: < 90 s → giây; còn lại → phút (làm tròn lên) */
export function waitParts(sec: number | null): { unit: 'seconds' | 'minutes' | 'unknown'; value: number } {
  if (!sec) return { unit: 'unknown', value: 0 };
  if (sec < 90) return { unit: 'seconds', value: sec };
  return { unit: 'minutes', value: Math.ceil(sec / 60) };
}

export const RATE_LIMITED_EVENT = 'allingo:rate-limited';
export const FEATURE_DISABLED_EVENT = 'allingo:feature-disabled';

function emit<T>(name: string, detail: T): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

/**
 * Điểm vào chung từ QueryCache/MutationCache và các luồng tự gọi fetch (SSE giải thích/gia sư/chẩn đoán): phát đúng một sự kiện
 * theo loại lỗi. Màn hình vẫn có thể hiện thông báo tại chỗ (form đăng nhập, khung giải thích) – listener gộp toast theo id.
 */
export function notifyApiError(err: unknown): void {
  notifyQuotaExceeded(err);
  const rl = parseRateLimited(err);
  if (rl) emit<RateLimitInfo>(RATE_LIMITED_EVENT, rl);
  const fd = parseFeatureDisabled(err);
  if (fd) emit<FeatureDisabledInfo>(FEATURE_DISABLED_EVENT, fd);
}

/** Không thử lại tự động: lỗi nghiệp vụ (401/402/403/404), giới hạn tốc độ (429) và kill-switch (503 feature_disabled); mạng/5xx khác → 2 lần */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if ([401, 402, 403, 404, 429].includes(error.status)) return false;
    if (error.code === 'feature_disabled') return false;
  }
  return failureCount < 2;
}
