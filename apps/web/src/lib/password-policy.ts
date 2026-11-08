import { ApiError } from '@allingo/api-client';

/** Độ dài tối thiểu mật khẩu khi đăng ký – khớp `PASSWORD_MIN_LENGTH` mặc định của API (S12); server trả `min_length` thật khi khác */
export const PASSWORD_MIN_LENGTH = 12;
const POLICY_CODES = ['password_too_short', 'password_breached', 'password_weak'] as const;

/** 400 `validation_failed` với `details.issues[{path: 'password', code}]` (+ `min_length`) → mã chính sách mật khẩu */
export function passwordPolicyIssue(err: unknown): { code: (typeof POLICY_CODES)[number]; minLength: number } | null {
  if (!(err instanceof ApiError) || err.code !== 'validation_failed') return null;
  const issues = Array.isArray(err.details?.issues) ? (err.details.issues as Array<{ path?: unknown; code?: unknown }>) : [];
  const hit = issues.find((i) => (i.path === 'password' || (Array.isArray(i.path) && i.path[0] === 'password')) && POLICY_CODES.includes(i.code as never));
  if (!hit) return null;
  const min = err.details?.min_length;
  return { code: hit.code as (typeof POLICY_CODES)[number], minLength: typeof min === 'number' && min > 0 ? min : PASSWORD_MIN_LENGTH };
}
