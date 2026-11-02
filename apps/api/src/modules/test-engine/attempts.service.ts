import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { diagnoseAttempt, toeicLrEstimate, TOEIC_PART_SKILL, SCALE_INFO, ieltsLrBand, type DiagnosisQuestion } from '@allingo/scoring';
import {
  ATTEMPT_GRACE_SECONDS,
  AUDIO_PLAY_EVENT_TYPES,
  DOMAIN_EVENTS,
  XP_RULES,
  gateForTestSetKind,
  attemptDraftStateSchema,
  grade,
  isAnswered,
  correctAnswerOf,
  timedDrillBudgetSeconds,
  type AnswerInput,
  type AttemptMediaList,
  type Attempt,
  type AttemptAnswerInput,
  type AttemptAnswersPut,
  type AttemptCreate,
  type AttemptDraftState,
  type AttemptEvent,
  type AttemptResult,
  type AttemptReview,
  type AttemptSummary,
  type GateKey,
  type LocalizedText,
  type ProgramCode,
  type ScoreBreakdown,
  type SkillBreakdown,
  type ToeicScaled,
  type TranscriptHighlight,
} from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { IdempotencyService } from '../../shared/http/idempotency.js';
import { Conflict, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { encodeCursor, decodeCursor } from '../../shared/http/cursor.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CatalogQueryService, SearchService, type LoadedQuestion, type PracticeHistory } from '../catalog/index.js';
import { FeatureGateService } from '../billing/index.js';
import { AiGatewayService, ExplanationCacheService } from '../ai-gateway/index.js';
import { EnrollmentsService, UsersService } from '../iam/index.js';
import { EXAM_LOCK_KEY } from '../../shared/exam/exam-mode.js';
import { NotesService } from './notes.service.js';

const { learnAttempts, learnAttemptAnswers, catalogTestSets } = schema;
type AttemptRow = typeof learnAttempts.$inferSelect;

/**
 * Test Engine (master prompt §4.1 D): attempt có snapshot question_version, nháp idempotent, nộp idempotent, chấm bằng
 * packages/schemas.grade(), quy đổi điểm bằng packages/scoring, outbox attempt.graded, XP cho learning.
 */
/** Chế độ được xem đáp án ngay sau khi trả lời */
const FEEDBACK_MODES: ReadonlySet<string> = new Set(['practice', 'drill']);
/** "Câu sai gần đây" cho nguồn câu luyện (Sprint 4) */
const WRONG_RECENT_DAYS = 30;
/** Câu luyện khi tạo attempt từ section_id (POST /attempts) */
const SECTION_DRILL_COUNT = 10;

type TestSetInfo = { title: LocalizedText | null; kind: string } | null;

@Injectable()
export class AttemptsService {
  private readonly logger = getLogger({ component: 'test-engine' });

  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly idem: IdempotencyService,
    private readonly catalog: CatalogQueryService,
    private readonly search: SearchService,
    private readonly gate: FeatureGateService,
    private readonly explanationCache: ExplanationCacheService,
    private readonly enrollments: EnrollmentsService,
    private readonly users: UsersService,
    private readonly gateway: AiGatewayService,
    private readonly notes: NotesService,
  ) {}

  // ------------------------------------------------------------------ tạo attempt
  async create(userId: string, input: AttemptCreate, idempotencyKey?: string): Promise<Attempt> {
    const existing = await this.idem.get<{ attempt_id: string }>(userId, idempotencyKey);
    if (existing) return this.get(userId, existing.attempt_id);

    let questions: LoadedQuestion[];
    let gateKey: GateKey;
    let contentIsFree = false;
    let timeLimitSec: number | null = null;
    let testSet: TestSetInfo = null;
    if (input.test_set_id) {
      const ts = await this.catalog.requireTestSetPublished(input.test_set_id);
      if (ts.ts.programCode !== input.program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'test set belongs to another program' }] });
      questions = await this.catalog.loadTestSetQuestions(input.test_set_id);
      // Gating S7: bảng FEATURE_GATES (packages/config/entitlements.ts) – đề miễn phí bỏ qua quyền nhưng vẫn tiêu quota
      gateKey = gateForTestSetKind(ts.ts.kind);
      contentIsFree = ts.ts.isFree;
      // exam: đồng hồ của đề; timed_drill: giới hạn theo Part (Sprint 4); practice/drill/diagnostic: không giới hạn
      timeLimitSec = input.mode === 'exam' ? (ts.ts.durationSec ?? null) : input.mode === 'timed_drill' ? await this.timedDrillBudget(questions) : null;
      testSet = { title: ts.ts.title, kind: ts.ts.kind };
      // Kiểm tra quyền trước khi tải/đếm (403 sớm, không tiêu quota)
      await this.gate.check(userId, input.program, gateKey, { contentIsFree });
    } else if (input.section_id) {
      const section = await this.catalog.sectionById(input.section_id);
      if (!section || section.programCode !== input.program) throw new NotFound('section', input.section_id);
      questions = await this.catalog.randomQuestions(input.program, { section_code: section.code, count: SECTION_DRILL_COUNT, history: await this.practiceHistory(userId, input.program) });
      gateKey = 'part_drill';
      timeLimitSec = input.mode === 'timed_drill' ? await this.timedDrillBudget(questions) : null;
    } else {
      throw new ValidationFailed({ issues: [{ path: 'test_set_id', message: 'test_set_id or section_id is required' }] });
    }
    if (questions.length === 0) throw new ValidationFailed({ issues: [{ path: 'test_set_id', message: 'no published questions' }] });

    const ticket = await this.gate.consume(userId, input.program, gateKey, { contentIsFree });
    const quota = ticket.quota;
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
        audio_plays: {},
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
      return this.assemble(userId, attemptId, questions, { testSet });
    } catch (err) {
      await ticket.release();
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
    const ts = row.testSetId ? (await this.dbs.db.select({ title: catalogTestSets.title, kind: catalogTestSets.kind }).from(catalogTestSets).where(eq(catalogTestSets.id, row.testSetId)).limit(1))[0] : undefined;
    return this.assemble(userId, attemptId, questions, { testSet: ts ? { title: ts.title, kind: ts.kind } : null, row });
  }

  /**
   * Attempt cho client. KHÔNG BAO GIỜ trả transcript (passage audio_script, chữ Part 1/2) – kể cả sau khi nộp; transcript chỉ có
   * trong GET /review và trong `feedback[...].transcript` của practice/drill sau khi câu (cả nhóm) đã trả lời (Sprint 4).
   */
  private async assemble(userId: string, attemptId: string, questions: LoadedQuestion[], opts: { testSet: TestSetInfo; row?: AttemptRow }): Promise<Attempt> {
    const row = opts.row ?? (await this.ownedAttempt(userId, attemptId));
    const draft = this.draftOf(row);
    const publicQs = await this.catalog.toPublic(questions, { revealTranscript: false });
    const answers = await this.dbs.db.select().from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, attemptId));
    const draftAnswers: AttemptAnswerInput[] = answers.filter((a) => a.answer).map((a) => ({ question_id: a.questionId, answer: a.answer as AnswerInput, time_spent_ms: a.timeSpentMs ?? undefined, flagged: a.flagged }));
    const sectionCodes = [...new Set(draft.question_order.map((q) => q.section_code))];
    const sections = row.testSetId ? await this.catalog.testSetSections(row.testSetId) : [];
    const now = new Date();
    const testSet = row.testSetId ? { id: row.testSetId, title: opts.testSet?.title ?? {}, kind: opts.testSet?.kind ?? 'mini' } : null;
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
      audio_plays: draft.audio_plays,
      ...(FEEDBACK_MODES.has(row.mode) ? { feedback: await this.practiceFeedback(questions, answers) } : {}),
    };
  }

  /**
   * Practice/drill: đáp án + đúng/sai cho câu ĐÃ trả lời để hiện ngay (Sprint 3). Exam/timed/diagnostic không bao giờ có.
   * Giải thích tác giả (explanation seed) theo vi/en nếu có; giải thích AI ở Review (S5).
   */
  private async practiceFeedback(questions: LoadedQuestion[], answers: Array<typeof learnAttemptAnswers.$inferSelect>) {
    const byQ = new Map(questions.map((q) => [q.question_id, q]));
    const answered = new Set(answers.filter((a) => isAnswered(a.answer ?? null)).map((a) => a.questionId));
    // Transcript nhóm (Part 3/4) chỉ hiện khi mọi câu của nhóm trong attempt đã trả lời – tránh lộ đáp án câu chưa làm
    const groupDone = (q: LoadedQuestion) => !q.group_key || questions.every((x) => x.group_key !== q.group_key || answered.has(x.question_id));
    const transcripts = await this.catalog.transcripts(questions.filter((q) => answered.has(q.question_id) && groupDone(q)));
    const out: NonNullable<Attempt['feedback']> = {};
    for (const a of answers) {
      const q = byQ.get(a.questionId);
      const answer = (a.answer) ?? null;
      if (!q || !isAnswered(answer)) continue;
      const g = grade(q.content, answer);
      const expl = (q.content as { explanation?: Record<string, string> }).explanation ?? null;
      out[a.questionId] = { is_correct: g.is_correct, correct_answer: correctAnswerOf(q.content), explanation: expl, transcript: transcripts.get(q.question_id) ?? null };
    }
    return out;
  }

  // ------------------------------------------------------------------ lưu nháp
  private assertOpen(row: AttemptRow, draft: AttemptDraftState): void {
    if (row.status !== 'in_progress') throw new Conflict('Attempt is not in progress', { status: row.status });
    if (draft.expires_at && Date.now() > new Date(draft.expires_at).getTime() + ATTEMPT_GRACE_SECONDS * 1000) throw new Conflict('Attempt has expired', { expires_at: draft.expires_at });
  }

  /**
   * Lưu nháp lô ≤ 100 câu, idempotent (cùng nội dung ghi đè). Tối ưu cho tải cao (Sprint 3): khoá dòng attempt,
   * 1 truy vấn kiểu câu (cache trong tiến trình), 1 truy vấn câu đã có, cập nhật từng câu đổi + 1 lệnh insert gộp, đếm bằng COUNT.
   */
  async saveAnswers(userId: string, attemptId: string, input: AttemptAnswersPut): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      const row = await this.ownedAttempt(userId, attemptId, tx, true);
      const draft = this.draftOf(row);
      this.assertOpen(row, draft);
      const order = new Map(draft.question_order.map((q) => [q.question_id, q]));
      for (const a of input.answers) if (!order.has(a.question_id)) throw new ValidationFailed({ issues: [{ path: 'answers', message: `question ${a.question_id} not in attempt` }] });
      const types = await this.catalog.questionTypesByVersion([...new Set(input.answers.map((a) => order.get(a.question_id)!.question_version_id))], tx);
      for (const a of input.answers) {
        const t = types.get(order.get(a.question_id)!.question_version_id);
        if (t && t !== a.answer.type) throw new ValidationFailed({ issues: [{ path: 'answers', message: `answer type ${a.answer.type} does not match question type ${t}` }] });
      }
      // Lô có thể chứa cùng một câu nhiều lần → giữ bản cuối
      const latest = new Map(input.answers.map((a) => [a.question_id, a]));
      const existing = latest.size
        ? await tx
            .select({ id: learnAttemptAnswers.id, questionId: learnAttemptAnswers.questionId })
            .from(learnAttemptAnswers)
            .where(and(eq(learnAttemptAnswers.attemptId, attemptId), inArray(learnAttemptAnswers.questionId, [...latest.keys()])))
        : [];
      const existingByQ = new Map(existing.map((e) => [e.questionId, e.id]));
      const inserts: Array<typeof learnAttemptAnswers.$inferInsert> = [];
      for (const a of latest.values()) {
        const id = existingByQ.get(a.question_id);
        if (id) {
          await tx
            .update(learnAttemptAnswers)
            .set({ answer: a.answer, timeSpentMs: a.time_spent_ms ?? undefined, flagged: a.flagged ?? undefined })
            .where(eq(learnAttemptAnswers.id, id));
        } else {
          inserts.push({ attemptId, questionId: a.question_id, questionVersionId: order.get(a.question_id)!.question_version_id, answer: a.answer, timeSpentMs: a.time_spent_ms ?? null, flagged: a.flagged ?? false });
        }
      }
      if (inserts.length) await tx.insert(learnAttemptAnswers).values(inserts);
      const [cnt] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(learnAttemptAnswers)
        .where(and(eq(learnAttemptAnswers.attemptId, attemptId), sql`${learnAttemptAnswers.answer} is not null`));
      const next: AttemptDraftState = {
        ...draft,
        section_elapsed_sec: { ...draft.section_elapsed_sec, ...(input.section_elapsed_sec ?? {}) },
        ui_state: { ...draft.ui_state, ...(input.ui_state ?? {}) },
        answered_count: cnt?.n ?? 0,
        last_saved_at: new Date().toISOString(),
      };
      await tx.update(learnAttempts).set({ draftState: next }).where(eq(learnAttempts.id, attemptId));
    });
  }

  /**
   * Sự kiện phiên (tối đa 500 gần nhất). Audio (Sprint 4): `audio_started`/`audio_played` có `meta.question_id` thuộc attempt
   * và attempt đang làm → tăng `draft_state.audio_plays[question_id]` (thống kê cho Review/analytics, server không chặn phát).
   */
  async addEvent(userId: string, attemptId: string, ev: AttemptEvent): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      const row = await this.ownedAttempt(userId, attemptId, tx, true);
      const draft = this.draftOf(row);
      const events = [...draft.events, { ...ev, at: ev.at ?? new Date().toISOString() }].slice(-500);
      const audioPlays = { ...draft.audio_plays };
      const qid = typeof ev.meta?.question_id === 'string' ? ev.meta.question_id : null;
      if (AUDIO_PLAY_EVENT_TYPES.has(ev.type) && row.status === 'in_progress' && qid && draft.question_order.some((o) => o.question_id === qid)) audioPlays[qid] = (audioPlays[qid] ?? 0) + 1;
      await tx
        .update(learnAttempts)
        .set({ draftState: { ...draft, events, audio_plays: audioPlays }, tabLeaveCount: ev.type === 'tab_leave' || ev.type === 'focus_lost' ? sql`${learnAttempts.tabLeaveCount} + 1` : undefined })
        .where(eq(learnAttempts.id, attemptId));
    });
  }

  /**
   * GET /attempts/{id}/media (Sprint 4): URL ký mới cho mọi media của attempt (câu, lựa chọn, passage) – đề L&R 120′ dài hơn
   * TTL 10′ của URL ký. Chỉ chủ attempt; người khác → 404 (không lộ sự tồn tại). Mọi trạng thái (Review cần nghe lại).
   */
  async media(userId: string, attemptId: string): Promise<AttemptMediaList> {
    const [row] = await this.dbs.db.select({ userId: learnAttempts.userId, draftState: learnAttempts.draftState }).from(learnAttempts).where(eq(learnAttempts.id, attemptId)).limit(1);
    if (!row || row.userId !== userId) throw new NotFound('attempt', attemptId);
    const draft = attemptDraftStateSchema.parse(row.draftState ?? {});
    const assetIds = await this.catalog.assetIdsForVersions([...new Set(draft.question_order.map((q) => q.question_version_id))]);
    const urls = await this.catalog.mediaUrls(assetIds);
    return { data: [...urls.values()].filter((u) => u.url).map((u) => ({ id: u.id, kind: u.kind, url: u.url, expires_at: u.expires_at })) };
  }

  /**
   * Ngân sách timed_drill (v1.1 – S5): thời gian trả lời theo Part/per_question_sec + audio Listening của câu + pause_ms
   * + audio nhóm (passage Part 3/4) một lần mỗi nhóm – thời lượng từ catalog.media_assets.duration_ms.
   */
  private async timedDrillBudget(questions: LoadedQuestion[], perQuestionSec?: number): Promise<number> {
    const audioOf = (q: LoadedQuestion) => ('media' in q.content ? q.content.media?.audio_asset_id : undefined) ?? null;
    const durations = await this.catalog.audioDurations([...questions.map(audioOf), ...questions.map((q) => q.passage?.media_asset_id ?? null)].filter((x): x is string => !!x));
    return timedDrillBudgetSeconds(
      questions.map((q) => {
        const audio = audioOf(q);
        const group = q.passage?.media_asset_id ?? null;
        return {
          section_code: q.section_code,
          group_key: q.group_key ?? q.passage?.id ?? null,
          has_audio: !!audio,
          audio_ms: audio ? (durations.get(audio) ?? null) : null,
          has_group_audio: !!group,
          group_audio_ms: group ? (durations.get(group) ?? null) : null,
          pause_ms: 'media' in q.content ? (q.content.media?.pause_ms ?? null) : null,
        };
      }),
      perQuestionSec,
    );
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
      const diagInput: DiagnosisQuestion[] = [];
      const sectionTimes: Record<string, number[]> = {};
      const sectionCommunity: Record<string, number[]> = {};
      const skills: Record<string, { correct: number; total: number; times: number[]; community: number[]; by_subskill: Record<string, { correct: number; total: number }>; by_topic: Record<string, { correct: number; total: number }> }> = {};
      const gradedRows: Array<{ id: string; is_correct: boolean | null; score: string }> = [];
      const missingRows: Array<typeof learnAttemptAnswers.$inferInsert> = [];

      const bump = (m: Record<string, { correct: number; total: number }>, k: string, ok: boolean | null) => {
        m[k] = m[k] ?? { correct: 0, total: 0 };
        m[k].total++;
        if (ok) m[k].correct++;
      };
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
        if (a) gradedRows.push({ id: a.id, is_correct: g.is_correct, score: String(Math.round(earned * 100) / 100) });
        else missingRows.push({ attemptId, questionId: o.question_id, questionVersionId: o.question_version_id, answer: null, isCorrect: g.is_correct, score: '0', flagged: false });
        const sec = (bySection[o.section_code] ??= { correct: 0, total: 0, avg_time_ms: null, score: null, community_avg_time_ms: null });
        sec.total++;
        if (g.is_correct) sec.correct++;
        const time = a?.timeSpentMs ?? null;
        if (time !== null) (sectionTimes[o.section_code] ??= []).push(time);
        if (q.avg_time_ms !== null) (sectionCommunity[o.section_code] ??= []).push(q.avg_time_ms);
        bump(byType, q.question_type, g.is_correct);
        for (const sub of q.subskill_codes) bump(bySub, sub, g.is_correct);
        if (q.topic_code) bump(byTopic, q.topic_code, g.is_correct);
        // Theo kỹ năng (TOEIC: Part → listening/reading; chương trình khác: skill của section)
        const skillCode = (row.programCode === 'toeic' ? TOEIC_PART_SKILL[o.section_code] : undefined) ?? q.skill_code;
        const sk = (skills[skillCode] ??= { correct: 0, total: 0, times: [], community: [], by_subskill: {}, by_topic: {} });
        sk.total++;
        if (g.is_correct) sk.correct++;
        if (time !== null) sk.times.push(time);
        if (q.avg_time_ms !== null) sk.community.push(q.avg_time_ms);
        for (const sub of q.subskill_codes) bump(sk.by_subskill, sub, g.is_correct);
        if (q.topic_code) bump(sk.by_topic, q.topic_code, g.is_correct);
        if (g.is_correct !== null) statUpdates.push({ question_id: q.question_id, correct: g.is_correct, time_ms: time });
        diagInput.push({ question_id: o.question_id, section_code: o.section_code, subskill_codes: q.subskill_codes, topic_code: q.topic_code ?? null, answered: isAnswered(answer), is_correct: g.is_correct, time_ms: time });
      }
      const mean = (xs: number[] | undefined) => (xs && xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null);
      for (const [code, sec] of Object.entries(bySection)) {
        sec.avg_time_ms = mean(sectionTimes[code]);
        sec.community_avg_time_ms = mean(sectionCommunity[code]);
      }

      // Ghi kết quả từng câu: một UPDATE ... FROM (VALUES) + một INSERT gộp (đề 200 câu: 2 câu lệnh thay vì 200)
      if (gradedRows.length) {
        const values = sql.join(
          gradedRows.map((r) => sql`(${r.id}::uuid, ${r.is_correct}::boolean, ${r.score}::numeric)`),
          sql`, `,
        );
        await tx.execute(sql`update learn.attempt_answers aa set is_correct = v.is_correct, score = v.score from (values ${values}) as v(id, is_correct, score) where aa.attempt_id = ${attemptId}::uuid and aa.id = v.id`);
      }
      if (missingRows.length) await tx.insert(learnAttemptAnswers).values(missingRows);

      const scaled = this.scale(row.programCode, bySection);
      const bySkill: Record<string, SkillBreakdown> = {};
      for (const [code, sk] of Object.entries(skills)) {
        const toeicSkill = code === 'listening' || code === 'reading' ? code : null;
        bySkill[code] = {
          correct: sk.correct,
          total: sk.total,
          scaled: toeicSkill && scaled.scaled ? scaled.scaled[toeicSkill] : null,
          range: toeicSkill && scaled.scaled?.ranges ? scaled.scaled.ranges[toeicSkill] : null,
          avg_time_ms: mean(sk.times),
          community_avg_time_ms: mean(sk.community),
          by_subskill: sk.by_subskill,
          by_topic: sk.by_topic,
        };
      }
      const diagnosis = diagnoseAttempt(diagInput, { autoSubmitted: !!opts.auto });
      const breakdown: ScoreBreakdown = { by_section: bySection, by_question_type: byType, by_subskill: bySub, by_topic: byTopic, unanswered, scale: scaled.scale, timeout_wrong: diagnosis.timeout_wrong, diagnosis: diagnosis as unknown as Record<string, unknown>, auto_submitted: !!opts.auto, by_skill: bySkill, scaled: scaled.scaled };
      const timeSpent = Math.max(0, Math.round((Date.now() - row.startedAt.getTime()) / 1000));
      const xp = (row.mode === 'exam' && draft.question_order.length >= 100 ? XP_RULES.attempt_full_test_submitted : XP_RULES.attempt_submitted) + correctCount * XP_RULES.question_correct;
      breakdown.xp_earned = xp;

      await tx
        .update(learnAttempts)
        .set({ status: 'graded', submittedAt: new Date(), timeSpentSec: timeSpent, rawScore: String(Math.round(rawScore * 100) / 100), scaledScore: scaled.value !== null ? String(scaled.value) : null, scoreBreakdown: breakdown, draftState: { ...draft, last_saved_at: new Date().toISOString() } })
        .where(eq(learnAttempts.id, attemptId));
      const answerById = new Map(answers.map((a) => [a.id, a.questionId]));
      // Câu sai (đã trả lời sai + bỏ trống) – trước Sprint 4 luôn rỗng vì đọc is_correct trước khi chấm (SPEC-ISSUES S36)
      const wrongIds = [...gradedRows.filter((r) => r.is_correct === false).map((r) => answerById.get(r.id)!), ...missingRows.filter((r) => r.isCorrect === false).map((r) => r.questionId)];
      const payload = { attempt_id: attemptId, user_id: userId, program: row.programCode, mode: row.mode, test_set_id: row.testSetId, raw_score: rawScore, max_score: maxScore, scaled_score: scaled.value, correct: correctCount, total: draft.question_order.length, xp_earned: xp, auto_submitted: !!opts.auto, time_spent_sec: timeSpent, wrong_question_ids: wrongIds };
      await this.outbox.write(tx, { aggregateType: 'attempt', aggregateId: attemptId, eventType: DOMAIN_EVENTS.ATTEMPT_GRADED, payload });
      const previous = await this.previousScaled(tx, userId, row.programCode, attemptId, row.testSetId, scaled.value);
      // Thống kê cộng đồng (exposure/correct/avg_time_ms) cập nhật trong CÙNG transaction với kết quả (A39) – câu lệnh cuối,
      // khoá hàng catalog.questions ngắn nhất khi nhiều người nộp cùng đề
      await this.catalog.bumpQuestionStats(tx, statUpdates);
      return { payload, breakdown, rawScore, scaled: scaled.value, previous, xp, fresh: true as const };
    });

    if ('fresh' in result && result.fresh) {
      await this.redis.safe(async (r) => {
        const lock = await r.get(EXAM_LOCK_KEY(userId));
        if (lock === attemptId) await r.del(EXAM_LOCK_KEY(userId));
        return null;
      });
      this.outbox.emitLocal(DOMAIN_EVENTS.ATTEMPT_GRADED, result.payload);
      return this.toResult(attemptId, result.breakdown, result.rawScore, result.scaled, result.previous, result.xp);
    }
    return result as AttemptResult;
  }

  private toResult(attemptId: string, b: ScoreBreakdown, rawScore: number, scaledScore: number | null, previous: AttemptResult['compared_to_previous'], xp: number): AttemptResult {
    return {
      attempt_id: attemptId,
      raw_score: rawScore,
      scaled_score: scaledScore,
      scale: b.scale,
      by_section: b.by_section,
      by_question_type: b.by_question_type,
      by_subskill: b.by_subskill,
      compared_to_previous: previous,
      diagnosis: b.diagnosis ?? null,
      xp_earned: xp,
      scaled: b.scaled ?? null,
      by_topic: b.by_topic ?? {},
      ...(b.by_skill ? { by_skill: b.by_skill } : {}),
    };
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

  /**
   * Quy đổi điểm theo chương trình. TOEIC: Part 1–4 → Listening, Part 5–7 → Reading, bảng ước tính của @allingo/scoring
   * (không phải bảng ETS), tổng 10–990 chỉ khi có đủ hai kỹ năng, khoảng ước tính ±25 (`scaled.range`).
   */
  private scale(program: string, bySection: ScoreBreakdown['by_section']): { value: number | null; scale: Record<string, unknown>; scaled: ToeicScaled | null } {
    if (program === 'toeic') {
      const agg = { listening: { correct: 0, total: 0 }, reading: { correct: 0, total: 0 } };
      for (const [code, s] of Object.entries(bySection)) {
        const skill = TOEIC_PART_SKILL[code];
        if (!skill) continue;
        agg[skill].correct += s.correct;
        agg[skill].total += s.total;
      }
      const r = toeicLrEstimate({ listening: agg.listening.total ? agg.listening : undefined, reading: agg.reading.total ? agg.reading : undefined });
      for (const [code, s] of Object.entries(bySection)) {
        const skill = TOEIC_PART_SKILL[code];
        if (skill) s.score = r[skill];
      }
      const value = r.total ?? r.listening ?? r.reading;
      const scaled: ToeicScaled | null = r.listening !== null || r.reading !== null ? { listening: r.listening, reading: r.reading, total: r.total, range: r.range, ranges: r.ranges, estimated: true } : null;
      return { value, scale: { ...SCALE_INFO.toeic, listening: r.listening, reading: r.reading, total: r.total, ci: r.half_width, range: r.range, partial: r.total === null }, scaled };
    }
    if (program === 'ielts') {
      let correct = 0;
      let total = 0;
      for (const s of Object.values(bySection)) {
        correct += s.correct;
        total += s.total;
      }
      const band = total ? ieltsLrBand(correct, total) : null;
      return { value: band, scale: { ...SCALE_INFO.ielts, band }, scaled: null };
    }
    const info = SCALE_INFO[program as keyof typeof SCALE_INFO] ?? SCALE_INFO.toeic;
    return { value: null, scale: { ...info }, scaled: null };
  }

  private async resultFromRow(row: AttemptRow, tx: DbOrTx): Promise<AttemptResult> {
    const b: ScoreBreakdown = (row.scoreBreakdown) ?? { by_section: {}, by_question_type: {}, by_subskill: {}, by_topic: {}, unanswered: 0, scale: {}, timeout_wrong: 0 };
    const scaledScore = row.scaledScore !== null ? Number(row.scaledScore) : null;
    const previous = await this.previousScaled(tx, row.userId, row.programCode, row.id, row.testSetId, scaledScore);
    // XP lưu trong score_breakdown lúc nộp (Sprint 4); attempt chấm trước đó không có → 0
    return this.toResult(row.id, b, Number(row.rawScore ?? 0), scaledScore, previous, b.xp_earned ?? 0);
  }

  async result(userId: string, attemptId: string): Promise<AttemptResult> {
    const row = await this.ownedAttempt(userId, attemptId);
    if (row.status !== 'graded') throw new Conflict('Attempt is not graded yet', { status: row.status });
    return this.resultFromRow(row, this.dbs.db);
  }

  // ------------------------------------------------------------------ review
  async review(userId: string, attemptId: string, filter: { only_wrong?: boolean; flagged?: boolean; section?: string } = {}): Promise<AttemptReview> {
    const onlyWrong = filter.only_wrong === true;
    const row = await this.ownedAttempt(userId, attemptId);
    if (row.status !== 'graded') throw new Conflict('Attempt is not graded yet', { status: row.status });
    const draft = this.draftOf(row);
    const versions = await this.catalog.loadByVersionIds(draft.question_order.map((q) => q.question_version_id));
    const answers = await this.dbs.db.select().from(learnAttemptAnswers).where(eq(learnAttemptAnswers.attemptId, attemptId));
    const answerByQ = new Map(answers.map((a) => [a.questionId, a]));
    const user = await this.users.findById(userId);
    const locale = user?.explainLocale ?? 'vi';
    const ordered = draft.question_order.map((o) => ({ o, q: versions.get(o.question_version_id)! })).filter((x) => x.q);
    const loaded = ordered.map((x) => ({ ...x.q, group_key: x.o.group_key, order_no: x.o.order_no, section_code: x.o.section_code }));
    // Sau khi nộp: trả đủ chữ (Part 1/2) + passage audio_script + transcript tô sáng (Sprint 4)
    const publicQs = await this.catalog.toPublic(loaded, { revealTranscript: true });
    const transcripts: Map<string, TranscriptHighlight> = await this.catalog.transcripts(loaded);
    // Cache giải thích chỉ hợp lệ với phiên bản prompt explain_mcq đang phục vụ người dùng (S5 – A57)
    const explainVersion = await this.gateway.currentPromptVersionId('explain_mcq', row.programCode, userId);
    // Ghi chú của người học theo câu (S6 – ReviewItem.note)
    const notes = await this.notes.latestByQuestion(userId, ordered.map((x) => x.o.question_id));
    const items = [];
    for (let i = 0; i < ordered.length; i++) {
      const { o, q } = ordered[i]!;
      const a = answerByQ.get(o.question_id);
      const answer = (a?.answer as AnswerInput | null) ?? null;
      const g = grade(q.content, answer);
      if (onlyWrong && g.is_correct !== false) continue;
      if (filter.flagged && !a?.flagged) continue;
      if (filter.section && o.section_code !== filter.section) continue;
      const chosen = answer && answer.type === 'mcq_single' ? answer.selected : null;
      const explanation = explainVersion ? await this.explanationCache.get(q.question_version_id, chosen, locale, explainVersion) : null;
      items.push({
        question: publicQs[i]!,
        your_answer: answer,
        correct_answer: correctAnswerOf(q.content),
        is_correct: g.is_correct,
        score: g.score,
        time_spent_ms: a?.timeSpentMs ?? null,
        flagged: a?.flagged ?? false,
        details: g.details ?? null,
        explanation: explanation ? { ...explanation.content, locale, cached: true, ai_task_id: null, prompt_version_id: explanation.promptVersionId } : null,
        transcript_highlight: transcripts.get(q.question_id) ?? null,
        error_entry_id: null,
        community_correct_rate: q.exposure_count > 0 ? Math.round((q.correct_count / q.exposure_count) * 1000) / 10 : null,
        community_avg_time_ms: q.avg_time_ms,
        audio_plays: draft.audio_plays[o.question_id] ?? 0,
        note: notes.get(o.question_id) ?? null,
      });
    }
    return { attempt_id: attemptId, items };
  }

  // ------------------------------------------------------------------ danh sách
  async listMine(userId: string, q: { program?: string; mode?: string; status?: string; from?: string; to?: string; cursor?: string; limit: number }): Promise<{ data: AttemptSummary[]; next_cursor: string | null }> {
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
          q.status ? eq(learnAttempts.status, q.status as never) : sql`true`,
          q.from ? sql`${learnAttempts.startedAt} >= ${`${q.from}T00:00:00Z`}::timestamptz` : sql`true`,
          q.to ? sql`${learnAttempts.startedAt} < (${`${q.to}T00:00:00Z`}::timestamptz + interval '1 day')` : sql`true`,
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

  /**
   * Lịch sử luyện của người học (nguồn câu luyện – Sprint 4): câu đã làm (có trả lời hoặc đã chấm) và câu làm SAI trong
   * WRONG_RECENT_DAYS ngày. Test-engine sở hữu learn.attempts/attempt_answers nên truy vấn ở đây rồi chuyển cho catalog (§5.1).
   */
  async practiceHistory(userId: string, program: string): Promise<PracticeHistory> {
    const rows = await this.dbs.db
      .select({
        questionId: learnAttemptAnswers.questionId,
        wrongRecent: sql<boolean>`bool_or(${learnAttemptAnswers.isCorrect} = false and coalesce(${learnAttempts.submittedAt}, ${learnAttemptAnswers.createdAt}) > now() - make_interval(days => ${WRONG_RECENT_DAYS}))`,
      })
      .from(learnAttemptAnswers)
      .innerJoin(learnAttempts, eq(learnAttempts.id, learnAttemptAnswers.attemptId))
      .where(and(eq(learnAttempts.userId, userId), eq(learnAttempts.programCode, program), sql`(${learnAttemptAnswers.answer} is not null or ${learnAttemptAnswers.isCorrect} is not null)`))
      .groupBy(learnAttemptAnswers.questionId);
    return { seen: rows.map((r) => r.questionId), wrongRecent: rows.filter((r) => r.wrongRecent).map((r) => r.questionId) };
  }

  /**
   * Practice/drill từ ngân hàng (GET /practice/questions): ưu tiên câu chưa làm → sai gần đây → ngẫu nhiên, giữ trọn nhóm passage.
   * `timed=true` → mode timed_drill, hạn = Σ giây theo Part (hoặc per_question_sec × số câu), không feedback trước khi nộp;
   * ngược lại mode drill, không giới hạn giờ, đáp án hiện ngay.
   */
  async practice(userId: string, q: { program: ProgramCode; section?: string; question_type?: string; topic?: string; subskill?: string; count: number; timed: boolean; per_question_sec?: number; q?: string }): Promise<Attempt> {
    // Từ khoá → tập câu khớp (Meilisearch/PG, chỉ câu đã phát hành); bộ lọc khác vẫn áp ở DB
    const onlyQuestionIds = q.q ? (await this.search.searchQuestions(q.q, { program: q.program, section_code: q.section, question_type: q.question_type, topic: q.topic }, 200)).map((h) => h.id) : undefined;
    const history = await this.practiceHistory(userId, q.program);
    const questions = await this.catalog.randomQuestions(q.program, { section_code: q.section, question_type: q.question_type, topic: q.topic, subskill: q.subskill, count: q.count, onlyQuestionIds, history });
    if (questions.length === 0) throw new NotFound('questions');
    await this.gate.consume(userId, q.program, 'part_drill');
    const timeLimitSec = q.timed ? await this.timedDrillBudget(questions, q.per_question_sec) : null;
    const draft: AttemptDraftState = {
      question_order: questions.map((x) => ({ question_id: x.question_id, question_version_id: x.question_version_id, section_code: x.section_code, group_key: x.group_key, order_no: x.order_no })),
      time_limit_sec: timeLimitSec,
      expires_at: timeLimitSec ? new Date(Date.now() + timeLimitSec * 1000).toISOString() : null,
      section_elapsed_sec: {},
      ui_state: {},
      events: [],
      audio_plays: {},
      answered_count: 0,
      last_saved_at: null,
    };
    const mode = q.timed ? 'timed_drill' : 'drill';
    const sectionId = q.section ? ((await this.catalog.sectionByCode(q.program, q.section))?.id ?? null) : null;
    const attemptId = await this.dbs.db.transaction(async (tx) => {
      await this.enrollments.ensure(userId, q.program, tx);
      const [row] = await tx.insert(learnAttempts).values({ userId, programCode: q.program, sectionId, mode, status: 'in_progress', draftState: draft }).returning({ id: learnAttempts.id });
      await this.outbox.write(tx, { aggregateType: 'attempt', aggregateId: row!.id, eventType: DOMAIN_EVENTS.ATTEMPT_STARTED, payload: { attempt_id: row!.id, user_id: userId, program: q.program, mode, test_set_id: null, question_count: questions.length } });
      return row!.id;
    });
    this.logger.info({ attempt_id: attemptId, mode, questions: questions.length, time_limit_sec: timeLimitSec }, 'practice attempt created');
    return this.assemble(userId, attemptId, questions, { testSet: null });
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

  /**
   * Thứ tự (1-based) của attempt trong các bài ĐÃ CHẤM của người học theo submitted_at (summary sau mỗi 3 bài – S5);
   * null nếu attempt không thuộc người dùng hoặc chưa chấm.
   */
  async gradedPosition(userId: string, program: string, attemptId: string): Promise<number | null> {
    const rows = await this.dbs.db.execute<{ pos: number | null }>(sql`
      select (select count(*)::int from learn.attempts a2
               where a2.user_id = a.user_id and a2.program_code = a.program_code and a2.status = 'graded'
                 and (a2.submitted_at, a2.id) <= (a.submitted_at, a.id)) as pos
        from learn.attempts a
       where a.id = ${attemptId}::uuid and a.user_id = ${userId}::uuid and a.program_code = ${program} and a.status = 'graded'`);
    return rows[0]?.pos ?? null;
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
