import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Span } from '@opentelemetry/api';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { costUsd, DOMAIN_EVENTS, priceFor, type AiStreamEvent, type AiTaskCode } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AI_METRICS } from '../../../shared/telemetry/metrics.js';
import { InsufficientCredits } from '../../../shared/http/errors.js';
import { CreditService } from '../../billing/index.js';
import { AiTelemetry } from './ai-telemetry.js';
import { EmbeddingService } from './embedding.service.js';
import { ExplanationCacheService } from './explanation-cache.service.js';
import { ModelRouter, type RouteCandidate } from './model-router.js';
import { PromptRenderer } from './prompt-renderer.js';
import { errorCodeOf, isTransientError, withRetry } from './retry.js';
import { repairPrompt, validateOutput } from './structured-output.js';
import { TaskRegistry } from './task-registry.js';
import { AiTaskFailedError, type ChatMessage, type ProviderResult, type ResolvedModel, type ResolvedTask, type RunTaskInput, type RunTaskResult } from './types.js';

const { aiAiTasks } = schema;

type FailReason = 'provider_error' | 'invalid_output' | 'timeout' | 'not_configured';
type Outcome =
  | { ok: true; data: unknown; result: ProviderResult; model: ResolvedModel; repaired: boolean; fallbackUsed: boolean; costUsd: number | null }
  | { ok: false; error: string; reason: FailReason; model: ResolvedModel | null; fallbackUsed: boolean };
type Persist<T> = (tx: DbOrTx, result: { data: T; aiTaskId: string; promptVersionId: string }) => Promise<void>;

/**
 * AiGateway (ADR-0007, CLAUDE.md §5.2–5.4): điểm vào duy nhất cho mọi lời gọi model.
 * runTask/streamTask: registry (canary theo hash user_id) → render → router (primary → fallback, bỏ qua provider thiếu khoá/breaker mở)
 * → retry có jitter cho lỗi tạm thời → validate Zod → repair 1 lần → model kế tiếp → failed (không trừ credit = "hoàn").
 * Metering: ai.ai_tasks ghi lúc mở (running) và kết thúc với prompt_version_id, model, provider, tokens, cost_usd (bảng giá route),
 * latency_ms, cache_hit, fallback_used, status, error_code; credit trừ trong CÙNG transaction với kết quả (callback persist).
 * Quan sát: span OTel `ai.task`, metrics Prometheus, Langfuse (AiTelemetry).
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = getLogger({ component: 'ai.gateway' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly registry: TaskRegistry,
    private readonly renderer: PromptRenderer,
    private readonly router: ModelRouter,
    private readonly credits: CreditService,
    private readonly outbox: OutboxService,
    private readonly explanationCache: ExplanationCacheService,
    private readonly telemetry: AiTelemetry,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /** Embedding (dedup nội dung) – module khác dùng qua AiGatewayService (ranh giới module §5.1/§5.2) */
  get embeddings(): EmbeddingService {
    return this.embeddingService;
  }

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

  /** Phiên bản prompt registry sẽ dùng cho người dùng (active, hoặc canary theo hash) – null nếu task chưa cấu hình */
  async currentPromptVersionId(taskCode: AiTaskCode, program: string | null, userId: string | null): Promise<string | null> {
    return (await this.registry.resolve(taskCode, program, userId))?.promptVersionId ?? null;
  }

  private chargeOf(task: ResolvedTask, input: RunTaskInput): number {
    return (input.chargeCredits ?? !!input.userId) && !!input.userId ? task.route.creditsCost : 0;
  }

  private async assertCredits(input: RunTaskInput, charge: number): Promise<void> {
    if (charge > 0 && !(await this.credits.hasAtLeast(input.userId!, charge))) {
      throw new InsufficientCredits({ required: charge, balance: await this.credits.balance(input.userId!) });
    }
  }

  /**
   * Chạy tác vụ không stream. `persist` (tuỳ chọn) được gọi trong CÙNG transaction với cập nhật ai_tasks + trừ credit
   * để lưu kết quả nghiệp vụ (cache giải thích, grading_results…).
   */
  async runTask<T = unknown>(input: RunTaskInput, persist?: Persist<T>): Promise<RunTaskResult<T>> {
    const started = this.clock.now();
    const task = input.taskOverride ?? (await this.resolveTask(input.taskCode, input.program ?? null, input.userId));
    const charge = this.chargeOf(task, input);
    await this.assertCredits(input, charge);
    const messages = this.renderer.render(task, { ...input.variables, explain_locale: input.locale ?? (input.variables.explain_locale) ?? 'vi' });
    const aiTaskId = await this.openTask(task, input, messages);
    const span = this.telemetry.startSpan({ taskCode: task.taskCode, promptVersionId: task.promptVersionId, aiTaskId, traceId: input.traceId });

    const outcome = await this.callWithFallback(task, messages, input, aiTaskId);
    if (!outcome.ok) {
      await this.failTask(task, input, aiTaskId, outcome, started, span);
      throw new AiTaskFailedError(outcome.reason, outcome.error, aiTaskId);
    }
    const { latency, creditsCharged } = await this.finalize(task, input, aiTaskId, outcome, started, charge, messages, span, persist);
    return { data: outcome.data as T, aiTaskId, promptVersionId: task.promptVersionId, cached: false, model: outcome.model, tokensIn: outcome.result.tokensIn, tokensOut: outcome.result.tokensOut, costUsd: outcome.costUsd, latencyMs: latency, creditsCharged, repaired: outcome.repaired, fallbackUsed: outcome.fallbackUsed };
  }

  /**
   * Stream: phát delta văn bản từ model đầu tiên; kết thúc validate; sai → repair/fallback KHÔNG stream.
   * Trả AsyncGenerator các AiStreamEvent; `persist` như runTask.
   */
  async *streamTask<T = unknown>(input: RunTaskInput, persist?: Persist<T>): AsyncGenerator<AiStreamEvent> {
    const started = this.clock.now();
    const task = input.taskOverride ?? (await this.resolveTask(input.taskCode, input.program ?? null, input.userId));
    const charge = this.chargeOf(task, input);
    await this.assertCredits(input, charge);
    const messages = this.renderer.render(task, { ...input.variables, explain_locale: input.locale ?? 'vi' });
    const aiTaskId = await this.openTask(task, input, messages);
    const span = this.telemetry.startSpan({ taskCode: task.taskCode, promptVersionId: task.promptVersionId, aiTaskId, traceId: input.traceId });
    yield { event: 'start', ai_task_id: aiTaskId, cached: false };

    const candidates = this.router.candidates(task);
    const first = candidates[0];
    let streamed: ProviderResult | null = null;
    let deltas = 0;
    let streamErr: unknown = null;
    if (first) {
      this.router.begin(first.model.provider);
      try {
        for await (const chunk of first.adapter.stream(this.callOpts(task, first.model, messages, input))) {
          if (chunk.type === 'delta' && chunk.text) {
            deltas++;
            yield { event: 'delta', text: chunk.text };
          }
          if (chunk.type === 'final' && chunk.result) streamed = chunk.result;
        }
        this.router.recordSuccess(first.model.provider);
      } catch (err) {
        streamErr = err;
        this.router.recordFailure(first.model.provider);
        this.logger.warn({ err: (err as Error).message, model: first.model.alias, task: task.taskCode }, 'stream failed, trying fallback');
      }
    }

    let outcome: Outcome;
    if (streamed && first) {
      const v = validateOutput(input.taskCode, streamed.text);
      if (v.ok) outcome = { ok: true, data: v.data, result: streamed, model: first.model, repaired: false, fallbackUsed: !first.isPrimary, costUsd: this.cost(task, first.model, streamed) };
      else outcome = await this.callWithFallback(task, messages, input, aiTaskId, { repairFrom: { text: streamed.text, issues: v.issues ?? [], result: streamed }, startAt: 0 });
    } else {
      // Lỗi tạm thời trước khi có delta → thử lại primary (không stream, có retry); còn lại → model kế tiếp
      const retryPrimary = !!streamErr && deltas === 0 && isTransientError(streamErr);
      outcome = await this.callWithFallback(task, messages, input, aiTaskId, { startAt: first ? (retryPrimary ? 0 : 1) : 0, firstError: streamErr });
    }

    if (!outcome.ok) {
      await this.failTask(task, input, aiTaskId, outcome, started, span);
      yield { event: 'error', code: outcome.reason === 'timeout' ? 'ai_timeout' : 'ai_failed', message: outcome.reason };
      yield { event: 'done' };
      return;
    }
    await this.finalize(task, input, aiTaskId, outcome, started, charge, messages, span, persist);
    yield { event: 'result', data: outcome.data, ai_task_id: aiTaskId, cached: false };
    yield { event: 'done' };
  }

  /**
   * Ghi một lượt trúng cache (không gọi model, không trừ credit): ai_tasks status=succeeded, cache_hit=true, model_used='cache'.
   * Cho phép người học đánh giá 👍/👎 (POST /ai/feedback cần ai_task_id của chính họ) và dashboard đếm cache hit theo ngày.
   */
  async recordCacheHit(opts: { taskCode: AiTaskCode; userId: string | null; promptVersionId: string | null; inputRef?: Record<string, unknown>; traceId?: string | null; latencyMs?: number }): Promise<string> {
    const now = new Date(this.clock.now());
    const latency = opts.latencyMs ?? 0;
    const [row] = await this.dbs.db
      .insert(aiAiTasks)
      .values({ userId: opts.userId, taskCode: opts.taskCode, promptVersionId: opts.promptVersionId, status: 'succeeded', modelUsed: 'cache', provider: 'cache', inputRef: opts.inputRef ?? null, tokensIn: 0, tokensOut: 0, costUsd: '0', creditsCharged: 0, latencyMs: latency, traceId: opts.traceId ?? null, cacheHit: true, fallbackUsed: false, finishedAt: now })
      .returning({ id: aiAiTasks.id });
    const id = row!.id;
    this.telemetry.record({ aiTaskId: id, traceId: opts.traceId ?? null, taskCode: opts.taskCode, userId: opts.userId, promptVersionId: opts.promptVersionId, modelAlias: 'cache', modelId: 'cache', provider: 'cache', status: 'succeeded', errorCode: null, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: latency, cacheHit: true, fallbackUsed: false, repaired: false, startedAt: new Date(now.getTime() - latency), finishedAt: now });
    return id;
  }

  /** Đánh dấu refused (guardrail) – không gọi model, không trừ credit */
  async recordRefused(taskCode: AiTaskCode, userId: string | null, reason: string, inputRef?: Record<string, unknown>): Promise<string> {
    const [row] = await this.dbs.db
      .insert(aiAiTasks)
      .values({ userId, taskCode, status: 'refused', inputRef: inputRef ?? null, error: reason, errorCode: 'refused', creditsCharged: 0, finishedAt: new Date(this.clock.now()) })
      .returning({ id: aiAiTasks.id });
    return row!.id;
  }

  /** Chủ sở hữu tác vụ (cho POST /ai/feedback) – null nếu không tồn tại */
  async taskOwner(aiTaskId: string): Promise<{ userId: string | null; taskCode: string; inputRef: Record<string, unknown> | null; promptVersionId: string | null } | null> {
    const [row] = await this.dbs.db.select({ userId: aiAiTasks.userId, taskCode: aiAiTasks.taskCode, inputRef: aiAiTasks.inputRef, promptVersionId: aiAiTasks.promptVersionId }).from(aiAiTasks).where(eq(aiAiTasks.id, aiTaskId)).limit(1);
    return row ? { userId: row.userId ?? null, taskCode: row.taskCode, inputRef: (row.inputRef as Record<string, unknown> | null) ?? null, promptVersionId: row.promptVersionId ?? null } : null;
  }

  // ------------------------------------------------------------------ nội bộ
  private callOpts(task: ResolvedTask, model: ResolvedModel, messages: ChatMessage[], input: RunTaskInput) {
    const params = task.route.params as { temperature?: number; top_p?: number; max_tokens?: number; json_mode?: 'json' | 'none' };
    return {
      model,
      messages,
      temperature: params.temperature ?? task.modelPolicy.temperature,
      topP: params.top_p ?? task.modelPolicy.top_p,
      maxTokens: params.max_tokens ?? task.modelPolicy.max_tokens,
      timeoutMs: task.route.timeoutMs,
      outputSchema: task.outputSchema,
      jsonMode: params.json_mode ?? 'json',
      taskCode: task.taskCode,
      signal: input.signal,
    };
  }

  /** Chi phí USD theo bảng giá của route (params.pricing) → mặc định trong @allingo/schemas */
  private cost(task: ResolvedTask, model: ResolvedModel, r: ProviderResult): number | null {
    if (model.provider === 'mock') return 0;
    return costUsd(priceFor(model.alias, (task.route.params as { pricing?: Record<string, unknown> }).pricing ?? null), r.tokensIn, r.tokensOut) ?? r.costUsd;
  }

  private redact(data: unknown): unknown {
    return this.env.AI_TRACE_CONTENT ? data : { _redacted: true, keys: data && typeof data === 'object' ? Object.keys(data) : [] };
  }

  private async openTask(task: ResolvedTask, input: RunTaskInput, messages: ChatMessage[]): Promise<string> {
    const inputHash = createHash('sha256').update(messages.map((m) => m.content).join('\n')).digest('hex').slice(0, 32);
    const [row] = await this.dbs.db
      .insert(aiAiTasks)
      .values({ userId: input.userId, taskCode: task.taskCode, promptVersionId: task.promptVersionId, status: 'running', inputRef: input.inputRef ?? null, inputHash, traceId: input.traceId ?? null, creditsCharged: 0 })
      .returning({ id: aiAiTasks.id });
    return row!.id;
  }

  /** Thành công: trừ credit + cập nhật ai_tasks + persist nghiệp vụ + outbox trong MỘT transaction */
  private async finalize<T>(task: ResolvedTask, input: RunTaskInput, aiTaskId: string, outcome: Extract<Outcome, { ok: true }>, started: number, charge: number, messages: ChatMessage[], span: Span, persist?: Persist<T>): Promise<{ latency: number; creditsCharged: number }> {
    const latency = Math.max(0, this.clock.now() - started);
    let creditsCharged = 0;
    try {
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
            output: this.redact(outcome.data),
            tokensIn: outcome.result.tokensIn,
            tokensOut: outcome.result.tokensOut,
            costUsd: outcome.costUsd !== null ? String(outcome.costUsd) : null,
            creditsCharged,
            latencyMs: latency,
            finishedAt: new Date(this.clock.now()),
            fallbackUsed: outcome.fallbackUsed,
            cacheHit: false,
            errorCode: null,
            error: outcome.repaired ? 'repaired' : null,
          })
          .where(eq(aiAiTasks.id, aiTaskId));
        if (persist) await persist(tx, { data: outcome.data as T, aiTaskId, promptVersionId: task.promptVersionId });
        await this.outbox.write(tx, { aggregateType: 'ai_task', aggregateId: aiTaskId, eventType: DOMAIN_EVENTS.AI_TASK_COMPLETED, payload: { ai_task_id: aiTaskId, user_id: input.userId, task_code: input.taskCode, status: 'succeeded', latency_ms: latency } });
      });
    } catch (err) {
      // Lưu nghiệp vụ thất bại → rollback cả credit; tác vụ ghi failed để không kẹt 'running'
      await this.failTask(task, input, aiTaskId, { ok: false, error: `persist failed: ${(err as Error).message}`, reason: 'provider_error', model: outcome.model, fallbackUsed: outcome.fallbackUsed }, started, span, 'persist_failed');
      throw err;
    }
    this.outbox.emitLocal(DOMAIN_EVENTS.AI_TASK_COMPLETED, { ai_task_id: aiTaskId, user_id: input.userId, task_code: input.taskCode, status: 'succeeded' });
    this.telemetry.record(
      { aiTaskId, traceId: input.traceId ?? null, taskCode: task.taskCode, userId: input.userId, promptVersionId: task.promptVersionId, modelAlias: outcome.model.alias, modelId: outcome.model.modelId, provider: outcome.model.provider, status: 'succeeded', errorCode: null, tokensIn: outcome.result.tokensIn, tokensOut: outcome.result.tokensOut, costUsd: outcome.costUsd, latencyMs: latency, cacheHit: false, fallbackUsed: outcome.fallbackUsed, repaired: outcome.repaired, startedAt: new Date(started), finishedAt: new Date(this.clock.now()), input: messages, output: outcome.data },
      span,
    );
    return { latency, creditsCharged };
  }

  private async failTask(task: ResolvedTask, input: RunTaskInput, aiTaskId: string, outcome: Extract<Outcome, { ok: false }>, started: number, span: Span, errorCodeOverride?: string): Promise<void> {
    const latency = Math.max(0, this.clock.now() - started);
    const status = outcome.reason === 'timeout' ? 'timeout' : 'failed';
    const errorCode = errorCodeOverride ?? outcome.reason;
    await this.dbs.db
      .update(aiAiTasks)
      .set({ status, error: outcome.error.slice(0, 500), errorCode, latencyMs: latency, finishedAt: new Date(this.clock.now()), modelUsed: outcome.model?.modelId ?? null, provider: outcome.model?.provider ?? null, fallbackUsed: outcome.fallbackUsed })
      .where(eq(aiAiTasks.id, aiTaskId));
    this.outbox.emitLocal(DOMAIN_EVENTS.AI_TASK_COMPLETED, { ai_task_id: aiTaskId, user_id: input.userId, task_code: task.taskCode, status });
    this.telemetry.record(
      { aiTaskId, traceId: input.traceId ?? null, taskCode: task.taskCode, userId: input.userId, promptVersionId: task.promptVersionId, modelAlias: outcome.model?.alias ?? null, modelId: outcome.model?.modelId ?? null, provider: outcome.model?.provider ?? null, status, errorCode, tokensIn: null, tokensOut: null, costUsd: null, latencyMs: latency, cacheHit: false, fallbackUsed: outcome.fallbackUsed, repaired: false, startedAt: new Date(started), finishedAt: new Date(this.clock.now()) },
      span,
    );
  }

  /**
   * Thử lần lượt các model: gọi (retry lỗi tạm thời) → validate → (sai) repair 1 lần cùng model → (vẫn sai/lỗi) model kế tiếp.
   * `fallbackUsed` = model trả lời KHÔNG phải primary của route (kể cả khi primary bị bỏ qua vì thiếu khoá/breaker mở).
   */
  private async callWithFallback(
    task: ResolvedTask,
    messages: ChatMessage[],
    input: RunTaskInput,
    aiTaskId: string,
    opts: { repairFrom?: { text: string; issues: Array<{ path: string; message: string }>; result: ProviderResult }; startAt?: number; firstError?: unknown } = {},
  ): Promise<Outcome> {
    const candidates = this.router.candidates(task);
    if (candidates.length === 0) return { ok: false, error: 'no model available (providers not configured or circuit open)', reason: 'not_configured', model: null, fallbackUsed: false };
    let lastError = opts.firstError ? (opts.firstError as Error).message ?? 'provider error' : 'no candidates';
    let reason: FailReason = opts.firstError ? (errorCodeOf(opts.firstError) === 'timeout' ? 'timeout' : 'provider_error') : 'provider_error';
    let lastModel: ResolvedModel | null = candidates[0]?.model ?? null;
    const startAt = opts.startAt ?? 0;
    for (let i = startAt; i < candidates.length; i++) {
      const cand = candidates[i]!;
      const { model } = cand;
      lastModel = model;
      const fallbackUsed = !cand.isPrimary;
      let first: { text: string; issues: Array<{ path: string; message: string }>; result: ProviderResult | null } | null = opts.repairFrom && i === startAt ? opts.repairFrom : null;
      if (!first) {
        const r = await this.safeGenerate(cand, task, messages, input);
        if (!r.ok) {
          lastError = r.error;
          reason = r.code === 'timeout' ? 'timeout' : 'provider_error';
          continue;
        }
        const v = validateOutput(input.taskCode, r.result.text);
        if (v.ok) return { ok: true, data: v.data, result: r.result, model, repaired: false, fallbackUsed, costUsd: this.cost(task, model, r.result) };
        first = { text: r.result.text, issues: v.issues ?? [], result: r.result };
      }
      // Repair 1 lần cùng model
      const repairMessages: ChatMessage[] = [...messages, { role: 'assistant', content: first.text.slice(0, 4000) }, { role: 'user', content: repairPrompt(first.issues, first.text) }];
      const r2 = await this.safeGenerate(cand, task, repairMessages, input);
      if (!r2.ok) {
        lastError = r2.error;
        reason = r2.code === 'timeout' ? 'timeout' : 'provider_error';
        continue;
      }
      const v2 = validateOutput(input.taskCode, r2.result.text);
      const merged: ProviderResult = { ...r2.result, tokensIn: (r2.result.tokensIn ?? 0) + (first.result?.tokensIn ?? 0), tokensOut: (r2.result.tokensOut ?? 0) + (first.result?.tokensOut ?? 0) };
      if (v2.ok) return { ok: true, data: v2.data, result: merged, model, repaired: true, fallbackUsed, costUsd: this.cost(task, model, merged) };
      lastError = `invalid output after repair: ${v2.issues?.map((x) => `${x.path}: ${x.message}`).join('; ')}`;
      reason = 'invalid_output';
    }
    this.logger.error({ task: task.taskCode, ai_task_id: aiTaskId, error: lastError.slice(0, 300), reason }, 'ai task failed on all models');
    return { ok: false, error: lastError, reason, model: lastModel, fallbackUsed: !!lastModel && lastModel.alias !== task.route.primaryModel };
  }

  /** Một lời gọi provider có retry jitter (chỉ lỗi tạm thời); mỗi lần lỗi tính vào breaker của provider */
  private async safeGenerate(cand: RouteCandidate, task: ResolvedTask, messages: ChatMessage[], input: RunTaskInput): Promise<{ ok: true; result: ProviderResult } | { ok: false; error: string; code: string }> {
    const { model, adapter } = cand;
    const params = task.route.params as { max_retries?: number; retry_base_ms?: number };
    try {
      const result = await withRetry(
        async () => {
          this.router.begin(model.provider);
          try {
            const r = await adapter.generate(this.callOpts(task, model, messages, input));
            this.router.recordSuccess(model.provider);
            return r;
          } catch (err) {
            this.router.recordFailure(model.provider);
            throw err;
          }
        },
        {
          retries: model.provider === 'mock' ? 0 : (params.max_retries ?? this.env.AI_RETRY_MAX),
          baseMs: params.retry_base_ms ?? this.env.AI_RETRY_BASE_MS,
          onRetry: ({ attempt, delayMs, error }) => {
            AI_METRICS.retries.inc({ provider: model.provider });
            this.logger.warn({ model: model.alias, attempt, delay_ms: delayMs, err: (error as Error).message?.slice(0, 200) }, 'transient provider error, retrying with jitter');
          },
        },
      );
      return { ok: true, result };
    } catch (err) {
      const msg = (err as Error).message ?? 'provider error';
      const code = errorCodeOf(err);
      this.logger.warn({ model: model.alias, err: msg.slice(0, 300), code }, 'provider call failed');
      return { ok: false, error: msg, code };
    }
  }

  // ------------------------------------------------------------------ báo cáo
  /**
   * Báo cáo chi phí theo ngày (giờ VN) × task × model (GET /admin/reports/ai-costs). Tổng chi phí khớp Langfuse vì cùng
   * nguồn `cost_usd` (gửi `usage.totalCost` = cost_usd của ai_tasks).
   */
  async costReport(from: Date, to: Date) {
    const rows = await this.dbs.db.execute<{ day: string; task_code: string; model: string; tasks: number; succeeded: number; failed: number; cache_hits: number; fallbacks: number; credits: number; cost_usd: string; tokens_in: number; tokens_out: number; avg_latency_ms: number; p95_latency_ms: number | null }>(sql`
      select to_char((created_at at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') as day,
             task_code,
             coalesce(model_used, 'none') as model,
             count(*)::int as tasks,
             count(*) filter (where status = 'succeeded')::int as succeeded,
             count(*) filter (where status in ('failed','timeout'))::int as failed,
             count(*) filter (where cache_hit)::int as cache_hits,
             count(*) filter (where fallback_used and status = 'succeeded')::int as fallbacks,
             coalesce(sum(credits_charged), 0)::int as credits,
             coalesce(sum(cost_usd), 0)::text as cost_usd,
             coalesce(sum(tokens_in), 0)::int as tokens_in,
             coalesce(sum(tokens_out), 0)::int as tokens_out,
             coalesce(round(avg(latency_ms)), 0)::int as avg_latency_ms,
             (percentile_cont(0.95) within group (order by latency_ms))::int as p95_latency_ms
        from ai.ai_tasks
       where created_at >= ${from.toISOString()}::timestamptz and created_at <= ${to.toISOString()}::timestamptz and status <> 'running'
       group by 1, 2, 3
       order by 1, 2, 3`);
    const items = [...rows].map((r) => ({ ...r, cost_usd: Number(r.cost_usd) }));
    const sum = (k: 'tasks' | 'succeeded' | 'failed' | 'cache_hits' | 'fallbacks' | 'credits' | 'tokens_in' | 'tokens_out' | 'cost_usd', list = items) => Math.round(list.reduce((s, r) => s + Number(r[k]), 0) * 1e6) / 1e6;
    const group = (key: 'day' | 'task_code' | 'model') => {
      const m = new Map<string, typeof items>();
      for (const r of items) m.set(r[key], [...(m.get(r[key]) ?? []), r]);
      return Object.fromEntries([...m.entries()].map(([k, list]) => [k, { tasks: sum('tasks', list), succeeded: sum('succeeded', list), failed: sum('failed', list), cache_hits: sum('cache_hits', list), fallbacks: sum('fallbacks', list), credits: sum('credits', list), cost_usd: sum('cost_usd', list), tokens_in: sum('tokens_in', list), tokens_out: sum('tokens_out', list) }]));
    };
    // Tương thích Sprint 0: by_task với count/credits/…; explanation_cache_hits = tổng hit_count bền của cache
    const byTask = Object.fromEntries(
      Object.entries(group('task_code')).map(([k, v]) => {
        const list = items.filter((r) => r.task_code === k);
        const lat = list.reduce((s, r) => s + r.avg_latency_ms * r.tasks, 0) / Math.max(1, v.tasks);
        return [k, { count: v.succeeded, credits: v.credits, cost_usd: v.cost_usd, tokens_in: v.tokens_in, tokens_out: v.tokens_out, cache_hits: v.cache_hits, failed: v.failed, fallbacks: v.fallbacks, avg_latency_ms: Math.round(lat) }];
      }),
    );
    const explanationCacheHits = await this.explanationCache.totalHits();
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      total_tasks: sum('tasks'),
      totals: { tasks: sum('tasks'), succeeded: sum('succeeded'), failed: sum('failed'), cache_hits: sum('cache_hits'), fallbacks: sum('fallbacks'), credits: sum('credits'), cost_usd: sum('cost_usd'), tokens_in: sum('tokens_in'), tokens_out: sum('tokens_out') },
      explanation_cache_hits: explanationCacheHits,
      by_task: byTask,
      by_day: group('day'),
      by_model: group('model'),
      rows: items,
      breakers: this.router.breakerSnapshot(),
    };
  }

  /** Số tác vụ thành công của người dùng trong khoảng (dùng cho test/analytics nội bộ) */
  async countTasks(taskCode: AiTaskCode, from: Date, to: Date): Promise<number> {
    const [r] = await this.dbs.db.select({ n: sql<number>`count(*)::int` }).from(aiAiTasks).where(and(eq(aiAiTasks.taskCode, taskCode), gte(aiAiTasks.createdAt, from), lte(aiAiTasks.createdAt, to)));
    return r?.n ?? 0;
  }
}
