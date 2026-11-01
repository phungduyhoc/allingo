import { applyDecorators, type CanActivate, type ExecutionContext, Global, Injectable, Module, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiResponse } from '@nestjs/swagger';
import { RedisService } from '../cache/redis.module.js';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { ExamModeLocked } from '../http/errors.js';
import { getLogger } from '../telemetry/logger.js';

/** Cờ Redis do test-engine đặt khi tạo attempt exam (cache nhanh; nguồn sự thật là learn.attempts qua probe) */
export const EXAM_LOCK_KEY = (userId: string) => `exam:lock:${userId}`;

/**
 * Probe "người dùng có attempt `mode = exam` đang `in_progress` không" – do module sở hữu learn.attempts (test-engine) đăng ký
 * lúc khởi động (đảo phụ thuộc: shared không truy vấn bảng của module, module tầng 1 không import test-engine – CLAUDE.md §5.1).
 * Trả attempt_id đang thi hoặc null.
 */
export type ExamModeProbe = (userId: string) => Promise<string | null>;

/**
 * Khoá Exam Mode dùng chung (CLAUDE.md §5.8, S6): mọi endpoint trợ giúp (giải thích, gia sư, tra từ, ghi chú ghi) gọi
 * `assertNotInExam` hoặc gắn `@ExamLocked()`. Có probe → hỏi DB (chính xác cả khi Redis mất/cờ cũ); chưa có probe (test đơn vị,
 * script) → cờ Redis.
 */
@Injectable()
export class ExamModeService {
  private probe: ExamModeProbe | null = null;
  private readonly logger = getLogger({ component: 'exam-mode' });

  constructor(private readonly redis: RedisService) {}

  registerProbe(probe: ExamModeProbe): void {
    this.probe = probe;
  }

  /** attempt_id của bài thi đang làm (null nếu không) */
  async activeExamAttempt(userId: string): Promise<string | null> {
    if (this.probe) {
      try {
        return await this.probe(userId);
      } catch (err) {
        // DB lỗi → dựa vào cờ Redis; Redis cũng mất → coi như ĐANG thi (fail-closed: chặn trợ giúp còn hơn lộ đáp án)
        this.logger.warn({ err: (err as Error).message }, 'exam probe failed, falling back to redis flag');
        const flag = await this.redis.safe((r) => r.get(EXAM_LOCK_KEY(userId)));
        if (flag !== null) return flag || null;
        return this.redis.isHealthy ? null : 'unknown';
      }
    }
    return this.redis.safe((r) => r.get(EXAM_LOCK_KEY(userId)));
  }

  /** Ném 403 `exam_mode_locked` (details.attempt_id) nếu đang thi */
  async assertNotInExam(userId: string): Promise<void> {
    const attemptId = await this.activeExamAttempt(userId);
    if (attemptId) throw new ExamModeLocked(attemptId);
  }
}

export const EXAM_LOCKED = 'examLocked';

/** Guard khoá Exam Mode: chạy sau AuthGuard toàn cục; endpoint công khai không có user → bỏ qua */
@Injectable()
export class ExamModeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly exam: ExamModeService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const locked = this.reflector.getAllAndOverride<boolean>(EXAM_LOCKED, [ctx.getHandler(), ctx.getClass()]);
    if (!locked) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) return true;
    await this.exam.assertNotInExam(req.user.id);
    return true;
  }
}

/** Đánh dấu endpoint bị khoá khi người dùng có attempt exam in_progress → 403 `exam_mode_locked` */
export const ExamLocked = () => applyDecorators(SetMetadata(EXAM_LOCKED, true), UseGuards(ExamModeGuard), ApiResponse({ status: 403, description: 'exam_mode_locked – đang có attempt exam in_progress' }));

@Global()
@Module({ providers: [ExamModeService, ExamModeGuard], exports: [ExamModeService, ExamModeGuard] })
export class ExamModeModule {}
