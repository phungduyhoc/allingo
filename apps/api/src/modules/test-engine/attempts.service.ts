import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { toeicLr, TOEIC_PART_SKILL, SCALE_INFO, ieltsLrBand } from '@allingo/scoring';
import {
  ATTEMPT_GRACE_SECONDS,
  DOMAIN_EVENTS,
  FEATURE_CODES,
  XP_RULES,
  attemptDraftStateSchema,
  grade,
  isAnswered,
  correctAnswerOf,
  type AnswerInput,
  type Attempt,
  type AttemptAnswerInput,
  type AttemptAnswersPut,
  type AttemptCreate,
  type AttemptDraftState,
  type AttemptEvent,
  type AttemptResult,
  type AttemptReview,
  type AttemptSummary,
  type FeatureCode,
  type LocalizedText,
  type ProgramCode,
  type ScoreBreakdown,
} from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { IdempotencyService } from '../../shared/http/idempotency.js';
import { Conflict, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { encodeCursor, decodeCursor } from '../../shared/http/cursor.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CatalogQueryService, type LoadedQuestion } from '../catalog/index.js';
import { EntitlementService, QuotaService } from '../billing/index.js';
import { EXAM_LOCK_KEY, ExplanationCacheService } from '../ai-gateway/index.js';
import { EnrollmentsService, UsersService } from '../iam/index.js';

const { learnAttempts, learnAttemptAnswers, catalogTestSets } = schema;
type AttemptRow = typeof learnAttempts.$inferSelect;

/**
 * Test Engine (master prompt §4.1 D): attempt có snapshot question_version, nháp idempotent, nộp idempotent, chấm bằng
 * packages/schemas.grade(), quy đổi điểm bằng packages/scoring, outbox attempt.graded, XP cho learning.
 */
@Injectable()
export class AttemptsService {
  private readonly logger = getLogger({ component: 'test-engine' });

  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly idem: IdempotencyService,
    private readonly catalog: CatalogQueryService,
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly explanationCache: ExplanationCacheService,
    private readonly enrollments: EnrollmentsService,
    private readonly users: UsersService,
  ) {}

  // ------------------------------------------------------------------ tạo attempt
  async create(userId: string, input: AttemptCreate, idempotencyKey?: string): Promise<Attempt> {
    const existing = await this.idem.get<{ attempt_id: string }>(userId, idempotencyKey);
    if (existing) return this.get(userId, existing.attempt_id);

    let questions: LoadedQuestion[];
    let feature: FeatureCode;
    let timeLimitSec: number | null = null;
    let testSetTitle: LocalizedText | null = null;
    if (input.test_set_id) {
      const ts = await this.catalog.requireTestSetPublished(input.test_set_id);
      if (ts.ts.programCode !== input.program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'test set belongs to another program' }] });
      questions = await this.catalog.loadTestSetQuestions(input.test_set_id);
      feature = ts.ts.kind === 'full' ? FEATURE_CODES.FULL_TEST : ts.ts.kind === 'part_drill' ? FEATURE_CODES.PART_DRILL : FEATURE_CODES.MINI_TEST;
      timeLimitSec = input.mode === 'exam' ? (ts.ts.durationSec ?? null) : null;
      testSetTitle = ts.ts.title;
      const ctx = await this.entitlements.getContext(userId, input.program);
      if (!ts.ts.isFree && !ctx.features.has(feature)) throw new Forbidden('Test set requires an upgrade', { feature, upgrade: true });
    } else if (input.section_id) {
      const section = await this.catalog.sectionById(input.section_id);
      if (!section || section.programCode !== input.program) throw new NotFound('section', input.section_id);
      questions = await this.catalog.randomQuestions(input.program, { section_code: section.code, count: 10 });
      feature = FEATURE_CODES.PART_DRILL;
      timeLimitSec = input.mode === 'timed_drill' ? questions.length * 45 : null;
    } else {
      throw new ValidationFailed({ issues: [{ path: 'test_set_id', message: 'test_set_id or section_id is required' }] });
    }
    if (questions.length === 0) throw new ValidationFailed({ issues: [{ path: 'test_set_id', message: 'no published questions' }] });

    const ctx = await this.entitlements.getContext(userId, input.program);
    const quota = await this.quotas.consume(userId, ctx.planKind, feature);
    try {
      const now = new Date();
      const expiresAt = timeLimitSec ? new Date(now.getTime() + timeLimitSec * 1000) : null;
      const draft: AttemptDraftState = {
        question_order: questions.map((q) => ({ question_id: q.question_id, question_version_id: q.question_version_id, section_code: q.section_code, group_key: q.group_key, order_no: q.order_no })),
        time_limit_sec: timeLimitSec,
        expires_at: expiresAt?.toISOString() ?? null,
        section_elapsed_sec: {},
        ui_state: {},
        events: [],
        answered_count: 0,
        last_saved_at: null,
      };
      const attemptId = await this.dbs.db.transaction(async (tx) => {
        await this.enrollments.ensure(userId, input.program, tx);
        const [row] = await tx
          .insert(learnAttempts)
          .values({ userId, programCode: input.program, testSetId: input.test_set_id ?? null, sectionId: input.section_id ?? null, mode: input.mode, status: 'in_progress', draftState: draft, device: input.device ?? null, planTaskId: input.plan_task_id ?? null })
          .returning({ id: learnAttempts.id });
        await this.outbox.write(tx, { aggregateType: 'attempt', aggregateId: row!.id, eventType: DOMAIN_EVENTS.ATTEMPT_STARTED, payload: { attempt_id: row!.id, user_id: userId, program: input.program, mode: input.mode, test_set_id: input.test_set_id ?? null, question_count: questions.length } });
        return row!.id;
      });
      if (input.mode === 'exam') {
        const ttl = timeLimitSec ? timeLimitSec + ATTEMPT_GRACE_SECONDS + 60 : 4 * 3600;
        await this.redis.safe((r) => r.set(EXAM_LOCK_KEY(userId), attemptId, 'EX', ttl));
      }
      await this.idem.set(userId, idempotencyKey, { attempt_id: attemptId });
      this.logger.info({ attempt_id: attemptId, mode: input.mode, questions: questions.length, quota: quota?.used }, 'attempt created');
      return this.assemble(userId, attemptId, questions, { testSetTitle });
    } catch (err) {
      await this.quotas.refund(userId, ctx.planKind, feature);
      throw err;
    }
  }

  // ------------------------------------------------------------------ đọc
  private async ownedAttempt(userId: string, attemptId: string, db: DbOrTx = this.dbs.db, lock = false): Promise<AttemptRow> {
    const q = db.select().from(learnAttempts).where(eq(learnAttempts.id, attemptId)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new NotFound('attempt', attemptId);
    if (row.userId !== userId) throw new Forbidden();
    return row;
  }

  private draftOf(row: AttemptRow): AttemptDraftState {
    return attemptDraftStateSchema.parse(row.draftState ?? {});
  }

  async get(userId: string, attemptId: string): Promise<Attempt> {
    const row = await this.ownedAttempt(userId, attemptId);
    const draft = this.draftOf(row);
    const map = await this.catalog.loadByVersionIds(draft.question_order.map((q) => q.question_version_id));
    const questions = draft.question_order.map((o) => {
      const q = map.get(o.question_version_id);
      if (!q) throw new NotFound('question_version', o.question_version_id);
      return { ...q, group_key: o.group_key, order_no: o.order_no, section_code: o.section_code };
    });
    const title = row.testSetId ? ((await this.dbs.db.select({ title: catalogTestSets.title }).from(catalogTestSets).where(eq(catalogTestSets.id, row.testSetId)).limit(1))[0]?.title) ?? null : null;
    return this.assemble(userId, attemptId, questions, { testSetTitle: title, row });
  }

  private async assemble(userId: string, attemptId: string, questions: LoadedQuestion[], opts: { testSetTitle: LocalizedText | null; row?: AttemptRow }): Promise<Attempt> {
    const row = opts.row ?? (await this.ownedAttempt(userId, attemptId));
    const draft = this.draftOf(row);
    const publicQs = await this.catalog.toPublic(questions);
    const answers = await this.dbs.db.select().from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, attemptId));
    const draftAnswers: AttemptAnswerInput[] = answers.filter((a) => a.answer).map((a) => ({ question_id: a.questionId, answer: a.answer as AnswerInput, time_spent_ms: a.timeSpentMs ?? undefined, flagged: a.flagged }));
    const sectionCodes = [...new Set(draft.question_order.map((q) => q.section_code))];
    const sections = row.testSetId ? await this.catalog.testSetSections(row.testSetId) : [];
    const now = new Date();
    const testSet = row.testSetId ? { id: row.testSetId, title: opts.testSetTitle ?? {}, kind: 'mini' } : null;
    return {
      id: row.id,
      program: row.programCode as ProgramCode,
      mode: row.mode,
      status: row.status,
      test_set: testSet,
      sections: sectionCodes.map((code) => {
        const s = sections.find((x) => x.code === code);
        return { section_code: code, duration_sec: s?.test_duration_sec ?? s?.duration_sec ?? null, elapsed_sec: draft.section_elapsed_sec[code] ?? 0, locked: false };
      }),
      questions: publicQs,
      draft_answers: draftAnswers,
      started_at: row.startedAt.toISOString(),
      expires_at: draft.expires_at,
      server_time: now.toISOString(),
      ui_state: draft.ui_state,
    };
  }

  // ------------------------------------------------------------------ lưu nháp
  private assertOpen(row: AttemptRow, draft: AttemptDraftState): void {
    if (row.status !== 'in_progress') throw new Conflict('Attempt is not in progress', { status: row.status });
    if (draft.expires_at && Date.now() > new Date(draft.expires_at).getTime() + ATTEMPT_GRACE_SECONDS * 1000) throw new Conflict('Attempt has expired', { expires_at: draft.expires_at });
  }

  async saveAnswers(userId: string, attemptId: string, input: AttemptAnswersPut): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      const row = await this.ownedAttempt(userId, attemptId, tx, true);
      const draft = this.draftOf(row);
      this.assertOpen(row, draft);
      const order = new Map(draft.question_order.map((q) => [q.question_id, q]));
      const versions = await this.catalog.loadByVersionIds([...new Set(input.answers.map((a) => order.get(a.question_id)?.question_version_id).filter((x): x is string => !!x))], tx);
      for (const a of input.answers) {
        const o = order.get(a.question_id);
        if (!o) throw new ValidationFailed({ issues: [{ path: 'answers', message: `question ${a.question_id} not in attempt` }] });
        const q = versions.get(o.question_version_id);
        if (q && q.question_type !== a.answer.type) throw new ValidationFailed({ issues: [{ path: 'answers', message: `answer type ${a.answer.type} does not match question type ${q.question_type}` }] });
        const [existing] = await tx.select({ id: learnAttemptAnswers.id }).from(learnAttemptAnswers).where(and(eq(learnAttemptAnswers.attemptId, attemptId), eq(learnAttemptAnswers.questionId, a.question_id))).limit(1);
        if (existing) {
          await tx
            .update(learnAttemptAnswers)
            .set({ answer: a.answer, timeSpentMs: a.time_spent_ms ?? undefined, flagged: a.flagged ?? undefined })
            .where(eq(learnAttemptAnswers.id, existing.id));
        } else {
          await tx.insert(learnAttemptAnswers).values({ attemptId, questionId: a.question_id, questionVersionId: o.question_version_id, answer: a.answer, timeSpentMs: a.time_spent_ms ?? null, flagged: a.flagged ?? false });
        }
      }
      const answered = await tx.select({ answer: learnAttemptAnswers.answer }).from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, attemptId));
      const next: AttemptDraftState = {
        ...draft,
        section_elapsed_sec: { ...draft.section_elapsed_sec, ...(input.section_elapsed_sec ?? {}) },
        ui_state: { ...draft.ui_state, ...(input.ui_state ?? {}) },
        answered_count: answered.filter((x) => isAnswered(x.answer)).length,
        last_saved_at: new Date().toISOString(),
      };
      await tx.update(learnAttempts).set({ draftState: next }).where(eq(learnAttempts.id, attemptId));
    });
  }

  async addEvent(userId: string, attemptId: string, ev: AttemptEvent): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      const row = await this.ownedAttempt(userId, attemptId, tx, true);
      const draft = this.draftOf(row);
      const events = [...draft.events, { ...ev, at: ev.at ?? new Date().toISOString() }].slice(-500);
      await tx
        .update(learnAttempts)
        .set({ draftState: { ...draft, events }, tabLeaveCount: ev.type === 'tab_leave' || ev.type === 'focus_lost' ? sql`${learnAttempts.tabLeaveCount} + 1` : undefined })
        .where(eq(learnAttempts.id, attemptId));
    });
  }

  // ------------------------------------------------------------------ nộp & chấm
  async submit(userId: string, attemptId: string, opts: { auto?: boolean } = {}): Promise<AttemptResult> {
    const result = await this.dbs.db.transaction(async (tx) => {
      const row = await this.ownedAttempt(userId, attemptId, tx, true);
      if (row.status === 'graded' || row.status === 'submitted') return this.resultFromRow(row, tx);
      if (row.status !== 'in_progress') throw new Conflict('Attempt cannot be submitted', { status: row.status });
      const draft = this.draftOf(row);
      const versions = await this.catalog.loadByVersionIds(draft.question_order.map((q) => q.question_version_id), tx);
      const answers = await tx.select().from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, attemptId));
      const answerByQ = new Map(answers.map((a) => [a.questionId, a]));

      const bySection: ScoreBreakdown['by_section'] = {};
      const byType: ScoreBreakdown['by_question_type'] = {};
      const bySub: ScoreBreakdown['by_subskill'] = {};
      const byTopic: ScoreBreakdown['by_topic'] = {};
      let rawScore = 0;
      let maxScore = 0;
      let unanswered = 0;
      let correctCount = 0;
      const statUpdates: Array<{ question_id: string; correct: boolean; time_ms: number | null }> = [];
      const sectionTimes: Record<string, number[]> = {};

      for (const o of draft.question_order) {
        const q = versions.get(o.question_version_id);
        if (!q) continue;
        const a = answerByQ.get(o.question_id);
        const answer = (a?.answer as AnswerInput | null) ?? null;
        if (!isAnswered(answer)) unanswered++;
        const g = grade(q.content, answer);
        const points = q.points || 1;
        const earned = (g.score ?? 0) * points;
        rawScore += earned;
        maxScore += points;
        if (g.is_correct) correctCount++;
        if (a) {
          await tx.update(learnAttemptAnswers).set({ isCorrect: g.is_correct, score: String(Math.round(earned * 100) / 100) }).where(eq(learnAttemptAnswers.id, a.id));
        } else {
          await tx.insert(learnAttemptAnswers).values({ attemptId, questionId: o.question_id, questionVersionId: o.question_version_id, answer: null, isCorrect: g.is_correct, score: '0', flagged: false });
        }
        const bump = (m: Record<string, { correct: number; total: number }>, k: string) => {
          m[k] = m[k] ?? { correct: 0, total: 0 };
          m[k].total++;
          if (g.is_correct) m[k].correct++;
        };
        const sec = (bySection[o.section_code] ??= { correct: 0, total: 0, avg_time_ms: null, score: null });
        sec.total++;
        if (g.is_correct) sec.correct++;
        if (a?.timeSpentMs !== null && a?.timeSpentMs !== undefined) (sectionTimes[o.section_code] ??= []).push(a.timeSpentMs);
        bump(byType, q.question_type);
        for (const s of q.subskill_codes) bump(bySub, s);
        if (q.topic_code) bump(byTopic, q.topic_code);
        if (g.is_correct !== null) statUpdates.push({ question_id: q.question_id, correct: g.is_correct, time_ms: a?.timeSpentMs ?? null });
      }
      for (const [code, times] of Object.entries(sectionTimes)) bySection[code]!.avg_time_ms = Math.round(times.reduce((x, y) => x + y, 0) / times.length);

      const scaled = this.scale(row.programCode, bySection);
      const breakdown: ScoreBreakdown = { by_section: bySection, by_question_type: byType, by_subskill: bySub, by_topic: byTopic, unanswered, scale: scaled.scale, timeout_wrong: 0 };
      const timeSpent = Math.max(0, Math.round((Date.now() - row.startedAt.getTime()) / 1000));
      const xp = (row.mode === 'exam' && draft.question_order.length >= 100 ? XP_RULES.attempt_full_test_submitted : XP_RULES.attempt_submitted) + correctCount * XP_RULES.question_correct;

      await tx
        .update(learnAttempts)
        .set({ status: 'graded', submittedAt: new Date(), timeSpentSec: timeSpent, rawScore: String(Math.round(rawScore * 100) / 100), scaledScore: scaled.value !== null ? String(scaled.value) : null, scoreBreakdown: breakdown, draftState: { ...draft, last_saved_at: new Date().toISOString() } })
        .where(eq(learnAttempts.id, attemptId));
      await this.catalog.bumpQuestionStats(tx, statUpdates);

      const payload = { attempt_id: attemptId, user_id: userId, program: row.programCode, mode: row.mode, test_set_id: row.testSetId, raw_score: rawScore, max_score: maxScore, scaled_score: scaled.value, correct: correctCount, total: draft.question_order.length, xp_earned: xp, auto_submitted: !!opts.auto, time_spent_sec: timeSpent, wrong_question_ids: [...answerByQ.values()].filter((a) => a.isCorrect === false).map((a) => a.questionId) };
      await this.outbox.write(tx, { aggregateType: 'attempt', aggregateId: attemptId, eventType: DOMAIN_EVENTS.ATTEMPT_GRADED, payload });
      const previous = await this.previousScaled(tx, userId, row.programCode, attemptId, row.testSetId, scaled.value);
      return { payload, breakdown, rawScore, scaled: scaled.value, previous, xp, fresh: true as const };
    });

    if ('fresh' in result && result.fresh) {
      await this.redis.safe(async (r) => {
        const lock = await r.get(EXAM_LOCK_KEY(userId));
        if (lock === attemptId) await r.del(EXAM_LOCK_KEY(userId));
        return null;
      });
      this.outbox.emitLocal(DOMAIN_EVENTS.ATTEMPT_GRADED, result.payload);
      return {
        attempt_id: attemptId,
        raw_score: result.rawScore,
        scaled_score: result.scaled,
        scale: result.breakdown.scale,
        by_section: result.breakdown.by_section,
        by_question_type: result.breakdown.by_question_type,
        by_subskill: result.breakdown.by_subskill,
        compared_to_previous: result.previous,
        diagnosis: null,
        xp_earned: result.xp,
      };
    }
    return result as AttemptResult;
  }

  private async previousScaled(tx: DbOrTx, userId: string, program: string, attemptId: string, testSetId: string | null, currentScaled: number | null) {
    const [prev] = await tx
      .select({ id: learnAttempts.id, scaled: learnAttempts.scaledScore })
      .from(learnAttempts)
      .where(and(eq(learnAttempts.userId, userId), eq(learnAttempts.programCode, program), eq(learnAttempts.status, 'graded'), sql`${learnAttempts.id} <> ${attemptId}`, testSetId ? eq(learnAttempts.testSetId, testSetId) : sql`true`))
      .orderBy(desc(learnAttempts.submittedAt))
      .limit(1);
    if (!prev) return null;
    const prevScaled = prev.scaled !== null ? Number(prev.scaled) : null;
    return { previous_attempt_id: prev.id, scaled_delta: prevScaled !== null && currentScaled !== null ? Math.round((currentScaled - prevScaled) * 100) / 100 : null };
  }

  private scale(program: string, bySection: ScoreBreakdown['by_section']): { value: number | null; scale: Record<string, unknown> } {
    if (program === 'toeic') {
      const agg = { listening: { correct: 0, total: 0 }, reading: { correct: 0, total: 0 } };
      for (const [code, s] of Object.entries(bySection)) {
        const skill = TOEIC_PART_SKILL[code];
        if (!skill) continue;
        agg[skill].correct += s.correct;
        agg[skill].total += s.total;
      }
      const r = toeicLr({ listening: agg.listening.total ? agg.listening : undefined, reading: agg.reading.total ? agg.reading : undefined });
      for (const [code, s] of Object.entries(bySection)) {
        const skill = TOEIC_PART_SKILL[code];
        if (skill) s.score = r[skill];
      }
      const value = r.total ?? r.listening ?? r.reading;
      return { value, scale: { ...SCALE_INFO.toeic, listening: r.listening, reading: r.reading, total: r.total, ci: r.ci, partial: r.total === null } };
    }
    if (program === 'ielts') {
      let correct = 0;
      let total = 0;
      for (const s of Object.values(bySection)) {
        correct += s.correct;
        total += s.total;
      }
      const band = total ? ieltsLrBand(correct, total) : null;
      return { value: band, scale: { ...SCALE_INFO.ielts, band } };
    }
    const info = SCALE_INFO[program as keyof typeof SCALE_INFO] ?? SCALE_INFO.toeic;
    return { value: null, scale: { ...info } };
  }

  private async resultFromRow(row: AttemptRow, tx: DbOrTx): Promise<AttemptResult> {
    const b = (row.scoreBreakdown) ?? { by_section: {}, by_question_type: {}, by_subskill: {}, by_topic: {}, unanswered: 0, scale: {}, timeout_wrong: 0 };
    const previous = await this.previousScaled(tx, row.userId, row.programCode, row.id, row.testSetId, row.scaledScore !== null ? Number(row.scaledScore) : null);
    return { attempt_id: row.id, raw_score: Number(row.rawScore ?? 0), scaled_score: row.scaledScore !== null ? Number(row.scaledScore) : null, scale: b.scale, by_section: b.by_section, by_question_type: b.by_question_type, by_subskill: b.by_subskill, compared_to_previous: previous, diagnosis: null, xp_earned: 0 };
  }

  async result(userId: string, attemptId: string): Promise<AttemptResult> {
    const row = await this.ownedAttempt(userId, attemptId);
    if (row.status !== 'graded') throw new Conflict('Attempt is not graded yet', { status: row.status });
    return this.resultFromRow(row, this.dbs.db);
  }

  // ------------------------------------------------------------------ review
  async review(userId: string, attemptId: string, onlyWrong = false): Promise<AttemptReview> {
    const row = await this.ownedAttempt(userId, attemptId);
    if (row.status !== 'graded') throw new Conflict('Attempt is not graded yet', { status: row.status });
    const draft = this.draftOf(row);
    const versions = await this.catalog.loadByVersionIds(draft.question_order.map((q) => q.question_version_id));
    const answers = await this.dbs.db.select().from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, attemptId));
    const answerByQ = new Map(answers.map((a) => [a.questionId, a]));
    const user = await this.users.findById(userId);
    const locale = user?.explainLocale ?? 'vi';
    const ordered = draft.question_order.map((o) => ({ o, q: versions.get(o.question_version_id)! })).filter((x) => x.q);
    const publicQs = await this.catalog.toPublic(ordered.map((x) => ({ ...x.q, group_key: x.o.group_key, order_no: x.o.order_no, section_code: x.o.section_code })));
    const items = [];
    for (let i = 0; i < ordered.length; i++) {
      const { o, q } = ordered[i]!;
      const a = answerByQ.get(o.question_id);
      const answer = (a?.answer as AnswerInput | null) ?? null;
      const g = grade(q.content, answer);
      if (onlyWrong && g.is_correct !== false) continue;
      const chosen = answer && answer.type === 'mcq_single' ? answer.selected : null;
      const explanation = await this.explanationCache.get(q.question_version_id, chosen, locale);
      items.push({
        question: publicQs[i]!,
        your_answer: answer,
        correct_answer: correctAnswerOf(q.content),
        is_correct: g.is_correct,
        score: g.score,
        time_spent_ms: a?.timeSpentMs ?? null,
        flagged: a?.flagged ?? false,
        details: g.details ?? null,
        explanation: explanation ? { ...explanation.content, locale, cached: true, ai_task_id: null } : null,
        transcript_highlight: null,
        error_entry_id: null,
        community_correct_rate: q.exposure_count > 0 ? Math.round((q.correct_count / q.exposure_count) * 1000) / 10 : null,
      });
    }
    return { attempt_id: attemptId, items };
  }

  // ------------------------------------------------------------------ danh sách
  async listMine(userId: string, q: { program?: string; mode?: string; cursor?: string; limit: number }): Promise<{ data: AttemptSummary[]; next_cursor: string | null }> {
    const c = decodeCursor<{ started_at: string; id: string }>(q.cursor);
    const rows = await this.dbs.db
      .select({ a: learnAttempts, title: catalogTestSets.title })
      .from(learnAttempts)
      .leftJoin(catalogTestSets, eq(catalogTestSets.id, learnAttempts.testSetId))
      .where(
        and(
          eq(learnAttempts.userId, userId),
          q.program ? eq(learnAttempts.programCode, q.program) : sql`true`,
          q.mode ? eq(learnAttempts.mode, q.mode as never) : sql`true`,
          c ? sql`(${learnAttempts.startedAt}, ${learnAttempts.id}) < (${new Date(c.started_at)}, ${c.id}::uuid)` : sql`true`,
        ),
      )
      .orderBy(desc(learnAttempts.startedAt), desc(learnAttempts.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => ({ id: r.a.id, program: r.a.programCode, mode: r.a.mode, status: r.a.status, test_set_title: (r.title) ?? null, raw_score: r.a.rawScore !== null ? Number(r.a.rawScore) : null, scaled_score: r.a.scaledScore !== null ? Number(r.a.scaledScore) : null, started_at: r.a.startedAt.toISOString(), submitted_at: r.a.submittedAt?.toISOString() ?? null })),
      next_cursor: rows.length > q.limit ? encodeCursor({ started_at: page.at(-1)!.a.startedAt.toISOString(), id: page.at(-1)!.a.id }) : null,
    };
  }

  /** Practice: tạo attempt drill từ câu ngẫu nhiên */
  async practice(userId: string, q: { program: ProgramCode; section?: string; question_type?: string; topic?: string; subskill?: string; count: number; timed: boolean }): Promise<Attempt> {
    const questions = await this.catalog.randomQuestions(q.program, { section_code: q.section, question_type: q.question_type, topic: q.topic, subskill: q.subskill, count: q.count });
    if (questions.length === 0) throw new NotFound('questions');
    const ctx = await this.entitlements.getContext(userId, q.program);
    await this.quotas.consume(userId, ctx.planKind, FEATURE_CODES.PART_DRILL);
    const timeLimitSec = q.timed ? questions.length * 45 : null;
    const draft: AttemptDraftState = {
      question_order: questions.map((x) => ({ question_id: x.question_id, question_version_id: x.question_version_id, section_code: x.section_code, group_key: null, order_no: x.order_no })),
      time_limit_sec: timeLimitSec,
      expires_at: timeLimitSec ? new Date(Date.now() + timeLimitSec * 1000).toISOString() : null,
      section_elapsed_sec: {},
      ui_state: {},
      events: [],
      answered_count: 0,
      last_saved_at: null,
    };
    const attemptId = await this.dbs.db.transaction(async (tx) => {
      await this.enrollments.ensure(userId, q.program, tx);
      const [row] = await tx.insert(learnAttempts).values({ userId, programCode: q.program, mode: q.timed ? 'timed_drill' : 'drill', status: 'in_progress', draftState: draft }).returning({ id: learnAttempts.id });
      return row!.id;
    });
    return this.assemble(userId, attemptId, questions, { testSetTitle: null });
  }

  /** Job: tự nộp attempt exam quá hạn (worker, mỗi phút) */
  async expireOverdue(limit = 100): Promise<number> {
    const rows = await this.dbs.db
      .select({ id: learnAttempts.id, userId: learnAttempts.userId })
      .from(learnAttempts)
      .where(and(eq(learnAttempts.status, 'in_progress'), sql`(${learnAttempts.draftState} ->> 'expires_at') is not null`, sql`(${learnAttempts.draftState} ->> 'expires_at')::timestamptz + make_interval(secs => ${ATTEMPT_GRACE_SECONDS}) < now()`))
      .limit(limit);
    let n = 0;
    for (const r of rows) {
      try {
        await this.submit(r.userId, r.id, { auto: true });
        n++;
      } catch (err) {
        this.logger.warn({ attempt_id: r.id, err: (err as Error).message }, 'auto-submit failed');
      }
    }
    return n;
  }

  /** Dùng cho learning (XP) & analytics: đọc nhanh attempt ids theo user */
  async countGraded(userId: string, program: string): Promise<number> {
    const [r] = await this.dbs.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(learnAttempts).where(and(eq(learnAttempts.userId, userId), eq(learnAttempts.programCode, program), eq(learnAttempts.status, 'graded')));
    return r?.n ?? 0;
  }

  async statsSource(userId: string, program: string) {
    return this.dbs.db
      .select({ id: learnAttempts.id, mode: learnAttempts.mode, scaled: learnAttempts.scaledScore, raw: learnAttempts.rawScore, breakdown: learnAttempts.scoreBreakdown, submittedAt: learnAttempts.submittedAt, timeSpentSec: learnAttempts.timeSpentSec })
      .from(learnAttempts)
      .where(and(eq(learnAttempts.userId, userId), eq(learnAttempts.programCode, program), eq(learnAttempts.status, 'graded'), inArray(learnAttempts.mode, ['exam', 'practice', 'diagnostic', 'drill', 'timed_drill'])))
      .orderBy(desc(learnAttempts.submittedAt))
      .limit(100);
  }
}
