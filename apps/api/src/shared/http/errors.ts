import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@allingo/schemas';

/**
 * Lỗi nghiệp vụ chuẩn hoá → envelope { error: { code, message, details, trace_id } } (CLAUDE.md §6).
 * Thông điệp là mã i18n-friendly (tiếng Anh ngắn); UI dịch theo `code`.
 */
export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    super({ error: { code, message, details } }, status);
    this.message = message;
    this.code = code;
    this.details = details;
  }
}

export class ValidationFailed extends AppError {
  constructor(details: Record<string, unknown>, message = 'Validation failed') {
    super('validation_failed', message, HttpStatus.BAD_REQUEST, details);
  }
}
export class Unauthorized extends AppError {
  constructor(message = 'Unauthorized', details?: Record<string, unknown>) {
    super('unauthorized', message, HttpStatus.UNAUTHORIZED, details);
  }
}
export class Forbidden extends AppError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super('forbidden', message, HttpStatus.FORBIDDEN, details);
  }
}
export class NotFound extends AppError {
  constructor(entity: string, id?: string) {
    super('not_found', `${entity} not found`, HttpStatus.NOT_FOUND, id ? { entity, id } : { entity });
  }
}
export class Conflict extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('conflict', message, HttpStatus.CONFLICT, details);
  }
}
/**
 * 429 quota_exceeded (S5): `details.quota = { feature, period, limit, used, remaining: 0, resets_at }` (+ `reset_at` tương thích);
 * `details.feature`/`details.reset_at` ở mức trên theo quy ước chung của OpenAPI (info.description).
 */
export class QuotaExceeded extends AppError {
  /** `extra` (S6) gộp vào details.quota – vd `{ scope: 'thread', thread_id }` cho giới hạn lượt/hội thoại gia sư */
  constructor(details: { feature: string; period: string; limit: number; used: number; remaining: number; resets_at: string; reset_at: string }, extra?: Record<string, unknown>) {
    super('quota_exceeded', 'Quota exceeded', HttpStatus.TOO_MANY_REQUESTS, { quota: { ...details, ...(extra ?? {}) }, feature: details.feature, reset_at: details.resets_at, upgrade: true });
  }
}
export class InsufficientCredits extends AppError {
  constructor(details: { required: number; balance: number }) {
    super('insufficient_credits', 'Insufficient credits', HttpStatus.PAYMENT_REQUIRED, details);
  }
}
export class ExamModeLocked extends AppError {
  constructor(attemptId: string) {
    super('exam_mode_locked', 'AI features are locked while an exam attempt is in progress', HttpStatus.FORBIDDEN, { attempt_id: attemptId });
  }
}
/**
 * 503 `feature_disabled` (kill-switch – S11): `details = { flag, message_key: 'errors.feature_disabled', retry_after_sec }`.
 * Web dịch theo `code`/`message_key` (không chuỗi cứng); header `Retry-After` do exception filter đặt từ `retry_after_sec`.
 */
export class FeatureDisabled extends AppError {
  constructor(flag: string) {
    super('feature_disabled', 'Feature is disabled', HttpStatus.SERVICE_UNAVAILABLE, { flag, message_key: 'errors.feature_disabled', retry_after_sec: 60 });
  }
}
export class RateLimited extends AppError {
  constructor(retryAfterSec?: number, extra?: Record<string, unknown>) {
    super('rate_limited', 'Too many requests', HttpStatus.TOO_MANY_REQUESTS, retryAfterSec || extra ? { ...(retryAfterSec ? { retry_after_sec: retryAfterSec } : {}), ...(extra ?? {}) } : undefined);
  }
}
/** 403 `forbidden` do kiểm tra nguồn gốc request ghi bằng cookie (CSRF – S11): `details.reason = 'csrf_origin_mismatch'` */
export class CsrfRejected extends AppError {
  constructor() {
    super('forbidden', 'Cross-site request rejected', HttpStatus.FORBIDDEN, { reason: 'csrf_origin_mismatch' });
  }
}
/**
 * 403 `beta_required` (S12): beta kín bật (`ff.growth.beta_gate`) và người gọi chưa có quyền beta.
 * `details = { message_key: 'errors.beta_required', redeem_path: '/beta/redeem' }` – web hiện màn nhập mã mời.
 */
export class BetaRequired extends AppError {
  constructor() {
    super('beta_required', 'Closed beta: an invitation code is required', HttpStatus.FORBIDDEN, { message_key: 'errors.beta_required', redeem_path: '/beta/redeem' });
  }
}
/**
 * 403 `mfa_required` (S12): admin/superadmin gọi endpoint quản trị khi phiên chưa xác minh TOTP (step-up).
 * `details = { enrolled?, enroll_path, verify_path }` – chưa đăng ký → enroll + confirm; đã đăng ký → verify.
 */
export class MfaRequired extends AppError {
  constructor(details: Record<string, unknown> = {}) {
    super('mfa_required', 'Multi-factor authentication required for this operation', HttpStatus.FORBIDDEN, { enroll_path: '/auth/mfa/totp/enroll', verify_path: '/auth/mfa/verify', ...details });
  }
}
