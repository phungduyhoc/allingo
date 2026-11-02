import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  DiagnosticRuleError,
  TOEIC_DIAGNOSTIC_BLUEPRINT,
  TOEIC_PART_SKILL,
  buildDiagnosticPool,
  diagnosticAdvance,
  estimateToeicDiagnostic,
  initDiagnosticState,
  masteryFromDiagnostic,
  suggestToeicTarget,
  type DiagnosticBlueprintEntry,
  type DiagnosticEstimate,
  type DiagnosticItem,
  type DiagnosticPool,
  type DiagnosticState,
} from '@allingo/scoring';
import { localDate } from '@allingo/planner';
import { grade, type AnswerInput, type DiagnosticResult, type DiagnosticStep, type ProgramCode } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { Conflict, NotFound } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { CatalogQueryService, type LoadedQuestion } from '../../catalog/index.js';
import { EnrollmentsService } from '../../iam/index.js';
import { AttemptsService } from '../../test-engine/index.js';
import { PlanService } from '../plan/plan.service.js';

const { learnSkillMastery } = schema;

/** Blueprint mặc định cho chương trình chưa có blueprint riêng: ≤ 3 đơn vị mỗi section */
function genericBlueprint(pool: DiagnosticPool): DiagnosticBlueprintEntry[] {
  return [...pool.entries()].map(([section_code, units]) => ({ section_code, units: Math.min(3, units.length) }));
}

function toEstimateDto(e: DiagnosticEstimate): DiagnosticResult['estimate'] {
  const L = e.by_skill.listening;
  const R = e.by_skill.reading;
  return {
    score: e.total?.score ?? null,
    se: e.se,
    low: e.total?.low ?? null,
    high: e.total?.high ?? null,
    listening: L ? { score: L.score, low: L.low, high: L.high } : null,
    reading: R ? { score: R.score, low: R.low, high: R.high } : null,
    answered: e.answered,
    estimated: true,
  };
}

/**
 * Bài chẩn đoán thích ứng v1 (ADR-0031, Sprint 9): `POST /me/diagnostic` bắt đầu (hoặc tiếp tục) attempt `mode = diagnostic` trên
 * test set `kind = diagnostic`; `POST /me/diagnostic/{id}/next` chấm câu đang chờ và trả câu kế tiếp theo luật 2 đúng/2 sai
 * (@allingo/scoring – thuần), `GET` lấy lại câu đang chờ (tải lại trang). Hết blueprint → nộp attempt (chỉ chấm câu đã phục vụ)
 * → ước tính điểm L/R/tổng ± khoảng, khởi tạo `learn.skill_mastery`, ghi `enrollments.current_level`, gợi ý mục tiêu khả thi.
 */
@Injectable()
export class DiagnosticService {
  private readonly logger = getLogger({ component: 'learning.diagnostic' });

  constructor(
    private readonly dbs: DbService,
    private readonly attempts: AttemptsService,
    private readonly catalog: CatalogQueryService,
    private readonly enrollments: EnrollmentsService,
    private readonly plans: PlanService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Bắt đầu hoặc tiếp tục bài chẩn đoán đang làm */
  async start(userId: string, program: ProgramCode): Promise<DiagnosticStep> {
    const [first] = await this.catalog.testSets(program, { kind: 'diagnostic', limit: 1 });
    const ts = first?.ts;
    if (!ts) throw new NotFound('diagnostic_test_set', program);
    const open = await this.attempts.listMine(userId, { program, mode: 'diagnostic', status: 'in_progress', limit: 1 });
    const attemptId = open.data[0]?.id ?? (await this.attempts.create(userId, { program, mode: 'diagnostic', test_set_id: ts.id })).id;
    return this.step(userId, attemptId);
  }

  private itemsOf(questions: Map<string, LoadedQuestion>): DiagnosticItem[] {
    return [...questions.values()].map((q) => ({ question_id: q.question_id, section_code: q.section_code, skill: TOEIC_PART_SKILL[q.section_code] ?? q.skill_code, group_key: q.group_key, subskills: q.subskill_codes, difficulty: q.difficulty, order: q.order_no }));
  }

  /** Một bước: không có `answer` → trả câu đang chờ (hoặc câu đầu tiên); có → chấm, đổi mức theo luật, chọn câu kế tiếp */
  async step(userId: string, attemptId: string, answer?: { question_id: string; answer: AnswerInput; time_spent_ms?: number }): Promise<DiagnosticStep> {
    const r = await this.attempts.adaptiveStep(userId, attemptId, (ctx) => {
      const pool = buildDiagnosticPool(this.itemsOf(ctx.questions));
      const blueprint = ctx.attempt.program === 'toeic' ? TOEIC_DIAGNOSTIC_BLUEPRINT : genericBlueprint(pool);
      let state = (ctx.draft.adaptive) ?? null;
      const base = { program: ctx.attempt.program, questions: ctx.questions, open: ctx.attempt.open };
      if (!ctx.attempt.open) {
        if (answer) throw new Conflict('Diagnostic already finished', { reason: 'already_done', status: ctx.attempt.status });
        return { result: { ...base, state, lastCorrect: null as boolean | null } };
      }
      let changed = false;
      if (!state) {
        state = initDiagnosticState(pool, blueprint);
        changed = true;
      }
      let lastCorrect: boolean | null = null;
      try {
        if (answer) {
          const q = ctx.questions.get(answer.question_id);
          if (!q) throw new DiagnosticRuleError('unknown_question', 'question not in attempt');
          const correct = grade(q.content, answer.answer).is_correct === true;
          state = diagnosticAdvance(pool, blueprint, state, { question_id: answer.question_id, correct }).state;
          lastCorrect = correct;
          changed = true;
        }
        if (!state.current && !state.done) {
          state = diagnosticAdvance(pool, blueprint, state).state;
          changed = true;
        }
      } catch (err) {
        if (err instanceof DiagnosticRuleError) throw new Conflict(err.code === 'already_done' ? 'Diagnostic already finished' : 'Answer is not for the current question', { reason: err.code, current_question_id: state.current });
        throw err;
      }
      return { answer: answer ? { question_id: answer.question_id, answer: answer.answer, time_spent_ms: answer.time_spent_ms } : undefined, adaptive: changed ? state : undefined, result: { ...base, state, lastCorrect } };
    });
    const state = r.state;
    let result: DiagnosticResult | null = null;
    if (state?.done) {
      if (r.open) await this.attempts.submit(userId, attemptId);
      result = await this.finalize(userId, attemptId, r.program as ProgramCode, state);
    }
    const current = state?.current ? r.questions.get(state.current) : undefined;
    const [pub] = current ? await this.catalog.toPublic([current], { revealTranscript: false }) : [];
    const answered = state?.served.filter((s) => s.correct !== null) ?? [];
    const servedNow = state?.served.find((s) => s.question_id === state.current);
    return {
      attempt_id: attemptId,
      done: !!state?.done,
      next_question: pub ? (pub) : null,
      progress: { answered: answered.length, served: state?.served.length ?? 0, planned: Math.max(state?.planned ?? 0, state?.served.length ?? 0), section_code: current?.section_code ?? null, level: servedNow?.level ?? null, group_remaining: state?.queue.length ?? 0 },
      estimate: answered.length && r.program === 'toeic' ? toEstimateDto(estimateToeicDiagnostic(state!.served)) : null,
      last_correct: r.lastCorrect,
      result,
    };
  }

  /** Kết quả cuối (idempotent): mastery theo subskill + current_level + gợi ý mục tiêu */
  async finalize(userId: string, attemptId: string, program: ProgramCode, state: DiagnosticState): Promise<DiagnosticResult> {
    const estimate = estimateToeicDiagnostic(state.served);
    const mastery = masteryFromDiagnostic(state.served);
    const enrollment = await this.enrollments.ensure(userId, program);
    const level = (enrollment.currentLevel ?? {}) as { attempt_id?: string };
    if (level.attempt_id !== attemptId) {
      const ids = await this.catalog.subskillIdsByCode(program);
      const now = new Date(this.clock.now());
      await this.dbs.db.transaction(async (tx) => {
        for (const m of mastery) {
          const subskillId = ids.get(m.subskill);
          if (!subskillId) continue;
          await tx
            .insert(learnSkillMastery)
            .values({ userId, programCode: program, subskillId, mastery: String(m.mastery), confidence: String(m.confidence), nObs: m.n_obs, updatedAt: now })
            .onConflictDoUpdate({ target: [learnSkillMastery.userId, learnSkillMastery.subskillId], set: { mastery: sql`excluded.mastery`, confidence: sql`excluded.confidence`, nObs: sql`excluded.n_obs`, programCode: sql`excluded.program_code`, updatedAt: sql`excluded.updated_at` } });
        }
        await this.enrollments.setCurrentLevel(userId, program, { overall: estimate.total?.score ?? null, listening: estimate.by_skill.listening?.score ?? null, reading: estimate.by_skill.reading?.score ?? null, low: estimate.total?.low ?? null, high: estimate.total?.high ?? null, source: 'diagnostic', attempt_id: attemptId, estimated_at: now.toISOString() }, tx);
      });
      this.logger.info({ attempt_id: attemptId, answered: estimate.answered, subskills: mastery.length }, 'diagnostic finalized');
    }
    const tree = await this.plans.currentTree(userId, program);
    const { today } = await this.plans.userCtx(userId);
    const fresh = await this.enrollments.get(userId, program);
    const weekly = tree?.strategy.settings.weekly_minutes ?? (fresh?.dailyMinutes ?? 30) * 7;
    const target = suggestToeicTarget({ current: estimate.total?.score ?? 10, today: today ?? localDate(this.clock.now(), 'Asia/Ho_Chi_Minh'), examDate: fresh?.examDate ?? null, weeklyMinutes: weekly, desired: fresh?.targetScore !== null && fresh?.targetScore !== undefined ? Number(fresh.targetScore) : null });
    return {
      attempt_id: attemptId,
      estimate: toEstimateDto(estimate),
      mastery: mastery.map((m) => ({ subskill: m.subskill, skill: m.skill, mastery: m.mastery, confidence: m.confidence, n_obs: m.n_obs })),
      target: { current: target.current, suggested: target.suggested, desired: target.desired, feasible: target.feasible, weeks_left: target.weeks_left, weekly_minutes: target.weekly_minutes, required_weekly_minutes: target.required_weekly_minutes, reason: target.reason },
    };
  }
}
