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
export class FeatureDisabled extends AppError {
  constructor(flag: string) {
    super('feature_disabled', 'Feature is disabled', HttpStatus.SERVICE_UNAVAILABLE, { flag });
  }
}
export class RateLimited extends AppError {
  constructor(retryAfterSec?: number) {
    super('rate_limited', 'Too many requests', HttpStatus.TOO_MANY_REQUESTS, retryAfterSec ? { retry_after_sec: retryAfterSec } : undefined);
  }
}
