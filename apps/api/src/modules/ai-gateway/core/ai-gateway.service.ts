import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, type AiStreamEvent, type AiTaskCode } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { ExplanationCacheService } from './explanation-cache.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { InsufficientCredits } from '../../../shared/http/errors.js';
import { CreditService } from '../../billing/index.js';
import { ModelRouter } from './model-router.js';
import { PromptRenderer } from './prompt-renderer.js';
import { repairPrompt, validateOutput } from './structured-output.js';
import { TaskRegistry } from './task-registry.js';
import { AiTaskFailedError, type ChatMessage, type ModelProviderAdapter, type ProviderResult, type ResolvedModel, type ResolvedTask, type RunTaskInput, type RunTaskResult } from './types.js';

const { aiAiTasks } = schema;

/**
 * AiGateway (ADR-0007, CLAUDE.md §5.2–5.4): điểm vào duy nhất cho mọi lời gọi model.
 * runTask: registry → render → router (primary → fallback) → validate Zod → repair 1 lần → fallback → failed + hoàn credit.
 * Metering: ai.ai_tasks ghi lúc bắt đầu (running) và kết thúc; credit trừ trong cùng transaction với kết quả (persist callback).
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = getLogger({ component: 'ai.gateway' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly registry: TaskRegistry,
    private readonly renderer: PromptRenderer,
    private readonly router: ModelRouter,
    private readonly credits: CreditService,
    private readonly outbox: OutboxService,
    private readonly explanationCache: ExplanationCacheService,
  ) {}

  /** Credit cần cho tác vụ (theo ai.model_routes.credits_cost) */
  async estimateCredits(taskCode: AiTaskCode, program: string | null = null): Promise<number> {
    const task = await this.registry.resolve(taskCode, program, null);
    return task?.route.creditsCost ?? 0;
  }

  async resolveTask(taskCode: AiTaskCode, program: string | null, userId: string | null): Promise<ResolvedTask> {
    const task = await this.registry.resolve(taskCode, program, userId);
    if (!task) throw new AiTaskFailedError('not_configured', `No active prompt version for ${taskCode}`);
    return task;
  }

  /**
   * Chạy tác vụ không stream. `persist` (tuỳ chọn) được gọi trong CÙNG transaction với cập nhật ai_tasks + trừ credit
   * để lưu kết quả nghiệp vụ (cache giải thích, grading_results…).
   */
  async runTask<T = unknown>(input: RunTaskInput, persist?: (tx: DbOrTx, result: { data: T; aiTaskId: string }) => Promise<void>): Promise<RunTaskResult<T>> {
    const started = Date.now();
    const task = await this.resolveTask(input.taskCode, input.program ?? null, input.userId);
    const charge = (input.chargeCredits ?? !!input.userId) && !!input.userId ? task.route.creditsCost : 0;
    if (charge > 0 && !(await this.credits.hasAtLeast(input.userId!, charge))) {
      throw new InsufficientCredits({ required: charge, balance: await this.credits.balance(input.userId!) });
    }
    const messages = this.renderer.render(task, { ...input.variables, explain_locale: input.locale ?? (input.variables.explain_locale) ?? 'vi' });
    const aiTaskId = await this.openTask(task, input, messages);

    const attempt = await this.callWithFallback(task, messages, input, aiTaskId);
    if (!attempt.ok) {
      await this.failTask(aiTaskId, attempt.error, started, attempt.model);
      throw new AiTaskFailedError(attempt.reason, attempt.error, aiTaskId);
    }
    const latency = Date.now() - started;
    let creditsCharged = 0;
    await this.dbs.db.transaction(async (tx) => {
      if (charge > 0) {
        await this.credits.charge(tx, input.userId!, charge, { refType: 'ai_task', refId: aiTaskId, aiTaskId, note: input.taskCode });
        creditsCharged = charge;
      }
      await tx
        .update(aiAiTasks)
        .set({
          status: 'succeeded',
          modelUsed: attempt.model.modelId,
          provider: attempt.model.provider,
          output: this.env.AI_TRACE_CONTENT ? (attempt.data) : { _redacted: true, keys: Object.keys((attempt.data as Record<string, unknown>) ?? {}) },
          tokensIn: attempt.result.tokensIn,
          tokensOut: attempt.result.tokensOut,
          costUsd: attempt.result.costUsd !== null ? String(attempt.result.costUsd) : null,
          creditsCharged,
          latencyMs: latency,
          finishedAt: new Date(),
          error: attempt.fallbackUsed || attempt.repaired ? JSON.stringify({ fallback_used: attempt.fallbackUsed, repaired: attempt.repaired }) : null,
        })
        .where(eq(aiAiTasks.id, aiTaskId));
      if (persist) await persist(tx, { data: attempt.data as T, aiTaskId });
      await this.outbox.write(tx, { aggregateType: 'ai_task', aggregateId: aiTaskId, eventType: DOMAIN_EVENTS.AI_TASK_COMPLETED, payload: { ai_task_id: aiTaskId, user_id: input.userId, task_code: input.taskCode, status: 'succeeded', latency_ms: latency } });
    });
    this.outbox.emitLocal(DOMAIN_EVENTS.AI_TASK_COMPLETED, { ai_task_id: aiTaskId, user_id: input.userId, task_code: input.taskCode, status: 'succeeded' });
    return { data: attempt.data as T, aiTaskId, cached: false, model: attempt.model, tokensIn: attempt.result.tokensIn, tokensOut: attempt.result.tokensOut, costUsd: attempt.result.costUsd, latencyMs: latency, creditsCharged, repaired: attempt.repaired, fallbackUsed: attempt.fallbackUsed };
  }

  /**
   * Stream: phát delta văn bản từ model chính; kết thúc validate; sai → repair/fallback KHÔNG stream (gọi runTask phần còn lại).
   * Trả AsyncGenerator các AiStreamEvent; `persist` như runTask.
   */
  async *streamTask<T = unknown>(input: RunTaskInput, persist?: (tx: DbOrTx, result: { data: T; aiTaskId: string }) => Promise<void>): AsyncGenerator<AiStreamEvent> {
    const started = Date.now();
    const task = await this.resolveTask(input.taskCode, input.program ?? null, input.userId);
    const charge = (input.chargeCredits ?? !!input.userId) && !!input.userId ? task.route.creditsCost : 0;
    if (charge > 0 && !(await this.credits.hasAtLeast(input.userId!, charge))) {
      throw new InsufficientCredits({ required: charge, balance: await this.credits.balance(input.userId!) });
    }
    const messages = this.renderer.render(task, { ...input.variables, explain_locale: input.locale ?? 'vi' });
    const aiTaskId = await this.openTask(task, input, messages);
    yield { event: 'start', ai_task_id: aiTaskId, cached: false };

    const candidates = this.router.candidates(task);
    const first = candidates[0]!;
    let streamed: ProviderResult | null = null;
    try {
      for await (const chunk of first.adapter.stream(this.callOpts(task, first.model, messages, input))) {
        if (chunk.type === 'delta' && chunk.text) yield { event: 'delta', text: chunk.text };
        if (chunk.type === 'final' && chunk.result) streamed = chunk.result;
      }
      this.router.recordSuccess(first.model.provider);
    } catch (err) {
      this.router.recordFailure(first.model.provider);
      this.logger.warn({ err: (err as Error).message, model: first.model.alias }, 'stream failed, trying fallback');
    }

    let outcome: Awaited<ReturnType<AiGatewayService['callWithFallback']>>;
    if (streamed) {
      const v = validateOutput(input.taskCode, streamed.text);
      if (v.ok) outcome = { ok: true, data: v.data, result: streamed, model: first.model, repaired: false, fallbackUsed: false };
      else outcome = await this.callWithFallback(task, messages, input, aiTaskId, { repairFrom: { text: streamed.text, issues: v.issues ?? [] }, startAt: 0 });
    } else {
      outcome = await this.callWithFallback(task, messages, input, aiTaskId, { startAt: 1 });
    }

    if (!outcome.ok) {
      await this.failTask(aiTaskId, outcome.error, started, outcome.model);
      yield { event: 'error', code: 'ai_failed', message: outcome.error };
      yield { event: 'done' };
      return;
    }
    const latency = Date.now() - started;
    let creditsCharged = 0;
    await this.dbs.db.transaction(async (tx) => {
      if (charge > 0) {
        await this.credits.charge(tx, input.userId!, charge, { refType: 'ai_task', refId: aiTaskId, aiTaskId, note: input.taskCode });
        creditsCharged = charge;
      }
      await tx
        .update(aiAiTasks)
        .set({
          status: 'succeeded',
          modelUsed: outcome.model.modelId,
          provider: outcome.model.provider,
          output: this.env.AI_TRACE_CONTENT ? (outcome.data) : { _redacted: true },
          tokensIn: outcome.result.tokensIn,
          tokensOut: outcome.result.tokensOut,
          costUsd: outcome.result.costUsd !== null ? String(outcome.result.costUsd) : null,
          creditsCharged,
          latencyMs: latency,
          finishedAt: new Date(),
          error: outcome.fallbackUsed || outcome.repaired ? JSON.stringify({ fallback_used: outcome.fallbackUsed, repaired: outcome.repaired }) : null,
        })
        .where(eq(aiAiTasks.id, aiTaskId));
      if (persist) await persist(tx, { data: outcome.data as T, aiTaskId });
      await this.outbox.write(tx, { aggregateType: 'ai_task', aggregateId: aiTaskId, eventType: DOMAIN_EVENTS.AI_TASK_COMPLETED, payload: { ai_task_id: aiTaskId, user_id: input.userId, task_code: input.taskCode, status: 'succeeded', latency_ms: latency } });
    });
    this.outbox.emitLocal(DOMAIN_EVENTS.AI_TASK_COMPLETED, { ai_task_id: aiTaskId, user_id: input.userId, task_code: input.taskCode, status: 'succeeded' });
    yield { event: 'result', data: outcome.data, ai_task_id: aiTaskId, cached: false };
    yield { event: 'done' };
  }

  /** Đánh dấu refused (guardrail) – không gọi model, không trừ credit */
  async recordRefused(taskCode: AiTaskCode, userId: string | null, reason: string, inputRef?: Record<string, unknown>): Promise<string> {
    const [row] = await this.dbs.db
      .insert(aiAiTasks)
      .values({ userId, taskCode, status: 'refused', inputRef: inputRef ?? null, error: reason, creditsCharged: 0, finishedAt: new Date() })
      .returning({ id: aiAiTasks.id });
    return row!.id;
  }

  // ------------------------------------------------------------------ nội bộ
  private callOpts(task: ResolvedTask, model: ResolvedModel, messages: ChatMessage[], input: RunTaskInput) {
    const params = task.route.params as { temperature?: number; top_p?: number; max_tokens?: number };
    return {
      model,
      messages,
      temperature: params.temperature ?? task.modelPolicy.temperature,
      topP: params.top_p ?? task.modelPolicy.top_p,
      maxTokens: params.max_tokens ?? task.modelPolicy.max_tokens,
      timeoutMs: task.route.timeoutMs,
      outputSchema: task.outputSchema,
      taskCode: task.taskCode,
      signal: input.signal,
    };
  }

  private async openTask(task: ResolvedTask, input: RunTaskInput, messages: ChatMessage[]): Promise<string> {
    const inputHash = createHash('sha256').update(messages.map((m) => m.content).join('\n')).digest('hex').slice(0, 32);
    const [row] = await this.dbs.db
      .insert(aiAiTasks)
      .values({ userId: input.userId, taskCode: task.taskCode, promptVersionId: task.promptVersionId, status: 'running', inputRef: input.inputRef ?? null, inputHash, traceId: input.traceId ?? null, creditsCharged: 0 })
      .returning({ id: aiAiTasks.id });
    return row!.id;
  }

  private async failTask(aiTaskId: string, error: string, started: number, model: ResolvedModel | null): Promise<void> {
    await this.dbs.db
      .update(aiAiTasks)
      .set({ status: error.includes('timeout') ? 'timeout' : 'failed', error: error.slice(0, 500), latencyMs: Date.now() - started, finishedAt: new Date(), modelUsed: model?.modelId ?? null, provider: model?.provider ?? null })
      .where(eq(aiAiTasks.id, aiTaskId));
    this.outbox.emitLocal(DOMAIN_EVENTS.AI_TASK_COMPLETED, { ai_task_id: aiTaskId, user_id: null, task_code: '', status: 'failed' });
  }

  /**
   * Thử lần lượt các model: gọi → validate → (sai) repair 1 lần cùng model → (vẫn sai/lỗi) model kế tiếp.
   */
  private async callWithFallback(
    task: ResolvedTask,
    messages: ChatMessage[],
    input: RunTaskInput,
    aiTaskId: string,
    opts: { repairFrom?: { text: string; issues: Array<{ path: string; message: string }> }; startAt?: number } = {},
  ): Promise<{ ok: true; data: unknown; result: ProviderResult; model: ResolvedModel; repaired: boolean; fallbackUsed: boolean } | { ok: false; error: string; reason: 'provider_error' | 'invalid_output' | 'timeout'; model: ResolvedModel | null }> {
    const candidates = this.router.candidates(task);
    let lastError = 'no candidates';
    let reason: 'provider_error' | 'invalid_output' | 'timeout' = 'provider_error';
    let lastModel: ResolvedModel | null = null;
    for (let i = opts.startAt ?? 0; i < candidates.length; i++) {
      const { model, adapter } = candidates[i]!;
      lastModel = model;
      const fallbackUsed = i > 0;
      // Lần 1 (hoặc repair ngay nếu đã có text stream lỗi)
      let first: { text: string; issues: Array<{ path: string; message: string }> } | null = opts.repairFrom && i === (opts.startAt ?? 0) ? opts.repairFrom : null;
      let result: ProviderResult | null = null;
      if (!first) {
        const r = await this.safeGenerate(adapter, model, task, messages, input);
        if (!r.ok) {
          lastError = r.error;
          reason = r.error.toLowerCase().includes('timeout') || r.error.toLowerCase().includes('abort') ? 'timeout' : 'provider_error';
          continue;
        }
        result = r.result;
        const v = validateOutput(input.taskCode, r.result.text);
        if (v.ok) return { ok: true, data: v.data, result: r.result, model, repaired: false, fallbackUsed };
        first = { text: r.result.text, issues: v.issues ?? [] };
      }
      // Repair 1 lần
      const repairMessages: ChatMessage[] = [...messages, { role: 'assistant', content: first.text.slice(0, 4000) }, { role: 'user', content: repairPrompt(first.issues, first.text) }];
      const r2 = await this.safeGenerate(adapter, model, task, repairMessages, input);
      if (!r2.ok) {
        lastError = r2.error;
        continue;
      }
      const v2 = validateOutput(input.taskCode, r2.result.text);
      if (v2.ok) {
        const merged: ProviderResult = { ...r2.result, tokensIn: (r2.result.tokensIn ?? 0) + (result?.tokensIn ?? 0), tokensOut: (r2.result.tokensOut ?? 0) + (result?.tokensOut ?? 0), costUsd: (r2.result.costUsd ?? 0) + (result?.costUsd ?? 0) };
        return { ok: true, data: v2.data, result: merged, model, repaired: true, fallbackUsed };
      }
      lastError = `invalid output after repair: ${v2.issues?.map((x) => `${x.path}: ${x.message}`).join('; ')}`;
      reason = 'invalid_output';
    }
    this.logger.error({ task: task.taskCode, ai_task_id: aiTaskId, error: lastError }, 'ai task failed on all models');
    return { ok: false, error: lastError, reason, model: lastModel };
  }

  private async safeGenerate(adapter: ModelProviderAdapter, model: ResolvedModel, task: ResolvedTask, messages: ChatMessage[], input: RunTaskInput): Promise<{ ok: true; result: ProviderResult } | { ok: false; error: string }> {
    try {
      const result = await adapter.generate(this.callOpts(task, model, messages, input));
      this.router.recordSuccess(model.provider);
      return { ok: true, result };
    } catch (err) {
      this.router.recordFailure(model.provider);
      const msg = (err as Error).message ?? 'provider error';
      this.logger.warn({ model: model.alias, err: msg }, 'provider call failed');
      return { ok: false, error: msg };
    }
  }

  /** Tiện ích cho báo cáo chi phí (admin) */
  async costReport(from: Date, to: Date) {
    const rows = await this.dbs.db
      .select()
      .from(aiAiTasks)
      .where(and(eq(aiAiTasks.status, 'succeeded'), gte(aiAiTasks.createdAt, from), lte(aiAiTasks.createdAt, to)));
    const byTask = new Map<string, { count: number; credits: number; cost_usd: number; tokens_in: number; tokens_out: number; cache_hits: number; avg_latency_ms: number }>();
    for (const r of rows) {
      const k = r.taskCode;
      const cur = byTask.get(k) ?? { count: 0, credits: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, cache_hits: 0, avg_latency_ms: 0 };
      cur.count++;
      cur.credits += r.creditsCharged;
      cur.cost_usd += Number(r.costUsd ?? 0);
      cur.tokens_in += r.tokensIn ?? 0;
      cur.tokens_out += r.tokensOut ?? 0;
      if (r.modelUsed === 'cache') cur.cache_hits++;
      cur.avg_latency_ms = Math.round((cur.avg_latency_ms * (cur.count - 1) + (r.latencyMs ?? 0)) / cur.count);
      byTask.set(k, cur);
    }
    // Giải thích trúng cache không tạo ai_tasks (không gọi model, không trừ credit) → đếm từ ai.explanation_cache.hit_count
    const explanationCacheHits = await this.explanationCache.totalHits();
    return { from: from.toISOString(), to: to.toISOString(), total_tasks: rows.length, explanation_cache_hits: explanationCacheHits, by_task: Object.fromEntries(byTask) };
  }
}
