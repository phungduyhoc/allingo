import { Injectable } from '@nestjs/common';
import type { GuardClassifyOutput, RefusalCode } from '@allingo/schemas';
import { EXAM_LOCK_KEY, ExamModeService } from '../../../shared/exam/exam-mode.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { localGuard, redactPii, refusalCodeOf, type GuardCategory } from './guard-rules.js';
import { DEFAULT_PROGRAM } from '@allingo/schemas';

export { EXAM_LOCK_KEY };

/** Quyết định guard cho một văn bản tự do của người học */
export interface GuardDecision {
  allowed: boolean;
  category: GuardCategory;
  /** null khi cho qua */
  refusalCode: RefusalCode | null;
  /** Văn bản đã che PII – dùng cho prompt chính và lưu lịch sử */
  text: string;
  piiRedacted: boolean;
  /** local = luật cục bộ chặn (không gọi model nào); model = guard_classify; unavailable = guard lỗi (fail-closed) */
  source: 'local' | 'model' | 'unavailable';
  reason: string;
  /** ai_tasks.id của lời gọi guard_classify (nếu có) */
  guardTaskId: string | null;
}

/**
 * Guardrails (CLAUDE.md §5.4, §5.8; S6):
 * - Exam Mode: uỷ quyền ExamModeService dùng chung (probe DB do test-engine đăng ký; fallback cờ Redis).
 * - Văn bản tự do: che PII cục bộ → luật cục bộ (injection/xin đáp án đề đang thi) → `guard_classify` (không trừ credit).
 *   S6 đổi sang FAIL-CLOSED: guard model lỗi → `source = unavailable`, caller KHÔNG gọi model chính.
 */
@Injectable()
export class GuardrailsService {
  private readonly logger = getLogger({ component: 'ai.guard' });

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly examMode: ExamModeService,
  ) {}

  /** Ném 403 exam_mode_locked nếu người dùng đang có attempt exam in_progress */
  async assertNotInExam(userId: string): Promise<void> {
    await this.examMode.assertNotInExam(userId);
  }

  async examLockOf(userId: string): Promise<string | null> {
    return this.examMode.activeExamAttempt(userId);
  }

  /** Phân loại thô (tương thích S5): kết quả guard_classify; lỗi → ném (không còn fail-open) */
  async classify(userId: string | null, text: string, ctx: { mode: string; examMode: boolean; taskCode: string; program: string | null }): Promise<GuardClassifyOutput & { aiTaskId: string }> {
    const r = await this.gateway.runTask<GuardClassifyOutput>({
      taskCode: 'guard_classify',
      userId,
      chargeCredits: false,
      program: ctx.program,
      variables: { mode: ctx.mode, exam_mode: String(ctx.examMode), task_code: ctx.taskCode, program: ctx.program ?? DEFAULT_PROGRAM, text },
      inputRef: { purpose: 'guard', task_code: ctx.taskCode },
    });
    return { ...r.data, aiTaskId: r.aiTaskId };
  }

  /** Quyết định đầy đủ cho văn bản tự do (tutor_chat và mọi `<user_input>` tự do) */
  async check(userId: string | null, raw: string, ctx: { mode?: 'input' | 'output'; examMode: boolean; taskCode: string; program: string | null }): Promise<GuardDecision> {
    const pii = redactPii(raw);
    const local = localGuard(pii.text);
    if (local.category !== 'ok') {
      return { allowed: false, category: local.category, refusalCode: refusalCodeOf(local.category), text: pii.text, piiRedacted: pii.redacted, source: 'local', reason: `local rule ${local.rule}`, guardTaskId: null };
    }
    let out: GuardClassifyOutput & { aiTaskId: string };
    try {
      out = await this.classify(userId, pii.text, { mode: ctx.mode ?? 'input', examMode: ctx.examMode, taskCode: ctx.taskCode, program: ctx.program });
    } catch (err) {
      this.logger.warn({ task: ctx.taskCode, err: (err as Error).message?.slice(0, 200) }, 'guard_classify unavailable – fail-closed');
      return { allowed: false, category: 'ok', refusalCode: null, text: pii.text, piiRedacted: pii.redacted, source: 'unavailable', reason: 'guard unavailable', guardTaskId: null };
    }
    const code = refusalCodeOf(out.category);
    // pii: model thấy dữ liệu cá nhân còn sót → dùng bản che của model (nếu có) và cho qua
    const text = out.category === 'pii' && out.redacted_text ? out.redacted_text : pii.text;
    const allowed = code === null;
    return { allowed, category: out.category, refusalCode: code, text, piiRedacted: pii.redacted || out.category === 'pii', source: 'model', reason: out.reason, guardTaskId: out.aiTaskId };
  }
}
