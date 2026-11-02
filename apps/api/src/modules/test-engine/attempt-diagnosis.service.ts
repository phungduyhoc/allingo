import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { TOEIC_PART_SKILL } from '@allingo/scoring';
import { grade, isAnswered, correctAnswerOf, type AiStreamEvent, type AnswerInput, type AttemptAiDiagnosis, type DiagnoseRlOutput, type ScoreBreakdown } from '@allingo/schemas';
import { RedisService } from '../../shared/cache/redis.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AppError, Conflict, NotFound } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { AiGatewayService, GuardrailsService } from '../ai-gateway/index.js';
import { FeatureGateService, type GateTicket } from '../billing/index.js';
import { CatalogQueryService } from '../catalog/index.js';
import { UsersService } from '../iam/index.js';

const { learnAttempts, learnAttemptAnswers, catalogTestSets } = schema;

/** Phần Listening Part 1/2: chữ của câu được đọc trong audio – không đưa vào prompt (A40) */
const SPOKEN_SECTIONS = new Set(['part1', 'part2']);
const MAX_WRONG_ITEMS = 5;
const STEM_EXCERPT = 160;

interface StoredDiagnosis extends DiagnoseRlOutput {
  locale: string;
  ai_task_id: string | null;
  prompt_version_id: string | null;
  created_at: string;
}

/** score_breakdown.ai_diagnosis (JSONB mở rộng – không nằm trong kiểu ScoreBreakdown) */
function storedOf(breakdown: unknown): StoredDiagnosis | undefined {
  const b = breakdown as { ai_diagnosis?: StoredDiagnosis } | null | undefined;
  return b?.ai_diagnosis;
}

/**
 * Chẩn đoán AI sau bài R/L (`diagnose_rl`, POST /attempts/{id}/diagnosis – SSE theo OpenAPI, SPEC-ISSUES S28/S41):
 * - Chỉ chủ attempt, attempt đã chấm; người học đang làm đề Exam Mode khác → 403 exam_mode_locked;
 * - Quyền `ai_diagnose` (seed: Pro) → Free 403 upgrade; quota theo billing.quotas (không có dòng = không giới hạn); credit theo route (10);
 * - Input = chẩn đoán quy tắc (`score_breakdown.diagnosis`) + thống kê theo Part×kỹ năng con + ≤ 5 câu sai (trích đề ≤ 160 ký tự,
 *   đáp án đã chọn/đúng – attempt đã nộp nên được phép; không passage/transcript, không đề Part 1/2);
 * - Kết quả lưu `learn.attempts.score_breakdown.ai_diagnosis` trong CÙNG transaction với trừ credit → GET đọc lại;
 *   gọi lại khi đã có kết quả của cùng phiên bản prompt → trả lại (cached, không trừ credit).
 */
@Injectable()
export class AttemptDiagnosisService {
  private readonly logger = getLogger({ component: 'test-engine.diagnosis' });

  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly gateway: AiGatewayService,
    private readonly guard: GuardrailsService,
    private readonly gate: FeatureGateService,
    private readonly catalog: CatalogQueryService,
    private readonly users: UsersService,
  ) {}

  private async owned(userId: string, attemptId: string) {
    const [row] = await this.dbs.db.select().from(learnAttempts).where(eq(learnAttempts.id, attemptId)).limit(1);
    if (!row) throw new NotFound('attempt', attemptId);
    if (row.userId !== userId) throw new NotFound('attempt', attemptId);
    return row;
  }

  private toDto(attemptId: string, s: StoredDiagnosis, cached: boolean): AttemptAiDiagnosis {
    return { attempt_id: attemptId, top_error_type: s.top_error_type, evidence: s.evidence, why: s.why, steps: s.steps, check_question: s.check_question, encouragement: s.encouragement, locale: s.locale, ai_task_id: s.ai_task_id, prompt_version_id: s.prompt_version_id, created_at: s.created_at, cached };
  }

  /** GET /attempts/{id}/diagnosis – kết quả đã lưu (404 nếu chưa chẩn đoán) */
  async get(userId: string, attemptId: string): Promise<AttemptAiDiagnosis> {
    const row = await this.owned(userId, attemptId);
    const stored = storedOf(row.scoreBreakdown);
    if (!stored) throw new NotFound('attempt_diagnosis', attemptId);
    return this.toDto(attemptId, stored, true);
  }

  /** Biến cho template diagnose_rl (dữ liệu hệ thống trong <data>; không PII) */
  async buildVariables(row: typeof learnAttempts.$inferSelect): Promise<Record<string, unknown>> {
    const b = (row.scoreBreakdown ?? {}) as ScoreBreakdown;
    const draft = (row.draftState ?? {}) as { question_order?: Array<{ question_id: string; question_version_id: string; section_code: string }> };
    const order = draft.question_order ?? [];
    const versions = await this.catalog.loadByVersionIds(order.map((o) => o.question_version_id));
    const answers = await this.dbs.db.select().from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, row.id));
    const byQ = new Map(answers.map((a) => [a.questionId, a]));
    const byType: Record<string, { correct: number; total: number }> = {};
    const wrong: Array<{ type: string; section: string; question_type: string; stem_excerpt: string | null; chosen: unknown; correct: unknown; time_ms: number | null; answered: boolean }> = [];
    const skills = new Set<string>();
    for (const o of order) {
      const q = versions.get(o.question_version_id);
      if (!q) continue;
      const a = byQ.get(o.question_id);
      const answer = (a?.answer as AnswerInput | null) ?? null;
      const ok = a?.isCorrect ?? grade(q.content, answer).is_correct;
      if (ok === null) continue;
      skills.add((row.programCode === 'toeic' ? TOEIC_PART_SKILL[o.section_code] : undefined) ?? q.skill_code);
      const keys = q.subskill_codes.length ? q.subskill_codes.map((s) => `${o.section_code}:${s}`) : [`${o.section_code}:${q.question_type}`];
      for (const k of keys) {
        const m = (byType[k] ??= { correct: 0, total: 0 });
        m.total++;
        if (ok) m.correct++;
      }
      if (!ok) {
        const stem = 'stem' in q.content && typeof q.content.stem === 'string' && !SPOKEN_SECTIONS.has(o.section_code) ? q.content.stem.replace(/\s+/g, ' ').trim().slice(0, STEM_EXCERPT) : null;
        const chosen = answer && answer.type === 'mcq_single' ? answer.selected : isAnswered(answer) ? '(answered)' : null;
        wrong.push({ type: keys[0]!, section: o.section_code, question_type: q.question_type, stem_excerpt: stem || null, chosen, correct: correctAnswerOf(q.content), time_ms: a?.timeSpentMs ?? null, answered: isAnswered(answer) });
      }
    }
    // Ưu tiên câu sai thuộc nhóm yếu nhất (đúng phương pháp của prompt), câu đã trả lời trước câu bỏ trống
    const ratio = (k: string) => (byType[k] ? byType[k].correct / byType[k].total : 1);
    wrong.sort((x, y) => ratio(x.type) - ratio(y.type) || Number(y.answered) - Number(x.answered));
    const diag = (b.diagnosis ?? {}) as { flags?: string[]; weak_sections?: unknown[]; weak_subskills?: unknown[]; timeout_wrong?: number; unanswered?: number; overall_accuracy?: number };
    const strongAreas = Object.entries(byType)
      .filter(([, v]) => v.total >= 2 && v.correct / v.total >= 0.8)
      .sort((x, y) => y[1].correct / y[1].total - x[1].correct / x[1].total || y[1].total - x[1].total)
      .slice(0, 3)
      .map(([area, v]) => ({ area, correct: v.correct, total: v.total }));
    let title = 'Practice';
    if (row.testSetId) {
      const [ts] = await this.dbs.db.select({ title: catalogTestSets.title }).from(catalogTestSets).where(eq(catalogTestSets.id, row.testSetId)).limit(1);
      const t = ts?.title;
      title = t?.en ?? t?.vi ?? title;
    }
    return {
      program: row.programCode,
      skill: [...skills].sort().join('+') || 'reading',
      test_title: title,
      scaled_score: row.scaledScore !== null ? Number(row.scaledScore) : 'n/a',
      by_question_type: byType,
      wrong_items: wrong.slice(0, MAX_WRONG_ITEMS).map(({ answered: _a, ...w }) => w),
      strengths: {
        strong_areas: strongAreas,
        rule_diagnosis: { overall_accuracy: diag.overall_accuracy ?? null, flags: diag.flags ?? [], weak_sections: (diag.weak_sections ?? []).slice(0, 3), weak_subskills: (diag.weak_subskills ?? []).slice(0, 3), timeout_wrong: diag.timeout_wrong ?? 0, unanswered: diag.unanswered ?? b.unanswered ?? 0 },
      },
    };
  }

  /** POST /attempts/{id}/diagnosis – stream SSE (start → delta* → result → done); kết quả đã có → start(cached) → result → done */
  async diagnose(userId: string, attemptId: string, traceId?: string): Promise<AsyncGenerator<AiStreamEvent>> {
    const row = await this.owned(userId, attemptId);
    if (row.status !== 'graded') throw new Conflict('Attempt is not graded yet', { status: row.status });
    // Exam Mode: đang làm đề exam (attempt khác) → khoá mọi AI (CLAUDE.md §5.8)
    await this.guard.assertNotInExam(userId);
    const user = await this.users.findById(userId);
    const locale = user?.explainLocale ?? 'vi';
    const pv = await this.gateway.currentPromptVersionId('diagnose_rl', row.programCode, userId);
    const stored = storedOf(row.scoreBreakdown);
    if (stored && stored.prompt_version_id === pv && stored.locale === locale) {
      const dto = this.toDto(attemptId, stored, true);
      return (async function* (): AsyncGenerator<AiStreamEvent> {
        yield { event: 'start', ai_task_id: dto.ai_task_id ?? '', cached: true };
        yield { event: 'result', data: dto, ai_task_id: dto.ai_task_id, cached: true };
        yield { event: 'done' };
      })();
    }
    // Gating S7 (FEATURE_GATES.ai_diagnose): Free → 403 upgrade trước khi khoá/tiêu quota
    await this.gate.check(userId, row.programCode, 'ai_diagnose');
    const lockKey = `diag:lock:${attemptId}`;
    const locked = await this.redis.safe((r) => r.set(lockKey, '1', 'EX', 120, 'NX'));
    if (locked === null && this.redis.isHealthy) throw new AppError('conflict', 'Diagnosis is already being generated', 409, { reason: 'in_progress' });
    const unlock = () => this.redis.safe((r) => r.del(lockKey));
    let ticket: GateTicket;
    try {
      ticket = await this.gate.consume(userId, row.programCode, 'ai_diagnose');
    } catch (err) {
      await unlock();
      throw err;
    }
    let variables: Record<string, unknown>;
    try {
      variables = await this.buildVariables(row);
    } catch (err) {
      await ticket.release();
      await unlock();
      throw err;
    }
    const dbs = this.dbs;
    const toDto = this.toDto.bind(this);
    let stream: AsyncGenerator<AiStreamEvent>;
    try {
      stream = this.gateway.streamTask<DiagnoseRlOutput>(
        { taskCode: 'diagnose_rl', userId, variables, locale, program: row.programCode, inputRef: { attempt_id: attemptId }, traceId },
        async (tx, r) => {
          const value: StoredDiagnosis = { ...r.data, locale, ai_task_id: r.aiTaskId, prompt_version_id: r.promptVersionId, created_at: new Date().toISOString() };
          await tx
            .update(learnAttempts)
            .set({ scoreBreakdown: sql`jsonb_set(coalesce(${learnAttempts.scoreBreakdown}, '{}'::jsonb), '{ai_diagnosis}', ${JSON.stringify(value)}::jsonb, true)` })
            .where(and(eq(learnAttempts.id, attemptId), eq(learnAttempts.userId, userId)));
        },
      );
    } catch (err) {
      await ticket.release();
      await unlock();
      throw err;
    }
    const logger = this.logger;
    return (async function* (): AsyncGenerator<AiStreamEvent> {
      let ok = false;
      try {
        for await (const ev of stream) {
          if (ev.event === 'result') {
            ok = true;
            const [fresh] = await dbs.db.select({ b: learnAttempts.scoreBreakdown }).from(learnAttempts).where(eq(learnAttempts.id, attemptId)).limit(1);
            const s = (fresh?.b as { ai_diagnosis?: StoredDiagnosis } | null)?.ai_diagnosis;
            yield { event: 'result', data: s ? toDto(attemptId, s, false) : ev.data, ai_task_id: ev.ai_task_id, cached: false };
          } else yield ev;
        }
      } catch (err) {
        logger.warn({ attempt_id: attemptId, err: (err as Error).message }, 'diagnosis stream failed');
        yield { event: 'error', code: 'ai_failed', message: (err as Error).message };
        yield { event: 'done' };
      } finally {
        if (!ok) await ticket.release();
        await unlock();
      }
    })();
  }
}
