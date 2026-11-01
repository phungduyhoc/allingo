import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { FEATURE_CODES, type AiStreamEvent, type TutorChatOutput } from '@allingo/schemas';
import { DbService } from '../../../shared/db/db.module.js';
import { Forbidden, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { encodeCursor, decodeCursor } from '../../../shared/http/cursor.js';
import { CatalogQueryService } from '../../catalog/index.js';
import { EntitlementService, QuotaService } from '../../billing/index.js';
import { UsersService } from '../../iam/index.js';
import { AiGatewayService } from '../core/ai-gateway.service.js';
import { GuardrailsService } from '../core/guardrails.service.js';

const { learnChatThreads, learnChatMessages } = schema;

export interface ThreadContext {
  attempt_id?: string;
  submission_id?: string;
  lesson_id?: string;
  question_version_id?: string;
  mode?: 'text' | 'voice';
}

/**
 * Tutor chat (tutor_chat): guard_classify → Exam Mode → quota → ngữ cảnh tối thiểu (câu hỏi tham chiếu, không đáp án khi exam) → stream.
 * ContextBuilder đầy đủ (tóm tắt attempt, lỗi gần đây, mục tiêu) ở Sprint 6.
 */
@Injectable()
export class ThreadsService {
  constructor(
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly guard: GuardrailsService,
    private readonly catalog: CatalogQueryService,
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly users: UsersService,
  ) {}

  private toThreadDto(t: typeof learnChatThreads.$inferSelect) {
    return { id: t.id, program: t.programCode ?? null, title: t.title ?? null, context: (t.context as ThreadContext | null) ?? null, updated_at: t.updatedAt.toISOString() };
  }

  private toMessageDto(m: typeof learnChatMessages.$inferSelect) {
    const c = (m.content as { text?: string; actions?: unknown[]; audio_url?: string | null }) ?? {};
    return { id: m.id, role: m.role as 'user' | 'assistant' | 'system', text: c.text ?? '', audio_url: c.audio_url ?? null, actions: (c.actions as Record<string, unknown>[]) ?? [], ai_task_id: m.aiTaskId ?? null, created_at: m.createdAt.toISOString() };
  }

  async create(userId: string, input: { program?: string; context?: ThreadContext }) {
    const [row] = await this.dbs.db.insert(learnChatThreads).values({ userId, programCode: input.program ?? null, context: input.context ?? null, title: null }).returning();
    return this.toThreadDto(row!);
  }

  async list(userId: string, cursor?: string, limit = 20) {
    const c = decodeCursor<{ updated_at: string }>(cursor);
    const rows = await this.dbs.db
      .select()
      .from(learnChatThreads)
      .where(and(eq(learnChatThreads.userId, userId), c ? eq(learnChatThreads.updatedAt, new Date(c.updated_at)) : undefined))
      .orderBy(desc(learnChatThreads.updatedAt))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { data: page.map((t) => this.toThreadDto(t)), next_cursor: rows.length > limit ? encodeCursor({ updated_at: page.at(-1)!.updatedAt.toISOString() }) : null };
  }

  async getOwned(userId: string, threadId: string) {
    const [t] = await this.dbs.db.select().from(learnChatThreads).where(eq(learnChatThreads.id, threadId)).limit(1);
    if (!t) throw new NotFound('thread', threadId);
    if (t.userId !== userId) throw new Forbidden();
    return t;
  }

  async messages(userId: string, threadId: string, limit = 50) {
    await this.getOwned(userId, threadId);
    const rows = await this.dbs.db.select().from(learnChatMessages).where(eq(learnChatMessages.threadId, threadId)).orderBy(asc(learnChatMessages.createdAt)).limit(limit);
    return { data: rows.map((m) => this.toMessageDto(m)), next_cursor: null };
  }

  /** Gửi tin nhắn → stream phản hồi gia sư */
  async send(userId: string, threadId: string, input: { text?: string; recording_id?: string }, traceId?: string): Promise<AsyncGenerator<AiStreamEvent>> {
    const thread = await this.getOwned(userId, threadId);
    const text = input.text?.trim();
    if (!text) throw new ValidationFailed({ issues: [{ path: 'text', message: 'text is required (voice messages arrive in Sprint 6)' }] });
    const program = thread.programCode ?? 'toeic';
    const examLock = await this.guard.examLockOf(userId);
    const guard = await this.guard.classify(userId, text, { mode: 'chat', examMode: !!examLock, taskCode: 'tutor_chat', program });
    if (!guard.allowed) {
      const aiTaskId = await this.gateway.recordRefused('tutor_chat', userId, `${guard.category}: ${guard.reason}`, { thread_id: threadId });
      const refusal = { reply_markdown: 'Mình chỉ hỗ trợ nội dung học ngoại ngữ và luyện thi. Bạn muốn tiếp tục với câu hỏi đang xem chứ?', actions: [], suggested_followups: [], grounded_on: [], refused: true };
      await this.dbs.db.insert(learnChatMessages).values([
        { threadId, role: 'user', content: { text } },
        { threadId, role: 'assistant', content: { text: refusal.reply_markdown, actions: [], refused: true, category: guard.category }, aiTaskId },
      ]);
      async function* refused(): AsyncGenerator<AiStreamEvent> {
        yield { event: 'start', ai_task_id: aiTaskId, cached: false };
        yield { event: 'result', data: refusal, ai_task_id: aiTaskId, cached: false };
        yield { event: 'done' };
      }
      return refused();
    }
    if (examLock) await this.guard.assertNotInExam(userId);
    const ctxEnt = await this.entitlements.require(userId, program, FEATURE_CODES.AI_TUTOR);
    await this.quotas.consume(userId, ctxEnt.planKind, FEATURE_CODES.AI_TUTOR);

    const context = (thread.context as ThreadContext | null) ?? {};
    let referencedQuestion: Record<string, unknown> | null = null;
    if (context.question_version_id) {
      const q = (await this.catalog.loadByVersionIds([context.question_version_id])).get(context.question_version_id);
      if (q) {
        const c = q.content as Record<string, unknown>;
        referencedQuestion = { stem: c.stem, options: c.options, section_code: q.section_code, question_type: q.question_type, correct_option: examLock ? '(hidden: exam in progress)' : ((c.answer_key as { correct?: unknown })?.correct ?? null) };
      }
    }
    const history = await this.dbs.db.select().from(learnChatMessages).where(eq(learnChatMessages.threadId, threadId)).orderBy(desc(learnChatMessages.createdAt)).limit(10);
    const user = await this.users.findById(userId);
    const variables = {
      program,
      exam_mode: String(!!examLock),
      entitlement: ctxEnt.isPro ? 'pro' : 'free',
      proactive_allowed: 'false',
      allowed_actions: ['open_page', 'show_question'],
      target_score: null,
      exam_date: null,
      current_estimate: null,
      attempt_summary: null,
      submission_summary: null,
      recurring_errors: [],
      today_plan: null,
      referenced_question: referencedQuestion,
      history: history.reverse().map((m) => ({ role: m.role, text: (m.content as { text?: string }).text ?? '' })),
      message: text,
    };
    await this.dbs.db.insert(learnChatMessages).values({ threadId, role: 'user', content: { text } });
    const dbs = this.dbs;
    const stream = this.gateway.streamTask<TutorChatOutput>(
      { taskCode: 'tutor_chat', userId, variables, locale: user?.explainLocale ?? 'vi', program, inputRef: { thread_id: threadId }, traceId },
      async (tx, r) => {
        await tx.insert(learnChatMessages).values({ threadId, role: 'assistant', content: { text: r.data.reply_markdown, actions: r.data.actions, suggested_followups: r.data.suggested_followups }, aiTaskId: r.aiTaskId });
        await tx.update(learnChatThreads).set({ updatedAt: new Date(), title: thread.title ?? text.slice(0, 80) }).where(eq(learnChatThreads.id, threadId));
      },
    );
    void dbs;
    return stream;
  }
}
