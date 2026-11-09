import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { FSRS_MODEL_VERSION, MIN_REVIEWS_FOR_OPTIMIZATION, fromStored, isMastered, optimizeWeights, previewIntervals, reviewCard, sanitizeWeights, type SrsOptions, type SrsRating, type StoredSrsCard } from '@allingo/fsrs';
import { addDays, localDate, zonedDayStart } from '@allingo/planner';
import {
  DEFAULT_PROGRAM,
  XP_TABLE,
  correctAnswerOf,
  pickLocalized,
  type LocalizedText,
  type ProgramCode,
  type SrsCard,
  type SrsCardCreate,
  type SrsDueList,
  type SrsReviewInput,
  type VocabEnrollResult,
  type VocabItem,
  type VocabList,
} from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { ExamModeService } from '../../shared/exam/exam-mode.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { FeatureGateService, type GateTicket } from '../billing/index.js';
import { CatalogQueryService, DictionaryService } from '../catalog/index.js';
import { EnrollmentsService, UsersService } from '../iam/index.js';
import { GamificationService } from './gamification/gamification.service.js';

const { learnSrsCards, learnSrsReviews, learnErrorLogEntries } = schema;
type CardRow = typeof learnSrsCards.$inferSelect;
type VocabRow = Awaited<ReturnType<CatalogQueryService['vocabItemsByIds']>>[number];

/** Thẻ đến hạn lại trong ≤ 20 phút sau khi ôn → "quay lại trong phiên" */
export const SRS_IN_SESSION_MS = 20 * 60_000;
/** reviewed_at của client lệch tương lai > 5 phút → dùng giờ server */
const FUTURE_SKEW_MS = 5 * 60_000;
/** Ước tính thời gian ôn một thẻ (thống kê phút học) */
export const SRS_REVIEW_SECONDS = 10;
/** Sự kiện local sau khi ôn (plan: task vocab_review; analytics: xoá cache thống kê) */
export const SRS_REVIEWED_EVENT = 'srs.reviewed';

export interface SrsReviewedEvent {
  user_id: string;
  programs: string[];
  reviewed: number;
  due_now_left: number;
}

/**
 * Thẻ SRS (S6 → S10): lịch FSRS-5 (`@allingo/fsrs`, trọng số người dùng nếu đã tối ưu), thẻ vocab | error | grammar,
 * bộ từ hệ thống + "thêm cả bộ", phiên ôn (đến hạn + thẻ mới trong hạn mức ngày), review idempotent theo (card_id, reviewed_at).
 *
 * Quota `srs_new_cards` (Free 10, Pro 30/ngày – billing.quotas) áp khi HỌC thẻ mới (lần ôn đầu), không khi thêm thẻ (A153).
 * Đang thi (Exam Mode) → thẻ kind `error` (chứa đáp án) bị loại khỏi mọi danh sách (CLAUDE.md §5.8).
 */
@Injectable()
export class SrsService {
  private readonly logger = getLogger({ component: 'learning.srs' });
  private readonly optionsCache = new Map<string, { at: number; opts: SrsOptions }>();

  constructor(
    private readonly dbs: DbService,
    private readonly dictionary: DictionaryService,
    private readonly catalog: CatalogQueryService,
    private readonly gate: FeatureGateService,
    private readonly users: UsersService,
    private readonly enrollments: EnrollmentsService,
    private readonly gamification: GamificationService,
    private readonly outbox: OutboxService,
    private readonly exam: ExamModeService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  // ------------------------------------------------------------------ DTO
  toDto(r: CardRow, payload: Record<string, unknown>, extra: Partial<SrsCard> = {}): SrsCard {
    return {
      id: r.id,
      card_type: r.cardType,
      ref_id: r.refId,
      state: r.state,
      due_at: r.dueAt.toISOString(),
      stability: r.stability ?? null,
      difficulty: r.difficulty ?? null,
      reps: r.reps,
      lapses: r.lapses,
      payload,
      last_review_at: r.lastReviewAt ? r.lastReviewAt.toISOString() : null,
      source_type: r.sourceType ?? null,
      suspended: r.suspended,
      mastered: isMastered({ state: r.state, stability: r.stability ?? null }),
      ...extra,
    };
  }

  private stored(r: CardRow): StoredSrsCard {
    return { state: r.state, stability: r.stability ?? null, difficulty: r.difficulty ?? null, due_at: r.dueAt, last_review_at: r.lastReviewAt ?? null, reps: r.reps, lapses: r.lapses };
  }

  /** Tham số FSRS theo (người dùng, chương trình): trọng số tối ưu (learn.enrollments.fsrs_params.w) hoặc mặc định FSRS-5 */
  async options(userId: string, program: string): Promise<SrsOptions> {
    const key = `${userId}:${program}`;
    const hit = this.optionsCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.opts;
    const p = await this.enrollments.fsrsParams(userId, program).catch(() => null);
    const w = sanitizeWeights(p?.w ?? null);
    const opts: SrsOptions = w ? { w } : {};
    if (this.optionsCache.size > 5000) this.optionsCache.clear();
    this.optionsCache.set(key, { at: Date.now(), opts });
    return opts;
  }

  private async locale(userId: string): Promise<string> {
    return (await this.users.findById(userId))?.explainLocale ?? 'vi';
  }

  /** Nội dung hiển thị theo loại thẻ (vocab: từ điển · error: câu hỏi rút gọn + đáp án · grammar: chủ đề) */
  async payloadsFor(userId: string, rows: CardRow[], locale: string): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    const byType = (t: string) => rows.filter((r) => r.cardType === t);
    const vocab = byType('vocab');
    if (vocab.length) {
      const items = new Map((await this.catalog.vocabItemsByIds([...new Set(vocab.map((r) => r.refId))])).map((i) => [i.id, i]));
      for (const r of vocab) {
        const it = items.get(r.refId);
        out.set(r.id, it ? { vocab_item_id: it.id, ...DictionaryService.cardPayload(it, locale) } : { missing: true });
      }
    }
    const errors = byType('error');
    if (errors.length) {
      const payloads = await this.errorPayloads(userId, errors.map((r) => r.refId), locale);
      for (const r of errors) out.set(r.id, payloads.get(r.refId) ?? { missing: true });
    }
    const grammar = byType('grammar');
    if (grammar.length) {
      const topics = new Map((await this.catalog.grammarTopicsByIds([...new Set(grammar.map((r) => r.refId))])).map((g) => [g.id, g]));
      for (const r of grammar) {
        const g = topics.get(r.refId);
        out.set(r.id, g ? { grammar_topic_id: g.id, code: g.code, name: pickLocalized(g.name as LocalizedText, locale), level: g.level ?? null } : { missing: true });
      }
    }
    for (const r of rows) if (!out.has(r.id)) out.set(r.id, {});
    return out;
  }

  /** Payload thẻ lỗi: câu (bản đã làm) rút gọn + đáp án đúng + giải thích tác giả + ghi chú (không dùng trong Exam Mode) */
  async errorPayloads(userId: string, entryIds: string[], locale: string): Promise<Map<string, Record<string, unknown>>> {
    const entries = entryIds.length ? await this.dbs.db.select().from(learnErrorLogEntries).where(and(eq(learnErrorLogEntries.userId, userId), inArray(learnErrorLogEntries.id, entryIds))) : [];
    const versions = await this.catalog.loadByVersionIds(entries.map((e) => e.questionVersionId).filter((x): x is string => !!x));
    const out = new Map<string, Record<string, unknown>>();
    for (const e of entries) {
      const q = e.questionVersionId ? versions.get(e.questionVersionId) : undefined;
      const c = q?.content;
      out.set(e.id, {
        error_entry_id: e.id,
        kind: e.reasonOverride ?? e.errorKind,
        section_code: q?.section_code ?? null,
        question_type: q?.question_type ?? null,
        question_id: e.questionId ?? null,
        question_version_id: e.questionVersionId ?? null,
        stem: c ? (c.stem ?? '').slice(0, 400) : null,
        options: c && 'options' in c && Array.isArray(c.options) ? (c.options as Array<{ key: string; text: string }>).map((o) => ({ key: o.key, text: o.text.slice(0, 300) })) : [],
        passage_excerpt: q?.passage?.body ? q.passage.body.slice(0, 400) : null,
        correct_answer: c ? correctAnswerOf(c) : null,
        explanation: c?.explanation ? pickLocalized(c.explanation, locale) || null : null,
        evidence: c?.evidence ? c.evidence.slice(0, 300) : null,
        note: e.note ?? null,
        occurrences: e.occurrences,
      });
    }
    return out;
  }

  private async examActive(userId: string): Promise<boolean> {
    return !!(await this.exam.activeExamAttempt(userId).catch(() => 'unknown'));
  }

  // ------------------------------------------------------------------ phiên ôn
  /** GET /me/srs/due */
  async due(userId: string, q: { program: ProgramCode; card_type?: string; list_id?: string; limit: number }): Promise<SrsDueList> {
    const now = this.now();
    const tz = await this.gamification.timezoneOf(userId);
    const endOfDay = zonedDayStart(addDays(localDate(now, tz), 1), tz);
    const conds: SQL[] = [eq(learnSrsCards.userId, userId), eq(learnSrsCards.programCode, q.program), eq(learnSrsCards.suspended, false)];
    if (q.list_id) {
      const list = await this.catalog.vocabListById(q.list_id);
      if (!list || (list.ownerUserId && list.ownerUserId !== userId)) throw new NotFound('vocab_list', q.list_id);
      const ids = (await this.catalog.vocabListItemIds([q.list_id])).get(q.list_id) ?? [];
      conds.push(eq(learnSrsCards.cardType, 'vocab'), ids.length ? inArray(learnSrsCards.refId, ids) : sql`false`);
    } else if (q.card_type) conds.push(eq(learnSrsCards.cardType, q.card_type as CardRow['cardType']));
    if (await this.examActive(userId)) conds.push(ne(learnSrsCards.cardType, 'error'));
    const where = and(...conds);
    const [counts] = await this.dbs.db
      .select({
        due: sql<number>`count(*) filter (where ${learnSrsCards.state} <> 'new' and ${learnSrsCards.dueAt} < ${endOfDay.toISOString()}::timestamptz)`.mapWith(Number),
        dueNow: sql<number>`count(*) filter (where ${learnSrsCards.state} <> 'new' and ${learnSrsCards.dueAt} <= ${now.toISOString()}::timestamptz)`.mapWith(Number),
        newTotal: sql<number>`count(*) filter (where ${learnSrsCards.state} = 'new')`.mapWith(Number),
        nextDue: sql<string | null>`min(${learnSrsCards.dueAt}) filter (where ${learnSrsCards.state} <> 'new' and ${learnSrsCards.dueAt} > ${now.toISOString()}::timestamptz)`,
      })
      .from(learnSrsCards)
      .where(where);
    const dueRows = await this.dbs.db
      .select()
      .from(learnSrsCards)
      .where(and(where, ne(learnSrsCards.state, 'new'), sql`${learnSrsCards.dueAt} <= ${now.toISOString()}::timestamptz`))
      .orderBy(sql`case when ${learnSrsCards.state} in ('learning','relearning') then 0 else 1 end`, asc(learnSrsCards.dueAt), asc(learnSrsCards.id))
      .limit(q.limit);
    const quota = await this.gate.quotaStatus(userId, q.program, 'srs_new_cards');
    const slots = Math.max(0, Math.min(quota.remaining ?? Number.MAX_SAFE_INTEGER, q.limit - dueRows.length));
    const newRows = slots > 0 ? await this.dbs.db.select().from(learnSrsCards).where(and(where, eq(learnSrsCards.state, 'new'))).orderBy(asc(learnSrsCards.createdAt), asc(learnSrsCards.id)).limit(slots) : [];
    const rows = [...dueRows, ...newRows];
    const [locale, opts] = await Promise.all([this.locale(userId), this.options(userId, q.program)]);
    const payloads = await this.payloadsFor(userId, rows, locale);
    const data = rows.map((r) => {
      const p = previewIntervals(fromStored(this.stored(r)), now, opts);
      return this.toDto(r, payloads.get(r.id) ?? {}, { preview: { again: p[1].toISOString(), hard: p[2].toISOString(), good: p[3].toISOString(), easy: p[4].toISOString() } });
    });
    return {
      data,
      counts: { due: counts?.due ?? 0, due_now: counts?.dueNow ?? 0, new_total: counts?.newTotal ?? 0, new_limit: quota.limit, new_used_today: quota.used, new_remaining: quota.remaining, new_in_session: newRows.length },
      next_due_at: counts?.nextDue ? new Date(counts.nextDue).toISOString() : null,
      new_resets_at: quota.resets_at,
      server_time: now.toISOString(),
    };
  }

  /** Thẻ đến hạn ngay (đã học) + thẻ mới còn được học hôm nay – task vocab_review (S10) */
  async dueSummary(userId: string, program: string): Promise<{ due_now: number; new_available: number; total: number }> {
    const now = this.now();
    const [r] = await this.dbs.db
      .select({
        dueNow: sql<number>`count(*) filter (where ${learnSrsCards.state} <> 'new' and ${learnSrsCards.dueAt} <= ${now.toISOString()}::timestamptz)`.mapWith(Number),
        newTotal: sql<number>`count(*) filter (where ${learnSrsCards.state} = 'new')`.mapWith(Number),
      })
      .from(learnSrsCards)
      .where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.programCode, program), eq(learnSrsCards.suspended, false), ne(learnSrsCards.cardType, 'error')));
    const quota = await this.gate.quotaStatus(userId, program, 'srs_new_cards');
    const newAvailable = Math.min(r?.newTotal ?? 0, quota.remaining ?? Number.MAX_SAFE_INTEGER);
    return { due_now: r?.dueNow ?? 0, new_available: newAvailable, total: (r?.dueNow ?? 0) + newAvailable };
  }

  /**
   * POST /me/srs/review – lô ≤ 100. Idempotent theo (card_id, reviewed_at): trùng → `duplicate: true`, không đổi lịch. Lần ôn
   * đầu của thẻ `new` tiêu quota `srs_new_cards` (cả lô – vượt → 429, không ghi gì). Ghi srs_reviews + cập nhật thẻ + XP
   * `srs_review` + ngày học (chuỗi) trong MỘT transaction.
   */
  async review(userId: string, input: SrsReviewInput): Promise<SrsCard[]> {
    const now = this.now();
    const items = input.reviews.map((r, i) => {
      let at = r.reviewed_at ? new Date(r.reviewed_at) : now;
      if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) at = now;
      // Postgres timestamptz: độ chính xác µs – JS ms là đủ; chuẩn hoá ms để so khớp khoá idempotent
      at = new Date(Math.floor(at.getTime()));
      return { idx: i, card_id: r.card_id, rating: r.rating as SrsRating, mode: r.review_mode ?? 'flashcard', at };
    });
    const ids = [...new Set(items.map((x) => x.card_id))];
    const cards = await this.dbs.db.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), inArray(learnSrsCards.id, ids)));
    if (cards.length !== ids.length) throw new NotFound('srs_card', ids.find((id) => !cards.some((c) => c.id === id)));
    if (cards.some((c) => c.cardType === 'error')) await this.exam.assertNotInExam(userId);
    const existing = await this.dbs.db
      .select({ cardId: learnSrsReviews.cardId, at: learnSrsReviews.reviewedAt })
      .from(learnSrsReviews)
      .where(and(inArray(learnSrsReviews.cardId, ids), inArray(learnSrsReviews.reviewedAt, [...new Set(items.map((x) => x.at.getTime()))].map((t) => new Date(t)))));
    const dupKey = (cardId: string, at: Date) => `${cardId}@${at.getTime()}`;
    const dups = new Set(existing.map((e) => dupKey(e.cardId, e.at)));
    // Thẻ new được ôn lần đầu trong lô (không trùng) → tiêu quota theo chương trình
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const firstNew = new Map<string, number>();
    const seen = new Set<string>();
    for (const it of [...items].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      const c = cardById.get(it.card_id)!;
      if (dups.has(dupKey(it.card_id, it.at)) || seen.has(it.card_id)) continue;
      seen.add(it.card_id);
      if (c.state === 'new') firstNew.set(c.programCode, (firstNew.get(c.programCode) ?? 0) + 1);
    }
    const tickets: GateTicket[] = [];
    try {
      for (const [program, n] of firstNew) tickets.push(await this.gate.consume(userId, program, 'srs_new_cards', { amount: n }));
    } catch (err) {
      for (const t of tickets) await t.release();
      throw err;
    }
    const programs = [...new Set(cards.map((c) => c.programCode))];
    const optsBy = new Map(await Promise.all(programs.map(async (p) => [p, await this.options(userId, p)] as const)));
    let applied = 0;
    const flags = new Map<string, { duplicate: boolean }>();
    // S11: ngữ cảnh ngày học đọc TRƯỚC transaction (tránh deadlock pool)
    const studyCtx = await this.gamification.studyDayContext(userId, programs[0] ?? DEFAULT_PROGRAM);
    try {
      await this.dbs.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gamification:${userId}`}))`);
        const locked = await tx.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), inArray(learnSrsCards.id, ids))).for('update');
        const state = new Map(locked.map((c) => [c.id, c]));
        for (const it of [...items].sort((a, b) => a.at.getTime() - b.at.getTime() || a.idx - b.idx)) {
          const c = state.get(it.card_id)!;
          const key = dupKey(it.card_id, it.at);
          // Trùng khoá, hoặc cũ hơn lần ôn đã ghi (gửi lại không theo thứ tự) → không đổi lịch
          if (dups.has(key) || (c.lastReviewAt && it.at.getTime() <= c.lastReviewAt.getTime())) {
            flags.set(it.card_id, { duplicate: true });
            continue;
          }
          const out = reviewCard(fromStored(this.stored(c)), it.rating, it.at, optsBy.get(c.programCode));
          const [rev] = await tx
            .insert(learnSrsReviews)
            .values({ cardId: c.id, rating: it.rating, reviewMode: it.mode, elapsedDays: out.review.elapsed_days, scheduledDays: out.review.scheduled_days, reviewedAt: it.at })
            .onConflictDoNothing()
            .returning({ id: learnSrsReviews.id });
          if (!rev) {
            flags.set(it.card_id, { duplicate: true });
            continue;
          }
          dups.add(key);
          const next = { state: out.card.state, stability: out.card.stability, difficulty: out.card.difficulty, dueAt: out.card.due_at, lastReviewAt: out.card.last_review_at, reps: out.card.reps, lapses: out.card.lapses };
          await tx.update(learnSrsCards).set(next).where(eq(learnSrsCards.id, c.id));
          state.set(c.id, { ...c, ...next });
          flags.set(it.card_id, { duplicate: false });
          await this.gamification.awardXp(tx, userId, 'srs_review', XP_TABLE.srs_review, { type: 'srs_review', id: rev.id });
          applied++;
        }
        if (applied > 0) await this.gamification.recordStudyDay(tx, userId, programs[0] ?? DEFAULT_PROGRAM, studyCtx);
      });
    } catch (err) {
      for (const t of tickets) await t.release();
      throw err;
    }
    // Thẻ new trùng (đã ôn trước) không tiêu quota thật – hoàn phần dư nếu có (chỉ xảy ra khi đua)
    const fresh = await this.dbs.db.select().from(learnSrsCards).where(inArray(learnSrsCards.id, ids));
    const locale = await this.locale(userId);
    const payloads = await this.payloadsFor(userId, fresh, locale);
    const byId = new Map(fresh.map((c) => [c.id, c]));
    if (applied > 0) {
      const summary = await this.dueSummary(userId, programs[0] ?? DEFAULT_PROGRAM).catch(() => ({ due_now: 0, new_available: 0, total: 0 }));
      const ev: SrsReviewedEvent = { user_id: userId, programs, reviewed: applied, due_now_left: summary.total };
      this.outbox.emitLocal(SRS_REVIEWED_EVENT, ev as unknown as Record<string, unknown>);
    }
    const nowAt = this.now();
    const nowMs = nowAt.getTime();
    return ids.map((id) => {
      const c = byId.get(id)!;
      const inSession = (c.state === 'learning' || c.state === 'relearning') && c.dueAt.getTime() - nowMs <= SRS_IN_SESSION_MS;
      // S12 (fix web S10): trả `preview` (hạn kế tiếp cho từng nút) như GET /me/srs/due – web cập nhật nút mà không gọi lại due
      const p = previewIntervals(fromStored(this.stored(c)), nowAt, optsBy.get(c.programCode));
      return this.toDto(c, payloads.get(id) ?? {}, { duplicate: flags.get(id)?.duplicate ?? true, in_session: inSession, preview: { again: p[1].toISOString(), hard: p[2].toISOString(), good: p[3].toISOString(), easy: p[4].toISOString() } });
    });
  }

  // ------------------------------------------------------------------ thẻ
  /** GET /me/srs/cards */
  async list(userId: string, q: { program: ProgramCode; card_type?: string; state?: string; list_id?: string; q?: string; cursor?: string; limit: number }): Promise<{ data: SrsCard[]; next_cursor: string | null }> {
    const conds: SQL[] = [eq(learnSrsCards.userId, userId), eq(learnSrsCards.programCode, q.program)];
    if (q.card_type) conds.push(eq(learnSrsCards.cardType, q.card_type as CardRow['cardType']));
    if (q.state) conds.push(eq(learnSrsCards.state, q.state as CardRow['state']));
    if (q.list_id) {
      const ids = (await this.catalog.vocabListItemIds([q.list_id])).get(q.list_id) ?? [];
      conds.push(eq(learnSrsCards.cardType, 'vocab'), ids.length ? inArray(learnSrsCards.refId, ids) : sql`false`);
    }
    if (q.q) {
      const ids = await this.catalog.vocabItemIdsByHeadword(q.program, q.q);
      conds.push(eq(learnSrsCards.cardType, 'vocab'), ids.length ? inArray(learnSrsCards.refId, ids) : sql`false`);
    }
    if (await this.examActive(userId)) conds.push(ne(learnSrsCards.cardType, 'error'));
    const c = decodeCursor<{ created_at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${learnSrsCards.createdAt}, ${learnSrsCards.id}) < (${new Date(c.created_at).toISOString()}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(learnSrsCards).where(and(...conds)).orderBy(desc(learnSrsCards.createdAt), desc(learnSrsCards.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const payloads = await this.payloadsFor(userId, page, await this.locale(userId));
    return {
      data: page.map((r) => this.toDto(r, payloads.get(r.id) ?? {})),
      next_cursor: rows.length > q.limit ? encodeCursor({ created_at: page.at(-1)!.createdAt.toISOString(), id: page.at(-1)!.id }) : null,
    };
  }

  /** POST /me/srs/cards – vocab (ref_id | headword) | error (mục sổ lỗi của chính người học) | grammar (grammar_topic) */
  async addCard(userId: string, input: SrsCardCreate): Promise<SrsCard> {
    const locale = await this.locale(userId);
    let refId: string;
    let sourceType = input.source_type ?? null;
    if (input.card_type === 'vocab') {
      const item = await this.dictionary.resolveVocabItem(input.program, { id: input.ref_id, headword: input.headword, locale, context: input.context ?? null });
      if (!item) throw new NotFound('vocab_item', input.ref_id ?? input.headword);
      if (item.programCode !== input.program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'vocab item belongs to another program' }] });
      refId = item.id;
      sourceType ??= 'dictionary';
    } else if (input.card_type === 'error') {
      const [e] = await this.dbs.db.select({ id: learnErrorLogEntries.id, program: learnErrorLogEntries.programCode }).from(learnErrorLogEntries).where(and(eq(learnErrorLogEntries.id, input.ref_id!), eq(learnErrorLogEntries.userId, userId))).limit(1);
      if (!e) throw new NotFound('error_log_entry', input.ref_id);
      if (e.program !== input.program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'error entry belongs to another program' }] });
      await this.exam.assertNotInExam(userId);
      refId = e.id;
      sourceType ??= 'error_log';
    } else if (input.card_type === 'grammar') {
      const [g] = await this.catalog.grammarTopicsByIds([input.ref_id!]);
      if (!g) throw new NotFound('grammar_topic', input.ref_id);
      if (g.programCode !== input.program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'grammar topic belongs to another program' }] });
      refId = g.id;
      sourceType ??= 'manual';
    } else {
      throw new ValidationFailed({ issues: [{ path: 'card_type', message: `${input.card_type} cards are not supported yet (GĐ2)` }] });
    }
    return this.insertCard(userId, input.program, input.card_type, refId, sourceType, input.source_id ?? null, locale, input.context ?? null);
  }

  private async insertCard(userId: string, program: string, cardType: CardRow['cardType'], refId: string, sourceType: string | null, sourceId: string | null, locale: string, context: string | null): Promise<SrsCard> {
    const [row] = await this.dbs.db.insert(learnSrsCards).values({ userId, programCode: program, cardType, refId, sourceType, sourceId, state: 'new', dueAt: this.now() }).onConflictDoNothing().returning();
    const card = row ?? (await this.dbs.db.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, cardType), eq(learnSrsCards.refId, refId))).limit(1))[0]!;
    const payload = (await this.payloadsFor(userId, [card], locale)).get(card.id) ?? {};
    return this.toDto(card, context ? { ...payload, context } : payload, { created: !!row });
  }

  /** Thẻ lỗi cho mục sổ lỗi (PATCH /me/errors/{id} create_card) – idempotent */
  async ensureErrorCard(userId: string, program: string, entryId: string): Promise<SrsCard> {
    return this.insertCard(userId, program, 'error', entryId, 'error_log', entryId, await this.locale(userId), null);
  }

  /** Thẻ theo ref (sổ lỗi hiển thị srs_card_id) */
  async cardIdsByRef(userId: string, cardType: CardRow['cardType'], refIds: string[]): Promise<Map<string, string>> {
    if (!refIds.length) return new Map();
    const rows = await this.dbs.db.select({ id: learnSrsCards.id, refId: learnSrsCards.refId }).from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, cardType), inArray(learnSrsCards.refId, refIds)));
    return new Map(rows.map((r) => [r.refId, r.id]));
  }

  /** Thẻ vocab của người dùng theo vocab_item_id (DictionaryEntry.saved / srs_card_id) */
  async vocabCardsFor(userId: string, vocabItemIds: string[]): Promise<Map<string, string>> {
    return this.cardIdsByRef(userId, 'vocab', vocabItemIds);
  }

  // ------------------------------------------------------------------ bộ từ
  private listCounts(itemIds: string[], cards: Map<string, CardRow>, endOfDay: Date) {
    const c = { total: itemIds.length, new: 0, learning: 0, due: 0, mastered: 0, enrolled: 0 };
    for (const id of itemIds) {
      const card = cards.get(id);
      if (!card) continue;
      c.enrolled++;
      if (card.state === 'new') c.new++;
      else if (isMastered({ state: card.state, stability: card.stability ?? null })) c.mastered++;
      else c.learning++;
      if (card.state !== 'new' && card.dueAt < endOfDay) c.due++;
    }
    return c;
  }

  private nextAction(c: { enrolled: number; due: number; new: number }, locale: string): { code: VocabList['next_action_code']; text: string } {
    const vi = locale === 'vi';
    if (c.enrolled === 0) return { code: 'enroll', text: vi ? 'Thêm vào ôn tập' : 'Add to review' };
    if (c.due > 0) return { code: 'review', text: vi ? `Ôn ${c.due}` : `Review ${c.due}` };
    if (c.new > 0) return { code: 'learn_new', text: vi ? `Học ${c.new} từ mới` : `Learn ${c.new} new` };
    return { code: 'done', text: vi ? 'Đã ôn xong hôm nay' : 'All done for today' };
  }

  /** GET /vocab/lists – bộ hệ thống + của tôi kèm tiến độ */
  async lists(userId: string, program: ProgramCode): Promise<VocabList[]> {
    const lists = await this.catalog.vocabListsFor(program, userId);
    const items = await this.catalog.vocabListItemIds(lists.map((l) => l.id));
    const all = [...new Set([...items.values()].flat())];
    const cards = all.length ? await this.dbs.db.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, 'vocab'), inArray(learnSrsCards.refId, all))) : [];
    const byRef = new Map(cards.map((c) => [c.refId, c]));
    const tz = await this.gamification.timezoneOf(userId);
    const endOfDay = zonedDayStart(addDays(localDate(this.now(), tz), 1), tz);
    const locale = await this.locale(userId);
    const topics = await this.catalog.topicCodes(lists.map((l) => l.topicId).filter((x): x is string => !!x));
    return lists.map((l) => {
      const counts = this.listCounts(items.get(l.id) ?? [], byRef, endOfDay);
      const na = this.nextAction(counts, locale);
      return { id: l.id, program: l.programCode, kind: l.kind, title: l.title, is_free: l.isFree, sort_order: l.sortOrder, topic: l.topicId ? (topics.get(l.topicId) ?? null) : null, counts, enrolled: counts.enrolled > 0, next_action_code: na.code, next_action: na.text };
    });
  }

  private async ownedList(userId: string, listId: string) {
    const list = await this.catalog.vocabListById(listId);
    if (!list || (list.ownerUserId && list.ownerUserId !== userId)) throw new NotFound('vocab_list', listId);
    return list;
  }

  /** GET /vocab/lists/{id}/items – cursor theo sort_order */
  async listItems(userId: string, listId: string, q: { cursor?: string; limit: number }): Promise<{ data: VocabItem[]; next_cursor: string | null }> {
    await this.ownedList(userId, listId);
    const c = decodeCursor<{ sort: number }>(q.cursor);
    const rows = await this.catalog.vocabListItemsPage(listId, typeof c?.sort === 'number' ? c.sort : null, q.limit + 1);
    const page = rows.slice(0, q.limit);
    const cards = page.length ? await this.dbs.db.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, 'vocab'), inArray(learnSrsCards.refId, page.map((r) => r.item.id)))) : [];
    const byRef = new Map(cards.map((x) => [x.refId, x]));
    return {
      data: page.map(({ item, sort }) => this.vocabItemDto(item, sort, byRef.get(item.id) ?? null)),
      next_cursor: rows.length > q.limit ? encodeCursor({ sort: page.at(-1)!.sort }) : null,
    };
  }

  private vocabItemDto(item: VocabRow, sort: number, card: CardRow | null): VocabItem {
    return {
      id: item.id,
      kind: item.kind,
      headword: item.headword,
      reading: item.reading ?? null,
      sino_vietnamese: item.sinoVietnamese ?? null,
      pos: item.pos ?? null,
      ipa_uk: item.ipaUk ?? null,
      ipa_us: item.ipaUs ?? null,
      audio_uk_url: null,
      audio_us_url: null,
      meanings: item.meanings,
      examples: (item.examples as unknown[] | null) ?? [],
      collocations: (item.collocations as string[] | null) ?? [],
      level: item.level ?? null,
      topics: item.topics ?? [],
      sort_order: sort,
      srs: card ? this.toDto(card, {}) : null,
    };
  }

  /** POST /vocab/lists/{id}/enroll – "thêm cả bộ": thẻ new cho từ chưa có (idempotent, không tiêu quota) */
  async enroll(userId: string, listId: string): Promise<VocabEnrollResult> {
    const list = await this.ownedList(userId, listId);
    if (!list.isFree) {
      const ctx = await this.gate.context(userId, list.programCode);
      if (ctx.planKind === 'free') throw new Forbidden('Feature requires an upgrade', { feature: 'vocab_list', program: list.programCode, upgrade: true });
    }
    const ids = (await this.catalog.vocabListItemIds([listId])).get(listId) ?? [];
    let added = 0;
    const now = this.now();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      // created_at tăng dần theo thứ tự trong bộ → thẻ mới được học đúng thứ tự (GET /me/srs/due sắp theo created_at)
      const rows = await this.dbs.db
        .insert(learnSrsCards)
        .values(chunk.map((refId, k) => ({ userId, programCode: list.programCode, cardType: 'vocab' as const, refId, sourceType: 'vocab_list', sourceId: listId, state: 'new' as const, dueAt: now, createdAt: new Date(now.getTime() + i + k) })))
        .onConflictDoNothing()
        .returning({ id: learnSrsCards.id });
      added += rows.length;
    }
    const quota = await this.gate.quotaStatus(userId, list.programCode, 'srs_new_cards');
    this.logger.info({ list_id: listId, added, total: ids.length }, 'vocab list enrolled');
    if (added) this.outbox.emitLocal(SRS_REVIEWED_EVENT, { user_id: userId, programs: [list.programCode], reviewed: 0, due_now_left: -1 });
    return { list_id: listId, total: ids.length, added, existing: ids.length - added, new_per_day: quota.limit };
  }

  // ------------------------------------------------------------------ tối ưu tham số (job tuần)
  /** Người dùng × chương trình có ≥ 1.000 review và chưa tối ưu trong 7 ngày */
  async optimizationCandidates(now: Date, limit = 200): Promise<Array<{ userId: string; program: string; reviews: number }>> {
    const rows = await this.dbs.db.execute<{ user_id: string; program_code: string; n: number }>(sql`
      select c.user_id, c.program_code, count(*)::int as n
        from learn.srs_reviews r join learn.srs_cards c on c.id = r.card_id
       group by c.user_id, c.program_code
      having count(*) >= ${MIN_REVIEWS_FOR_OPTIMIZATION}
         and not exists (select 1 from learn.enrollments e where e.user_id = c.user_id and e.program_code = c.program_code
                          and (e.fsrs_params ->> 'optimized_at') is not null
                          and (e.fsrs_params ->> 'optimized_at')::timestamptz > ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz)
       limit ${limit}`);
    return [...rows].map((r) => ({ userId: r.user_id, program: r.program_code, reviews: Number(r.n) }));
  }

  /** Tối ưu trọng số FSRS-5 cho một người dùng × chương trình (A151) – lưu learn.enrollments.fsrs_params */
  async optimizeUser(userId: string, program: string, now: Date = this.now(), db: DbOrTx = this.dbs.db): Promise<{ improved: boolean; reviews: number } | null> {
    const logs = await db
      .select({ card_id: learnSrsReviews.cardId, rating: learnSrsReviews.rating, reviewed_at: learnSrsReviews.reviewedAt })
      .from(learnSrsReviews)
      .innerJoin(learnSrsCards, eq(learnSrsCards.id, learnSrsReviews.cardId))
      .where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.programCode, program)))
      .orderBy(desc(learnSrsReviews.reviewedAt))
      .limit(20_000);
    const prev = await this.enrollments.fsrsParams(userId, program);
    const r = optimizeWeights(logs.map((l) => ({ card_id: l.card_id, rating: l.rating as SrsRating, reviewed_at: l.reviewed_at })));
    if (!r) return null;
    await this.enrollments.setFsrsParams(userId, program as ProgramCode, {
      model: FSRS_MODEL_VERSION,
      w: r.weights ?? (sanitizeWeights(prev?.w ?? null) ?? null),
      improved: r.improved,
      review_count: r.reviews,
      cards: r.cards,
      loss_default: r.loss_default,
      loss_optimized: r.loss_optimized,
      optimizer: 'allingo-cd-v1',
      optimized_at: now.toISOString(),
    });
    this.optionsCache.delete(`${userId}:${program}`);
    return { improved: r.improved, reviews: r.reviews };
  }

  async optimizeDue(now: Date = this.now()): Promise<{ users: number; improved: number }> {
    const cands = await this.optimizationCandidates(now);
    let improved = 0;
    for (const c of cands) {
      const r = await this.optimizeUser(c.userId, c.program, now).catch((err: Error) => {
        this.logger.warn({ err: err.message.slice(0, 200) }, 'srs.optimize failed for user');
        return null;
      });
      if (r?.improved) improved++;
    }
    if (cands.length) this.logger.info({ users: cands.length, improved }, 'srs.optimize');
    return { users: cands.length, improved };
  }
}
