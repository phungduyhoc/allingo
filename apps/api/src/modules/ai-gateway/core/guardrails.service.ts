import { Injectable } from '@nestjs/common';
import type { GuardClassifyOutput } from '@allingo/schemas';
import { RedisService } from '../../../shared/cache/redis.module.js';
import { ExamModeLocked } from '../../../shared/http/errors.js';
import { AiGatewayService } from './ai-gateway.service.js';

export const EXAM_LOCK_KEY = (userId: string) => `exam:lock:${userId}`;

/**
 * Guardrails (CLAUDE.md §5.4, §5.8): guard_classify cho mọi văn bản tự do; khoá Exam Mode qua cờ Redis
 * do test-engine đặt khi attempt exam bắt đầu (không truy vấn bảng của module khác).
 */
@Injectable()
export class GuardrailsService {
  constructor(
    private readonly redis: RedisService,
    private readonly gateway: AiGatewayService,
  ) {}

  /** Ném 403 exam_mode_locked nếu người dùng đang có attempt exam in_progress */
  async assertNotInExam(userId: string): Promise<void> {
    const attemptId = await this.redis.safe((r) => r.get(EXAM_LOCK_KEY(userId)));
    if (attemptId) throw new ExamModeLocked(attemptId);
  }

  async examLockOf(userId: string): Promise<string | null> {
    return this.redis.safe((r) => r.get(EXAM_LOCK_KEY(userId)));
  }

  /** Phân loại input tự do; trả kết quả (không trừ credit). Lỗi model → cho qua với cảnh báo (fail-open có chủ đích ở Sprint 0, S6 đổi fail-closed). */
  async classify(userId: string | null, text: string, ctx: { mode: string; examMode: boolean; taskCode: string; program: string | null }): Promise<GuardClassifyOutput> {
    try {
      const r = await this.gateway.runTask<GuardClassifyOutput>({
        taskCode: 'guard_classify',
        userId,
        chargeCredits: false,
        program: ctx.program,
        variables: { mode: ctx.mode, exam_mode: String(ctx.examMode), task_code: ctx.taskCode, program: ctx.program ?? 'toeic', text },
        inputRef: { purpose: 'guard', task_code: ctx.taskCode },
      });
      return r.data;
    } catch {
      return { allowed: true, category: 'ok', reason: 'guard unavailable (fail-open)', redacted_text: null };
    }
  }
}
