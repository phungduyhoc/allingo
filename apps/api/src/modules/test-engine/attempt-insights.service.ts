import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ATTEMPT_GRACE_SECONDS, attemptDraftStateSchema, correctAnswerOf, isAnswered, type AnswerInput } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { ExamModeService } from '../../shared/exam/exam-mode.js';
import { Forbidden, NotFound } from '../../shared/http/errors.js';
import { CatalogQueryService } from '../catalog/index.js';

const { learnAttempts, learnAttemptAnswers, catalogTestSets } = schema;

/** Exam không đồng hồ: coi là bỏ dở sau N giờ (cùng TTL cờ Redis cũ) – A75 */
const UNTIMED_EXAM_LOCK_HOURS = 4;
/** Chế độ được xem đáp án ngay sau khi trả lời (A36) */
const FEEDBACK_MODES: ReadonlySet<string> = new Set(['practice', 'drill']);
/** Cửa sổ "lỗi gần đây" cho gia sư */
const MISTAKES_WINDOW_DAYS = 30;

const excerpt = (s: unknown, n = 160) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

export interface AttemptContextSnapshot {
  attempt_id: string;
  program: string;
  mode: string;
  status: string;
  test_set_title: string | null;
  question_count: number;
  answered_count: number;
  started_at: string;
  submitted_at: string | null;
  /** Chỉ khi đã chấm */
  raw_score: number | null;
  scaled_score: number | null;
  by_section: Record<string, { correct: number; total: number }> | null;
  weak_areas: string[];
  question_version_ids: string[];
}

export interface QuestionRevealState {
  /** Câu có trong attempt */
  contains: boolean;
  /** Được đưa đáp án/giải thích vào ngữ cảnh gia sư: attempt đã nộp/chấm, hoặc practice/drill đã trả lời câu này */
  reveal: boolean;
  answered: boolean;
  chosen: string | null;
  status: string;
  mode: string;
}

export interface RecentMistake {
  attempt_id: string;
  question_version_id: string;
  section_code: string;
  question_type: string;
  subskills: string[];
  stem_excerpt: string;
  chosen: string | null;
  correct: string | null;
  at: string;
}

/**
 * Dữ liệu bài làm cho module khác (gia sư – learning, khoá Exam Mode – shared) mà không để họ truy vấn learn.attempts/attempt_answers
 * (CLAUDE.md §5.1). Đăng ký probe Exam Mode vào ExamModeService lúc khởi động.
 */
@Injectable()
export class AttemptInsightsService implements OnModuleInit {
  constructor(
    private readonly dbs: DbService,
    private readonly catalog: CatalogQueryService,
    private readonly examMode: ExamModeService,
  ) {}

  onModuleInit(): void {
    this.examMode.registerProbe((userId) => this.activeExamAttemptId(userId));
  }

  /**
   * attempt exam đang làm: status in_progress, mode exam, còn hạn (expires_at + ân hạn) hoặc không đồng hồ và bắt đầu < 4 giờ.
   * Dùng index partial ix_attempts_in_progress (user_id) WHERE status = 'in_progress'.
   */
  async activeExamAttemptId(userId: string): Promise<string | null> {
    const [row] = await this.dbs.db
      .select({ id: learnAttempts.id })
      .from(learnAttempts)
      .where(
        and(
          eq(learnAttempts.userId, userId),
          eq(learnAttempts.status, 'in_progress'),
          eq(learnAttempts.mode, 'exam'),
          sql`(case when (${learnAttempts.draftState} ->> 'expires_at') is null
                    then ${learnAttempts.startedAt} > now() - make_interval(hours => ${UNTIMED_EXAM_LOCK_HOURS})
                    else (${learnAttempts.draftState} ->> 'expires_at')::timestamptz + make_interval(secs => ${ATTEMPT_GRACE_SECONDS}) > now() end)`,
        ),
      )
      .orderBy(desc(learnAttempts.startedAt))
      .limit(1);
    return row?.id ?? null;
  }

  private async owned(userId: string, attemptId: string) {
    const [row] = await this.dbs.db.select().from(learnAttempts).where(eq(learnAttempts.id, attemptId)).limit(1);
    if (!row) throw new NotFound('attempt', attemptId);
    if (row.userId !== userId) throw new Forbidden();
    return row;
  }

  /** Kiểm tra attempt thuộc người dùng (404/403) – trả program */
  async assertOwned(userId: string, attemptId: string): Promise<{ program: string; status: string; mode: string; testSetId: string | null; questionVersionIds: string[] }> {
    const row = await this.owned(userId, attemptId);
    const draft = attemptDraftStateSchema.safeParse(row.draftState ?? {});
    return { program: row.programCode, status: row.status, mode: row.mode, testSetId: row.testSetId ?? null, questionVersionIds: draft.success ? draft.data.question_order.map((q) => q.question_version_id) : [] };
  }

  /** Tóm tắt attempt cho ngữ cảnh gia sư – KHÔNG chứa đáp án; số liệu điểm chỉ khi đã chấm */
  async contextSnapshot(userId: string, attemptId: string): Promise<AttemptContextSnapshot> {
    const row = await this.owned(userId, attemptId);
    const parsed = attemptDraftStateSchema.safeParse(row.draftState ?? {});
    const order = parsed.success ? parsed.data.question_order : [];
    const [ts] = row.testSetId ? await this.dbs.db.select({ title: catalogTestSets.title }).from(catalogTestSets).where(eq(catalogTestSets.id, row.testSetId)).limit(1) : [];
    const title = ts?.title ? ((ts.title as Record<string, string>).en ?? (ts.title as Record<string, string>).vi ?? null) : null;
    const [cnt] = await this.dbs.db
      .select({ n: sql<number>`count(*) filter (where ${learnAttemptAnswers.answer} is not null)`.mapWith(Number) })
      .from(learnAttemptAnswers)
      .where(eq(learnAttemptAnswers.attemptId, attemptId));
    const graded = row.status === 'graded';
    const b = (row.scoreBreakdown) ?? null;
    const bySection = graded && b?.by_section ? Object.fromEntries(Object.entries(b.by_section).map(([k, v]) => [k, { correct: Number((v as { correct?: number }).correct ?? 0), total: Number((v as { total?: number }).total ?? 0) }])) : null;
    const d = (b?.diagnosis as { weak_sections?: Array<{ code: string; accuracy: number }>; weak_subskills?: Array<{ code: string; accuracy: number }> } | undefined) ?? {};
    const diag = [...(d.weak_subskills ?? []), ...(d.weak_sections ?? [])].map((w) => `${w.code} (${Math.round(w.accuracy * 100)}%)`);
    return {
      attempt_id: row.id,
      program: row.programCode,
      mode: row.mode,
      status: row.status,
      test_set_title: title,
      question_count: order.length,
      answered_count: cnt?.n ?? 0,
      started_at: row.startedAt.toISOString(),
      submitted_at: row.submittedAt?.toISOString() ?? null,
      raw_score: graded && row.rawScore !== null ? Number(row.rawScore) : null,
      scaled_score: graded && row.scaledScore !== null ? Number(row.scaledScore) : null,
      by_section: bySection,
      weak_areas: graded ? diag.slice(0, 5) : [],
      question_version_ids: order.map((q) => q.question_version_id),
    };
  }

  /** Câu `questionVersionId` trong attempt: có được lộ đáp án vào ngữ cảnh gia sư không (§5.8: exam đang làm → không bao giờ) */
  async revealState(userId: string, attemptId: string, questionVersionId: string): Promise<QuestionRevealState> {
    const row = await this.owned(userId, attemptId);
    const parsed = attemptDraftStateSchema.safeParse(row.draftState ?? {});
    const contains = parsed.success && parsed.data.question_order.some((q) => q.question_version_id === questionVersionId);
    const [a] = contains
      ? await this.dbs.db
          .select({ answer: learnAttemptAnswers.answer })
          .from(learnAttemptAnswers)
          .where(and(eq(learnAttemptAnswers.attemptId, attemptId), eq(learnAttemptAnswers.questionVersionId, questionVersionId)))
          .limit(1)
      : [];
    const answer = (a?.answer as AnswerInput | null) ?? null;
    const answered = isAnswered(answer);
    const chosen = answer && answer.type === 'mcq_single' ? answer.selected : null;
    const done = row.status === 'graded' || row.status === 'submitted';
    const reveal = contains && (done || (row.status === 'in_progress' && FEEDBACK_MODES.has(row.mode) && answered));
    return { contains, reveal, answered, chosen, status: row.status, mode: row.mode };
  }

  /**
   * ≤ `limit` câu làm sai gần nhất (attempt đã chấm, 30 ngày) – trích đề ≤ 160 ký tự, đáp án chọn/đúng (đã nộp nên được phép),
   * không passage/transcript; bỏ TOEIC Part 1/2 (chữ là nội dung nghe).
   */
  async recentMistakes(userId: string, program: string, limit = 5): Promise<RecentMistake[]> {
    const rows = await this.dbs.db
      .select({ attemptId: learnAttempts.id, qv: learnAttemptAnswers.questionVersionId, answer: learnAttemptAnswers.answer, at: learnAttempts.submittedAt })
      .from(learnAttemptAnswers)
      .innerJoin(learnAttempts, eq(learnAttempts.id, learnAttemptAnswers.attemptId))
      .where(
        and(
          eq(learnAttempts.userId, userId),
          eq(learnAttempts.programCode, program),
          eq(learnAttempts.status, 'graded'),
          eq(learnAttemptAnswers.isCorrect, false),
          sql`${learnAttempts.submittedAt} > now() - make_interval(days => ${MISTAKES_WINDOW_DAYS})`,
          sql`${learnAttemptAnswers.createdAt} > now() - make_interval(days => ${MISTAKES_WINDOW_DAYS + 1})`,
        ),
      )
      .orderBy(desc(learnAttempts.submittedAt), desc(learnAttemptAnswers.createdAt))
      .limit(limit * 4);
    const seen = new Set<string>();
    const picked = rows.filter((r) => (seen.has(r.qv) ? false : (seen.add(r.qv), true)));
    const qs = await this.catalog.loadByVersionIds(picked.map((r) => r.qv));
    const out: RecentMistake[] = [];
    for (const r of picked) {
      const q = qs.get(r.qv);
      if (!q || (q.program_code === 'toeic' && (q.section_code === 'part1' || q.section_code === 'part2'))) continue;
      const answer = (r.answer) ?? null;
      const correct = correctAnswerOf(q.content);
      out.push({
        attempt_id: r.attemptId,
        question_version_id: r.qv,
        section_code: q.section_code,
        question_type: q.question_type,
        subskills: q.subskill_codes,
        stem_excerpt: excerpt((q.content as { stem?: string }).stem),
        chosen: answer && answer.type === 'mcq_single' ? answer.selected : null,
        correct: typeof correct === 'string' ? correct : Array.isArray(correct) ? correct.join(',') : correct ? JSON.stringify(correct).slice(0, 60) : null,
        at: r.at?.toISOString() ?? '',
      });
      if (out.length >= limit) break;
    }
    return out;
  }
}
