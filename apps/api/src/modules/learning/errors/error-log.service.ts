import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { addDays, localDate, zonedDayStart } from '@allingo/planner';
import { DOMAIN_EVENTS, correctAnswerOf, type Attempt, type ErrorDrillInput, type ErrorLogEntry, type ErrorLogPage, type ErrorLogQuery, type ErrorPatch } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { NotFound } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { CatalogQueryService } from '../../catalog/index.js';
import { AttemptsService } from '../../test-engine/index.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { SrsService } from '../srs.service.js';
import { classifyError } from './classify.js';

const { learnErrorLogEntries } = schema;
type EntryRow = typeof learnErrorLogEntries.$inferSelect;

/** Sự kiện local: mục sổ lỗi được đánh dấu đã hiểu (plan: task review_errors; analytics: xoá cache) */
export const ERROR_RESOLVED_EVENT = 'error_log.resolved';
export interface ErrorResolvedEvent {
  user_id: string;
  program: string;
  open_left: number;
  resolved_today: number;
}

interface GradedPayload {
  attempt_id: string;
  user_id: string;
  program?: string;
}

/** Biểu thức loại hiệu lực (người học đổi lý do thắng luật) */
const effectiveKind = sql<string>`coalesce(${learnErrorLogEntries.reasonOverride}, ${learnErrorLogEntries.errorKind})::text`;
const sectionOf = sql<string | null>`${learnErrorLogEntries.reasonAuto} -> 'evidence' ->> 'section'`;

/**
 * Sổ lỗi (Sprint 10): outbox/local `attempt.graded` → mỗi câu sai/bỏ trống một mục (`classifyError` theo luật), gộp theo câu
 * (UNIQUE user × question: `occurrences`, mở lại khi sai lại, idempotent theo attempt). Đọc/lọc/thống kê, đánh dấu đã hiểu,
 * ghi chú, tạo thẻ SRS kind `error`, "làm lại 10 câu sai" (timed_drill). Section lưu ở `reason_auto.evidence.section`
 * (không truy vấn bảng catalog từ learning – §5.1).
 */
@Injectable()
export class ErrorLogService {
  private readonly logger = getLogger({ component: 'learning.errors' });

  constructor(
    private readonly dbs: DbService,
    private readonly attempts: AttemptsService,
    private readonly catalog: CatalogQueryService,
    private readonly srs: SrsService,
    private readonly gamification: GamificationService,
    private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  // ------------------------------------------------------------------ pipeline
  @OnEvent('local.attempt.graded')
  async onLocalGraded(p: GradedPayload): Promise<void> {
    await this.ingest(p?.attempt_id).catch((err: Error) => this.logger.error({ err: err.message.slice(0, 200), attempt_id: p?.attempt_id }, 'error log ingest failed'));
  }

  @OnEvent('outbox.attempt.graded')
  async onOutboxGraded(ev: { payload: GradedPayload }): Promise<void> {
    await this.onLocalGraded(ev.payload);
  }

  /** Dựng/gộp mục sổ lỗi cho một attempt đã chấm. Idempotent: chạy lại cùng attempt không tăng occurrences. */
  async ingest(attemptId: string | undefined): Promise<{ created: number; merged: number }> {
    if (!attemptId) return { created: 0, merged: 0 };
    const d = await this.attempts.wrongAnswersOf(attemptId);
    if (!d || d.items.length === 0) return { created: 0, merged: 0 };
    const subIds = await this.catalog.subskillIdsByCode(d.attempt.program);
    const seenAt = d.attempt.submittedAt ?? this.now();
    let created = 0;
    let merged = 0;
    await this.dbs.db.transaction(async (tx) => {
      for (const it of d.items) {
        const cls = classifyError({ section_code: it.section_code, skill_code: it.skill_code, subskill_codes: it.subskill_codes, topic_code: it.topic_code, time_spent_ms: it.time_spent_ms, answered: it.answered, auto_submitted: d.attempt.autoSubmitted });
        const subCode = cls.evidence.subskill ?? it.subskill_codes[0] ?? null;
        const reasonAuto = { kind: cls.kind, rule: cls.rule, source: 'rule-v1', evidence: cls.evidence, question_type: it.question_type, mode: d.attempt.mode, answered: it.answered };
        const rows = await tx.execute<{ inserted: boolean }>(sql`
          insert into learn.error_log_entries (user_id, program_code, attempt_answer_id, question_id, question_version_id, subskill_id, error_kind, reason_auto, attempt_id, occurrences, last_seen_at, created_at)
          values (${d.attempt.userId}::uuid, ${d.attempt.program}, ${it.attempt_answer_id}::uuid, ${it.question_id}::uuid, ${it.question_version_id}::uuid, ${subCode ? (subIds.get(subCode) ?? null) : null}::uuid,
                  ${cls.kind}::learn.error_kind, ${JSON.stringify(reasonAuto)}::jsonb, ${d.attempt.id}::uuid, 1, ${seenAt.toISOString()}::timestamptz, ${seenAt.toISOString()}::timestamptz)
          on conflict (user_id, question_id) where question_id is not null do update set
            occurrences = learn.error_log_entries.occurrences + 1,
            last_seen_at = greatest(learn.error_log_entries.last_seen_at, excluded.last_seen_at),
            attempt_id = excluded.attempt_id,
            attempt_answer_id = excluded.attempt_answer_id,
            question_version_id = excluded.question_version_id,
            subskill_id = coalesce(excluded.subskill_id, learn.error_log_entries.subskill_id),
            error_kind = excluded.error_kind,
            reason_auto = excluded.reason_auto,
            resolved_at = null
          where learn.error_log_entries.attempt_id is distinct from excluded.attempt_id
          returning (xmax = 0) as inserted`);
        const r = [...rows][0];
        if (!r) continue;
        if (r.inserted) created++;
        else merged++;
      }
    });
    if (created || merged) {
      this.outbox.emitLocal(DOMAIN_EVENTS.ERROR_LOG_UPDATED, { user_id: d.attempt.userId, program: d.attempt.program, attempt_id: attemptId, created, merged });
      this.logger.info({ attempt_id: attemptId, created, merged }, 'error log updated');
    }
    return { created, merged };
  }

  // ------------------------------------------------------------------ đọc
  private async userTz(userId: string): Promise<string> {
    return this.gamification.timezoneOf(userId);
  }

  private async filters(userId: string, q: Pick<ErrorLogQuery, 'program' | 'status' | 'days' | 'from' | 'to' | 'sort'>): Promise<SQL[]> {
    const conds: SQL[] = [eq(learnErrorLogEntries.userId, userId), eq(learnErrorLogEntries.programCode, q.program)];
    // Mặc định 30 ngày cho danh sách mới nhất; "cũ nhất" (task review_errors) xét mọi thời gian
    const days = q.days ?? (q.sort === 'oldest' ? 0 : 30);
    if (q.status === 'open') conds.push(isNull(learnErrorLogEntries.resolvedAt));
    else if (q.status === 'resolved') conds.push(isNotNull(learnErrorLogEntries.resolvedAt));
    if (q.from || q.to) {
      const tz = await this.userTz(userId);
      if (q.from) conds.push(sql`${learnErrorLogEntries.lastSeenAt} >= ${zonedDayStart(q.from, tz).toISOString()}::timestamptz`);
      if (q.to) conds.push(sql`${learnErrorLogEntries.lastSeenAt} < ${zonedDayStart(addDays(q.to, 1), tz).toISOString()}::timestamptz`);
    } else if (days > 0) conds.push(sql`${learnErrorLogEntries.lastSeenAt} >= ${new Date(this.now().getTime() - days * 86_400_000).toISOString()}::timestamptz`);
    return conds;
  }

  /** GET /me/errors */
  async list(userId: string, q: ErrorLogQuery): Promise<ErrorLogPage> {
    const base = await this.filters(userId, q);
    const kindCond = q.kind ? sql`${effectiveKind} = ${q.kind}` : sql`true`;
    const partCond = q.part ? sql`${sectionOf} = ${q.part}` : sql`true`;
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const cursorCond = c ? (q.sort === 'oldest' ? sql`(${learnErrorLogEntries.createdAt}, ${learnErrorLogEntries.id}) > (${c.t}::timestamptz, ${c.id}::uuid)` : sql`(${learnErrorLogEntries.lastSeenAt}, ${learnErrorLogEntries.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`) : sql`true`;
    const order = q.sort === 'oldest' ? [asc(learnErrorLogEntries.createdAt), asc(learnErrorLogEntries.id)] : [desc(learnErrorLogEntries.lastSeenAt), desc(learnErrorLogEntries.id)];
    const [rows, dist, bySec, totals] = await Promise.all([
      this.dbs.db.select().from(learnErrorLogEntries).where(and(...base, kindCond, partCond, cursorCond)).orderBy(...order).limit(q.limit + 1),
      this.dbs.db.select({ k: effectiveKind, n: sql<number>`count(*)`.mapWith(Number) }).from(learnErrorLogEntries).where(and(...base, partCond)).groupBy(effectiveKind),
      this.dbs.db.select({ s: sectionOf, n: sql<number>`count(*)`.mapWith(Number) }).from(learnErrorLogEntries).where(and(...base, kindCond)).groupBy(sectionOf),
      this.totals(userId, q.program),
    ]);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      distribution: Object.fromEntries(dist.map((d) => [d.k, d.n])),
      by_section: Object.fromEntries(bySec.filter((x) => x.s).map((x) => [x.s!, x.n])),
      totals,
      paraphrase_map: [],
      recurring_writing_speaking: [],
      data: await this.toDtos(userId, page),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: (q.sort === 'oldest' ? last.createdAt : last.lastSeenAt).toISOString(), id: last.id }) : null,
    };
  }

  async totals(userId: string, program: string): Promise<{ open: number; resolved: number }> {
    const [r] = await this.dbs.db
      .select({ open: sql<number>`count(*) filter (where ${learnErrorLogEntries.resolvedAt} is null)`.mapWith(Number), resolved: sql<number>`count(*) filter (where ${learnErrorLogEntries.resolvedAt} is not null)`.mapWith(Number) })
      .from(learnErrorLogEntries)
      .where(and(eq(learnErrorLogEntries.userId, userId), eq(learnErrorLogEntries.programCode, program)));
    return { open: r?.open ?? 0, resolved: r?.resolved ?? 0 };
  }

  /** Mục sổ lỗi → DTO (câu public bản đã làm, câu trả lời, đáp án đúng, thẻ SRS) */
  async toDtos(userId: string, rows: EntryRow[]): Promise<ErrorLogEntry[]> {
    if (!rows.length) return [];
    const versionIds = [...new Set(rows.map((r) => r.questionVersionId).filter((x): x is string => !!x))];
    const loaded = await this.catalog.loadByVersionIds(versionIds);
    const list = versionIds.map((id) => loaded.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const publics = await this.catalog.toPublic(list.map((q) => ({ ...q, group_key: q.passage?.id ?? null, order_no: 1 })), { revealTranscript: true });
    const publicByVersion = new Map(list.map((q, i) => [q.question_version_id, publics[i]!]));
    const answers = await this.attempts.answersByIds(userId, rows.map((r) => r.attemptAnswerId).filter((x): x is string => !!x));
    const cards = await this.srs.cardIdsByRef(userId, 'error', rows.map((r) => r.id));
    return rows.map((r) => {
      const ra = (r.reasonAuto ?? {}) as { evidence?: { section?: string; subskill?: string | null; topic?: string | null; time_spent_ms?: number | null } };
      const q = r.questionVersionId ? loaded.get(r.questionVersionId) : undefined;
      const a = r.attemptAnswerId ? answers.get(r.attemptAnswerId) : undefined;
      return {
        id: r.id,
        kind: (r.reasonOverride ?? r.errorKind),
        kind_auto: r.errorKind,
        reason_auto: (r.reasonAuto as Record<string, unknown> | null) ?? {},
        reason_override: (r.reasonOverride) ?? null,
        question: r.questionVersionId ? (publicByVersion.get(r.questionVersionId) ?? null) : null,
        question_id: r.questionId ?? null,
        question_version_id: r.questionVersionId ?? null,
        section_code: ra.evidence?.section ?? q?.section_code ?? null,
        subskill: ra.evidence?.subskill ?? null,
        topic: ra.evidence?.topic ?? null,
        your_answer: a?.answer ?? null,
        correct_answer: q ? correctAnswerOf(q.content) : null,
        time_spent_ms: a?.time_spent_ms ?? ra.evidence?.time_spent_ms ?? null,
        occurrences: r.occurrences,
        note: r.note ?? null,
        resolved: !!r.resolvedAt,
        resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        srs_card_id: cards.get(r.id) ?? null,
        attempt_id: r.attemptId ?? null,
        created_at: r.createdAt.toISOString(),
        last_seen_at: r.lastSeenAt.toISOString(),
      };
    });
  }

  private async owned(userId: string, id: string): Promise<EntryRow> {
    const [row] = await this.dbs.db.select().from(learnErrorLogEntries).where(and(eq(learnErrorLogEntries.id, id), eq(learnErrorLogEntries.userId, userId))).limit(1);
    if (!row) throw new NotFound('error_log_entry', id);
    return row;
  }

  /** PATCH /me/errors/{id} */
  async patch(userId: string, id: string, p: ErrorPatch): Promise<ErrorLogEntry> {
    const row = await this.owned(userId, id);
    const set: Partial<typeof learnErrorLogEntries.$inferInsert> = {};
    if (p.reason_override !== undefined) set.reasonOverride = p.reason_override;
    if (p.note !== undefined) set.note = p.note === null || p.note === '' ? null : p.note;
    const resolvedNow = p.resolved === true && !row.resolvedAt;
    if (p.resolved === true && !row.resolvedAt) set.resolvedAt = this.now();
    if (p.resolved === false) set.resolvedAt = null;
    if (Object.keys(set).length) await this.dbs.db.update(learnErrorLogEntries).set(set).where(eq(learnErrorLogEntries.id, id));
    if (p.create_card) await this.srs.ensureErrorCard(userId, row.programCode, id);
    if (resolvedNow || p.resolved === false) {
      const ev = await this.resolvedSummary(userId, row.programCode);
      this.outbox.emitLocal(ERROR_RESOLVED_EVENT, { ...ev, user_id: userId, program: row.programCode } satisfies ErrorResolvedEvent);
    }
    const [fresh] = await this.dbs.db.select().from(learnErrorLogEntries).where(eq(learnErrorLogEntries.id, id));
    return (await this.toDtos(userId, [fresh!]))[0]!;
  }

  /** Số lỗi chưa hiểu + số đã hiểu hôm nay (giờ người học) */
  async resolvedSummary(userId: string, program: string): Promise<{ open_left: number; resolved_today: number }> {
    const tz = await this.userTz(userId);
    const dayStart = zonedDayStart(localDate(this.now(), tz), tz);
    const [r] = await this.dbs.db
      .select({
        open: sql<number>`count(*) filter (where ${learnErrorLogEntries.resolvedAt} is null)`.mapWith(Number),
        today: sql<number>`count(*) filter (where ${learnErrorLogEntries.resolvedAt} >= ${dayStart.toISOString()}::timestamptz)`.mapWith(Number),
      })
      .from(learnErrorLogEntries)
      .where(and(eq(learnErrorLogEntries.userId, userId), eq(learnErrorLogEntries.programCode, program)));
    return { open_left: r?.open ?? 0, resolved_today: r?.today ?? 0 };
  }

  /** Lỗi chưa hiểu cũ nhất (task review_errors, drill mặc định) */
  async oldestOpen(userId: string, program: string, opts: { limit: number; kind?: string; part?: string }): Promise<EntryRow[]> {
    return this.dbs.db
      .select()
      .from(learnErrorLogEntries)
      .where(and(eq(learnErrorLogEntries.userId, userId), eq(learnErrorLogEntries.programCode, program), isNull(learnErrorLogEntries.resolvedAt), isNotNull(learnErrorLogEntries.questionId), opts.kind ? sql`${effectiveKind} = ${opts.kind}` : sql`true`, opts.part ? sql`${sectionOf} = ${opts.part}` : sql`true`))
      .orderBy(asc(learnErrorLogEntries.createdAt), asc(learnErrorLogEntries.id))
      .limit(opts.limit);
  }

  /** POST /me/errors/drill – timed_drill từ ≤ 10 lỗi chưa hiểu */
  async drill(userId: string, input: ErrorDrillInput): Promise<Attempt> {
    let rows: EntryRow[];
    if (input.entry_ids?.length) {
      rows = await this.dbs.db
        .select()
        .from(learnErrorLogEntries)
        .where(and(eq(learnErrorLogEntries.userId, userId), eq(learnErrorLogEntries.programCode, input.program), inArray(learnErrorLogEntries.id, input.entry_ids), isNull(learnErrorLogEntries.resolvedAt), isNotNull(learnErrorLogEntries.questionId)));
    } else rows = await this.oldestOpen(userId, input.program, { limit: input.limit, kind: input.kind, part: input.part });
    const questionIds = [...new Set(rows.map((r) => r.questionId!))];
    if (!questionIds.length) throw new NotFound('error_log_entries');
    return this.attempts.createFromQuestions(userId, { program: input.program, questionIds, planTaskId: input.plan_task_id ?? null });
  }
}
