import { ApiError } from '@allingo/api-client';

export type KnownErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'quota_exceeded'
  | 'insufficient_credits'
  | 'payment_failed'
  | 'rate_limited'
  | 'exam_mode_locked'
  | 'feature_disabled'
  | 'beta_required'
  | 'mfa_required'
  | 'ai_failed'
  | 'ai_timeout'
  | 'internal'
  | 'network';

const KNOWN: ReadonlySet<string> = new Set<KnownErrorCode>([
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'quota_exceeded',
  'insufficient_credits',
  'payment_failed',
  'rate_limited',
  'exam_mode_locked',
  'feature_disabled',
  // S12: beta kín (cần mã mời) + step-up MFA cho thao tác quản trị
  'beta_required',
  'mfa_required',
  // Mã của sự kiện SSE `error` từ AI Gateway (Sprint 5)
  'ai_failed',
  'ai_timeout',
  'internal',
  'network',
]);

/** Chuẩn hoá mọi lỗi về mã trong envelope API (hoặc 'network' khi fetch thất bại) */
export function getErrorCode(err: unknown): KnownErrorCode {
  if (err instanceof ApiError) return KNOWN.has(err.code) ? (err.code as KnownErrorCode) : 'internal';
  if (err instanceof TypeError) return 'network';
  if (err instanceof DOMException && err.name === 'AbortError') return 'network';
  return 'internal';
}

export function getErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

export function isApiError(err: unknown, code?: KnownErrorCode): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

/** Chi tiết lỗi validation theo trường (details.fields?.{field}: string) nếu API trả */
export function getFieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  const fields = err.details.fields;
  if (!fields || typeof fields !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
  }
  return out;
}
