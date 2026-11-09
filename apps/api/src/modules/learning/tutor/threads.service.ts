import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  DEFAULT_PROGRAM,
  describeQuestion,
  FEATURE_GATES,
  pickLocalized,
  type AiStreamEvent,
  type LocalizedText,
  type Message,
  type ProgramCode,
  type RefusalCode,
  type Thread,
  type ThreadContext,
  type ThreadDetail,
  type TutorChatOutput,
  type TutorCitation,
  type TutorReply,
} from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { Forbidden, InsufficientCredits, NotFound, QuotaExceeded, ValidationFailed } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AiGatewayService, createJsonFieldStreamer, GuardrailsService } from '../../ai-gateway/index.js';
import { CreditService, FeatureGateService, type GateTicket, type PlanKind } from '../../billing/index.js';
import { CatalogQueryService, type LoadedQuestion } from '../../catalog/index.js';
import { EnrollmentsService, UsersService } from '../../iam/index.js';
import { AttemptInsightsService } from '../../test-engine/index.js';
import { buildTutorContext, type TutorReferencedQuestion, type TutorSystemSummary, type TutorTurn } from './context-builder.js';

const { learnChatThreads, learnChatMessages, learnNotes } = schema;
type ThreadRow = typeof learnChatThreads.$inferSelect;
type MessageRow = typeof learnChatMessages.$inferSelect;

interface MessageContent {
  text?: string;
  actions?: Array<Record<string, unknown>>;
  suggested_followups?: string[];
  citations?: TutorCitation[];
  grounded_on?: string[];
  refused?: boolean;
  refusal_code?: RefusalCode | null;
  audio_url?: string | null;
}

/** Hành động UI được phép đề xuất (allowed_actions trong <data>); target khác bị loại */
const ALLOWED_ACTIONS = ['open_page', 'show_question'] as const;
const HISTORY_TURNS = 12;
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

const excerpt = (s: unknown, n = 160) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

/**
 * Gia sư AI (tutor_chat, S6) – module learning vì cần ngữ cảnh bài làm (test-engine) + mục tiêu (iam) + tóm tắt (learning):
 * Exam Mode (decorator, 403) → giới hạn lượt/thread (billing.quotas `ai_tutor_thread_turns`) → guard (PII che + luật cục bộ +
 * guard_classify, fail-closed) → entitlement → credit → quota ngày `ai_tutor` → ContextBuilder → AiGateway.streamTask.
 * Từ chối: ai_tasks.status = refused, KHÔNG gọi model chính, không trừ credit/lượt.
 */
@Injectable()
export class ThreadsService {
  private readonly logger = getLogger({ component: 'learning.tutor' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly guard: GuardrailsService,
    private readonly catalog: CatalogQueryService,
    private readonly gate: FeatureGateService,
    private readonly credits: CreditService,
    private readonly users: UsersService,
    private readonly enrollments: EnrollmentsService,
    private readonly insights: AttemptInsightsService,
  ) {}

  // ------------------------------------------------------------------ DTO
  private contextOf(t: ThreadRow): ThreadContext {
    const c = (t.context as Partial<ThreadContext> | null) ?? {};
    const kind = c.kind ?? (c.question_version_id ? 'question' : c.attempt_id ? 'attempt' : 'free');
    return { ...(c as ThreadContext), mode: c.mode ?? 'text', kind };
  }

  private toThreadDto(t: ThreadRow, turns?: { used: number; limit: number | null }): Thread {
    return {
      id: t.id,
      program: t.programCode ?? null,
      title: t.title ?? null,
      context: this.contextOf(t),
      updated_at: t.updatedAt.toISOString(),
      created_at: t.createdAt.toISOString(),
      ...(turns ? { turns: { used: turns.used, limit: turns.limit, remaining: turns.limit === null ? null : Math.max(0, turns.limit - turns.used) } } : {}),
    };
  }

  toMessageDto(m: MessageRow): Message {
    const c = (m.content as MessageContent | null) ?? {};
    const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
    return {
      id: m.id,
      role,
      text: c.text ?? '',
      audio_url: c.audio_url ?? null,
      actions: c.actions ?? [],
      ai_task_id: m.aiTaskId ?? null,
      created_at: m.createdAt.toISOString(),
      ...(role === 'assistant' ? { refused: !!c.refused, refusal_code: c.refusal_code ?? null, suggested_followups: c.suggested_followups ?? [], citations: c.citations ?? [] } : {}),
    };
  }

  // ------------------------------------------------------------------ lượt/thread
  /** Hạn mức lượt/thread = quota theo phạm vi của gate ai_tutor (FEATURE_GATES – S7, đọc billing.quotas) */
  private turnLimit(planKind: PlanKind): Promise<number | null> {
    return this.gate.scopedLimit(planKind, 'ai_tutor');
  }

  /** Lượt đã dùng = số câu trả lời gia sư KHÔNG bị từ chối (lượt bị guard từ chối / AI lỗi không tính) */
  private async turnsUsed(threadIds: string[]): Promise<Map<string, number>> {
    if (!threadIds.length) return new Map();
    const rows = await this.dbs.db
      .select({ threadId: learnChatMessages.threadId, n: count() })
      .from(learnChatMessages)
      .where(and(inArray(learnChatMessages.threadId, threadIds), eq(learnChatMessages.role, 'assistant'), sql`coalesce((${learnChatMessages.content} ->> 'refused')::boolean, false) = false`))
      .groupBy(learnChatMessages.threadId);
    return new Map(rows.map((r) => [r.threadId, Number(r.n)]));
  }

  private async turnsOf(userId: string, t: ThreadRow): Promise<{ used: number; limit: number | null }> {
    const ctx = await this.gate.context(userId, t.programCode ?? DEFAULT_PROGRAM);
    const [used, limit] = await Promise.all([this.turnsUsed([t.id]).then((m) => m.get(t.id) ?? 0), this.turnLimit(ctx.planKind)]);
    return { used, limit };
  }

  // ------------------------------------------------------------------ thread
  async create(userId: string, input: { program?: ProgramCode; context?: Partial<ThreadContext>; title?: string }): Promise<Thread> {
    const c = input.context ?? {};
    let program: string = input.program ?? DEFAULT_PROGRAM;
    let context: ThreadContext;
    if (c.kind === 'free' || (!c.attempt_id && !c.question_version_id)) {
      context = { kind: 'free', mode: c.mode ?? 'text', ...(c.lesson_id ? { lesson_id: c.lesson_id } : {}) };
    } else {
      if (c.attempt_id) {
        const a = await this.insights.assertOwned(userId, c.attempt_id);
        program = a.program;
        if (c.question_version_id && !a.questionVersionIds.includes(c.question_version_id)) throw new ValidationFailed({ issues: [{ path: 'context.question_version_id', message: 'question is not part of the attempt' }] });
      }
      if (c.question_version_id) {
        const q = (await this.catalog.loadByVersionIds([c.question_version_id])).get(c.question_version_id);
        if (!q) throw new NotFound('question_version', c.question_version_id);
        program = q.program_code;
      }
      if (input.program && input.program !== program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'program does not match the context' }] });
      context = { kind: c.question_version_id ? 'question' : 'attempt', mode: c.mode ?? 'text', ...(c.attempt_id ? { attempt_id: c.attempt_id } : {}), ...(c.question_version_id ? { question_version_id: c.question_version_id } : {}) };
    }
    // Mốc thời gian đặt từ JS (độ chính xác ms) để cursor ISO so sánh chính xác
    const now = new Date();
    const [row] = await this.dbs.db.insert(learnChatThreads).values({ userId, programCode: program, context, title: input.title ?? null, createdAt: now, updatedAt: now }).returning();
    return this.toThreadDto(row!, await this.turnsOf(userId, row!));
  }

  async list(userId: string, cursor?: string, limit = 20): Promise<{ data: Thread[]; next_cursor: string | null }> {
    const c = decodeCursor<{ u: string; id: string }>(cursor);
    const rows = await this.dbs.db
      .select()
      .from(learnChatThreads)
      .where(and(eq(learnChatThreads.userId, userId), c ? sql`(${learnChatThreads.updatedAt}, ${learnChatThreads.id}) < (${c.u}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(learnChatThreads.updatedAt), desc(learnChatThreads.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const used = await this.turnsUsed(page.map((t) => t.id));
    const limits = new Map<string, number | null>();
    for (const p of new Set(page.map((t) => t.programCode ?? DEFAULT_PROGRAM))) limits.set(p, await this.turnLimit((await this.gate.context(userId, p)).planKind));
    return {
      data: page.map((t) => this.toThreadDto(t, { used: used.get(t.id) ?? 0, limit: limits.get(t.programCode ?? DEFAULT_PROGRAM) ?? null })),
      next_cursor: rows.length > limit ? encodeCursor({ u: page.at(-1)!.updatedAt.toISOString(), id: page.at(-1)!.id }) : null,
    };
  }

  async getOwned(userId: string, threadId: string): Promise<ThreadRow> {
    const [t] = await this.dbs.db.select().from(learnChatThreads).where(eq(learnChatThreads.id, threadId)).limit(1);
    if (!t) throw new NotFound('thread', threadId);
    if (t.userId !== userId) throw new Forbidden();
    return t;
  }

  /** Trang tin nhắn: không cursor → mới nhất; mỗi trang cũ → mới; next_cursor trỏ trang CŨ hơn */
  async messages(userId: string, threadId: string, cursor?: string, limit = 50): Promise<{ data: Message[]; next_cursor: string | null }> {
    await this.getOwned(userId, threadId);
    return this.messagePage(threadId, cursor, limit);
  }

  private async messagePage(threadId: string, cursor: string | undefined, limit: number) {
    const c = decodeCursor<{ c: string; id: string }>(cursor);
    const rows = await this.dbs.db
      .select()
      .from(learnChatMessages)
      .where(and(eq(learnChatMessages.threadId, threadId), c ? sql`(${learnChatMessages.createdAt}, ${learnChatMessages.id}) < (${c.c}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(learnChatMessages.createdAt), desc(learnChatMessages.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const oldest = page.at(-1);
    return { data: page.reverse().map((m) => this.toMessageDto(m)), next_cursor: rows.length > limit && oldest ? encodeCursor({ c: oldest.createdAt.toISOString(), id: oldest.id }) : null };
  }

  async detail(userId: string, threadId: string, limit = 50): Promise<ThreadDetail> {
    const t = await this.getOwned(userId, threadId);
    const [page, turns] = await Promise.all([this.messagePage(threadId, undefined, limit), this.turnsOf(userId, t)]);
    return { ...this.toThreadDto(t, turns), messages: page.data, next_cursor: page.next_cursor };
  }

  // ------------------------------------------------------------------ ngữ cảnh
  private async referencedQuestion(userId: string, ctx: ThreadContext): Promise<{ data: TutorReferencedQuestion; loaded: LoadedQuestion } | null> {
    if (!ctx.question_version_id) return null;
    const q = (await this.catalog.loadByVersionIds([ctx.question_version_id])).get(ctx.question_version_id);
    if (!q) return null;
    // Có attempt: chỉ lộ đáp án khi attempt đã nộp/chấm (hoặc practice đã trả lời câu); không attempt (Review/duyệt) → như /ai/explain
    const rs = ctx.attempt_id ? await this.insights.revealState(userId, ctx.attempt_id, ctx.question_version_id) : null;
    const reveal = rs ? rs.reveal : true;
    const content = q.content as { explanation?: LocalizedText };
    const user = await this.users.findById(userId);
    // C2: mọi dạng câu qua describeQuestion() – đáp án đúng/của người học chỉ khi reveal (Exam Mode không lộ – ADR-0028)
    const d = describeQuestion(q.content, reveal ? (rs?.answer ?? null) : null);
    const multi = q.content.type !== 'mcq_single';
    return {
      loaded: q,
      data: {
        question_version_id: q.question_version_id,
        section_code: q.section_code,
        question_type: q.question_type,
        stem: d.stem,
        options: d.options,
        passage_excerpt: q.passage && q.passage.kind !== 'audio_script' ? q.passage.body : null,
        reveal,
        correct_option: reveal ? d.correct_text || null : null,
        explanation: reveal && content.explanation ? pickLocalized(content.explanation, user?.explainLocale ?? 'vi') || null : null,
        learner_choice: reveal ? (multi ? d.chosen_text : (rs?.chosen ?? null)) : null,
        items: multi ? d.items : undefined,
        instructions: d.instructions,
      },
    };
  }

  private async latestSummary(userId: string, program: string): Promise<TutorSystemSummary | null> {
    const [n] = await this.dbs.db
      .select({ data: learnNotes.data })
      .from(learnNotes)
      .where(and(eq(learnNotes.userId, userId), eq(learnNotes.kind, 'system_summary'), sql`${learnNotes.data} ->> 'program' = ${program}`))
      .orderBy(desc(learnNotes.updatedAt))
      .limit(1);
    return ((n?.data as { summary?: TutorSystemSummary } | null)?.summary) ?? null;
  }

  private async history(threadId: string): Promise<TutorTurn[]> {
    const rows = await this.dbs.db.select().from(learnChatMessages).where(eq(learnChatMessages.threadId, threadId)).orderBy(desc(learnChatMessages.createdAt), desc(learnChatMessages.id)).limit(HISTORY_TURNS * 2);
    return rows
      .reverse()
      .filter((m) => !(m.content as MessageContent).refused && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: (m.content as MessageContent).text ?? '' }))
      .filter((m) => m.text.trim().length > 0);
  }

  /** Lọc hành động model đề xuất: chỉ loại cho phép; open_page phải là đường dẫn tương đối; show_question phải là câu trong ngữ cảnh */
  static sanitizeActions(actions: TutorChatOutput['actions'], ctx: ThreadContext): TutorReply['actions'] {
    return (actions ?? [])
      .filter((a) => (ALLOWED_ACTIONS as readonly string[]).includes(a.type))
      .filter((a) => (a.type === 'open_page' ? /^\/(?!\/)[\w\-./?=&%#]*$/.test(a.target) : a.target === ctx.question_version_id))
      .slice(0, 2)
      .map((a) => ({ type: a.type, target: a.target, label: a.label.slice(0, 60) }));
  }

  // ------------------------------------------------------------------ gửi tin nhắn
  async send(userId: string, threadId: string, input: { text?: string; recording_id?: string }, traceId?: string): Promise<AsyncGenerator<AiStreamEvent>> {
    const thread = await this.getOwned(userId, threadId);
    const raw = input.text?.trim();
    if (!raw) throw new ValidationFailed({ issues: [{ path: 'text', message: input.recording_id ? 'voice messages are not supported yet (GĐ2)' : 'text is required' }] });
    const program = thread.programCode ?? DEFAULT_PROGRAM;
    const ctx = this.contextOf(thread);
    const ent = await this.gate.context(userId, program);

    // 1) Giới hạn lượt/thread theo gói (đọc billing.quotas, không hard-code)
    const limit = await this.turnLimit(ent.planKind);
    const used = (await this.turnsUsed([threadId])).get(threadId) ?? 0;
    if (limit !== null && used >= limit) {
      throw new QuotaExceeded({ feature: FEATURE_GATES.ai_tutor.scopedQuota, period: 'lifetime', limit, used, remaining: 0, resets_at: FAR_FUTURE, reset_at: FAR_FUTURE }, { scope: 'thread', thread_id: threadId });
    }

    // 2) Guard (PII che trước khi tới model; luật cục bộ; guard_classify) – fail-closed
    const decision = await this.guard.check(userId, raw, { mode: 'input', examMode: false, taskCode: 'tutor_chat', program });
    if (decision.source === 'unavailable') {
      async function* unavailable(): AsyncGenerator<AiStreamEvent> {
        yield { event: 'error', code: 'ai_failed', message: 'guard_unavailable' };
        yield { event: 'done' };
      }
      return unavailable();
    }
    const userAt = new Date();
    const replyAt = new Date(userAt.getTime() + 1);
    if (!decision.allowed) {
      const code = decision.refusalCode ?? 'unsafe';
      const aiTaskId = await this.gateway.recordRefused('tutor_chat', userId, `${decision.category} (${decision.source})`, { thread_id: threadId, category: decision.category, refusal_code: code, source: decision.source, guard_task_id: decision.guardTaskId });
      const replyId = randomUUID();
      const [userMsg] = await this.dbs.db.transaction(async (tx) => {
        const r = await tx.insert(learnChatMessages).values({ threadId, role: 'user', content: { text: decision.text, pii_redacted: decision.piiRedacted }, createdAt: userAt }).returning({ id: learnChatMessages.id });
        await tx.insert(learnChatMessages).values({ id: replyId, threadId, role: 'assistant', content: { text: '', actions: [], refused: true, refusal_code: code }, aiTaskId, createdAt: replyAt });
        await tx.update(learnChatThreads).set({ updatedAt: replyAt }).where(eq(learnChatThreads.id, threadId));
        return r;
      });
      const reply: TutorReply = { message_id: replyId, user_message_id: userMsg!.id, reply_markdown: '', actions: [], suggested_followups: [], grounded_on: [], citations: [], refused: true, refusal_code: code, turns: { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) } };
      this.logger.info({ thread_id: threadId, category: decision.category, source: decision.source }, 'tutor message refused by guard');
      async function* refused(): AsyncGenerator<AiStreamEvent> {
        yield { event: 'start', ai_task_id: aiTaskId, cached: false };
        yield { event: 'result', data: reply, ai_task_id: aiTaskId, cached: false };
        yield { event: 'done' };
      }
      return refused();
    }

    // 3) Quyền + credit + quota ngày (kiểm tra ở server – §5.7)
    // Gating S7 (FEATURE_GATES.ai_tutor): quyền → credit → quota ngày
    await this.gate.check(userId, program, 'ai_tutor');
    const cost = await this.gateway.estimateCredits('tutor_chat', program);
    if (cost > 0 && !(await this.credits.hasAtLeast(userId, cost))) throw new InsufficientCredits({ required: cost, balance: await this.credits.balance(userId) });
    const ticket: GateTicket = await this.gate.consume(userId, program, 'ai_tutor');

    // 4) Ngữ cảnh
    let variables: Record<string, unknown>;
    let citations: TutorCitation[] = [];
    let userMessageId: string;
    let locale = 'vi';
    try {
      const [user, enrollment, attempt, summary, refq, mistakes, history] = await Promise.all([
        this.users.findById(userId),
        this.enrollments.get(userId, program as ProgramCode),
        ctx.attempt_id ? this.insights.contextSnapshot(userId, ctx.attempt_id) : Promise.resolve(null),
        this.latestSummary(userId, program),
        this.referencedQuestion(userId, ctx),
        this.insights.recentMistakes(userId, program, 5),
        this.history(threadId),
      ]);
      const currentEstimate = (enrollment?.currentLevel as { overall?: number } | null)?.overall ?? attempt?.scaled_score ?? null;
      const built = buildTutorContext({
        program,
        entitlement: ent.isPro ? 'pro' : 'free',
        examMode: false,
        goal: enrollment ? { target_score: enrollment.targetScore !== null ? Number(enrollment.targetScore) : null, target_level: enrollment.targetLevel ?? null, exam_date: enrollment.examDate ?? null, current_estimate: currentEstimate } : null,
        attempt,
        systemSummary: summary,
        question: refq?.data ?? null,
        mistakes,
        history,
        message: decision.text,
        allowedActions: [...ALLOWED_ACTIONS],
        budgetTokens: this.env.AI_TUTOR_CONTEXT_TOKENS,
      });
      variables = built.variables;
      if (built.trimmed.length) this.logger.debug({ thread_id: threadId, trimmed: built.trimmed, tokens: built.tokens }, 'tutor context trimmed to budget');
      if (refq) citations = [{ type: 'question', question_version_id: refq.data.question_version_id, section_code: refq.data.section_code, excerpt: excerpt(refq.data.stem) }];
      const [um] = await this.dbs.db.insert(learnChatMessages).values({ threadId, role: 'user', content: { text: decision.text, pii_redacted: decision.piiRedacted }, createdAt: userAt }).returning({ id: learnChatMessages.id });
      userMessageId = um!.id;
      locale = user?.explainLocale ?? 'vi';
    } catch (err) {
      await ticket.release();
      throw err;
    }

    const replyId = randomUUID();
    const title = thread.title ?? excerpt(decision.text, 80);
    const stream = this.gateway.streamTask<TutorChatOutput>(
      { taskCode: 'tutor_chat', userId, variables, locale, program, inputRef: { thread_id: threadId, message_id: userMessageId, question_version_id: ctx.question_version_id ?? null, attempt_id: ctx.attempt_id ?? null }, traceId },
      async (tx, r) => {
        const actions = ThreadsService.sanitizeActions(r.data.actions, ctx);
        await tx.insert(learnChatMessages).values({ id: replyId, threadId, role: 'assistant', content: { text: r.data.reply_markdown, actions, suggested_followups: r.data.suggested_followups, citations, grounded_on: r.data.grounded_on, refused: false, model_refused: !!r.data.refused }, aiTaskId: r.aiTaskId, createdAt: new Date(Math.max(Date.now(), replyAt.getTime())) });
        await tx.update(learnChatThreads).set({ updatedAt: new Date(), title }).where(eq(learnChatThreads.id, threadId));
      },
    );
    async function* mapped(): AsyncGenerator<AiStreamEvent> {
      const field = createJsonFieldStreamer('reply_markdown');
      let succeeded = false;
      try {
        for await (const ev of stream) {
          if (ev.event === 'delta') {
            const text = field.push(ev.text);
            if (text) yield { event: 'delta', text };
          } else if (ev.event === 'result') {
            succeeded = true;
            const out = ev.data as TutorChatOutput;
            const reply: TutorReply = {
              message_id: replyId,
              user_message_id: userMessageId,
              reply_markdown: out.reply_markdown,
              actions: ThreadsService.sanitizeActions(out.actions, ctx),
              suggested_followups: out.suggested_followups ?? [],
              grounded_on: out.grounded_on ?? [],
              citations,
              refused: !!out.refused,
              refusal_code: null,
              turns: { used: used + 1, limit, remaining: limit === null ? null : Math.max(0, limit - used - 1) },
            };
            yield { event: 'result', data: reply, ai_task_id: ev.ai_task_id, cached: false };
          } else {
            yield ev;
          }
        }
      } catch (err) {
        yield { event: 'error', code: 'ai_failed', message: (err as Error).message.slice(0, 120) };
        yield { event: 'done' };
      } finally {
        // AI lỗi / client ngắt trước khi có kết quả → hoàn lượt ngày (không trừ credit vì chưa finalize)
        if (!succeeded) await ticket.release();
      }
    }
    return mapped();
  }

  /** Tin nhắn của thread theo thứ tự (test/analytics) */
  async messagesAsc(threadId: string): Promise<MessageRow[]> {
    return this.dbs.db.select().from(learnChatMessages).where(eq(learnChatMessages.threadId, threadId)).orderBy(asc(learnChatMessages.createdAt), asc(learnChatMessages.id));
  }
}
