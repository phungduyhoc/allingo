import { createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { ENV, type Env } from '../../../config/env.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AI_METRICS } from '../../../shared/telemetry/metrics.js';
import type { ChatMessage } from './types.js';

/** Bản ghi quan sát một tác vụ AI (KHÔNG chứa nội dung trừ khi AI_TRACE_CONTENT=true) */
export interface AiTaskTrace {
  aiTaskId: string;
  traceId: string | null;
  taskCode: string;
  userId: string | null;
  promptVersionId: string | null;
  modelAlias: string | null;
  modelId: string | null;
  provider: string | null;
  status: 'succeeded' | 'failed' | 'timeout' | 'refused';
  errorCode: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  latencyMs: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
  repaired: boolean;
  startedAt: Date;
  finishedAt: Date;
  input?: ChatMessage[];
  output?: unknown;
}

export interface LangfuseEvent {
  id: string;
  type: 'trace-create' | 'generation-create';
  timestamp: string;
  body: Record<string, unknown>;
}

/** Client Langfuse tối thiểu: POST /api/public/ingestion (batch). Test thay bằng client giả. */
export interface LangfuseClient {
  ingest(batch: LangfuseEvent[]): Promise<void>;
}

export class HttpLangfuseClient implements LangfuseClient {
  constructor(
    private readonly baseUrl: string,
    private readonly publicKey: string,
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async ingest(batch: LangfuseEvent[]): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64')}` },
      body: JSON.stringify({ batch }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 207) throw new Error(`langfuse ingestion HTTP ${res.status}`);
  }
}

/**
 * Quan sát AI Gateway (S5, ADR-0015/0026):
 * - OpenTelemetry span `ai.task` (thuộc tính task/model/prompt_version/tokens/cost/cache_hit/fallback_used/status – không nội dung);
 * - Prometheus: ai_task_duration_seconds, ai_task_cost_usd_total, ai_task_failures_total{task,model}…;
 * - Langfuse (bật khi có LANGFUSE_PUBLIC_KEY/SECRET_KEY): trace + generation, `userId` = HMAC-SHA256(user_id) – không lộ id thật,
 *   input/output chỉ gửi khi AI_TRACE_CONTENT=true. Gửi theo lô, không chặn request; lỗi chỉ ghi log cảnh báo.
 */
@Injectable()
export class AiTelemetry implements OnModuleDestroy {
  private readonly logger = getLogger({ component: 'ai.telemetry' });
  private readonly tracer = trace.getTracer('allingo.ai-gateway');
  private client: LangfuseClient | null;
  private buffer: LangfuseEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY ? new HttpLangfuseClient(env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com', env.LANGFUSE_PUBLIC_KEY, env.LANGFUSE_SECRET_KEY) : null;
  }

  get langfuseEnabled(): boolean {
    return this.client !== null;
  }

  /** Test: thay client (null = tắt) */
  setLangfuseClient(client: LangfuseClient | null): void {
    this.client = client;
  }

  /** Băm user_id ổn định (HMAC với AUTH_SECRET) – dùng cho trace/analytics ngoài hệ thống (CLAUDE.md §9) */
  hashUserId(userId: string | null): string | null {
    if (!userId) return null;
    return `u_${createHmac('sha256', this.env.AUTH_SECRET).update(userId).digest('hex').slice(0, 24)}`;
  }

  startSpan(attrs: { taskCode: string; promptVersionId: string; aiTaskId: string; traceId?: string | null }): Span {
    return this.tracer.startSpan('ai.task', {
      attributes: { 'ai.task_code': attrs.taskCode, 'ai.prompt_version_id': attrs.promptVersionId, 'ai.task_id': attrs.aiTaskId, ...(attrs.traceId ? { 'allingo.trace_id': attrs.traceId } : {}) },
    });
  }

  /** Kết thúc span + metrics + Langfuse cho một tác vụ */
  record(t: AiTaskTrace, span?: Span): void {
    const model = t.modelAlias ?? (t.cacheHit ? 'cache' : 'none');
    try {
      AI_METRICS.duration.observe({ task: t.taskCode, model, status: t.status }, t.latencyMs / 1000);
      if (t.costUsd) AI_METRICS.cost.inc({ task: t.taskCode, model }, t.costUsd);
      if (t.status === 'failed' || t.status === 'timeout') AI_METRICS.failures.inc({ task: t.taskCode, model });
      if (t.tokensIn) AI_METRICS.tokens.inc({ task: t.taskCode, model, direction: 'in' }, t.tokensIn);
      if (t.tokensOut) AI_METRICS.tokens.inc({ task: t.taskCode, model, direction: 'out' }, t.tokensOut);
      if (t.cacheHit) AI_METRICS.cacheHits.inc({ task: t.taskCode });
      if (t.fallbackUsed && t.status === 'succeeded') AI_METRICS.fallbacks.inc({ task: t.taskCode, model });
    } catch {
      /* metrics không được làm hỏng nghiệp vụ */
    }
    if (span) {
      span.setAttributes({
        'ai.model': model,
        'ai.model_id': t.modelId ?? '',
        'ai.provider': t.provider ?? '',
        'ai.status': t.status,
        'ai.tokens_in': t.tokensIn ?? 0,
        'ai.tokens_out': t.tokensOut ?? 0,
        'ai.cost_usd': t.costUsd ?? 0,
        'ai.latency_ms': t.latencyMs,
        'ai.cache_hit': t.cacheHit,
        'ai.fallback_used': t.fallbackUsed,
        'ai.repaired': t.repaired,
        ...(t.errorCode ? { 'ai.error_code': t.errorCode } : {}),
      });
      span.setStatus(t.status === 'succeeded' ? { code: SpanStatusCode.OK } : { code: SpanStatusCode.ERROR, message: t.errorCode ?? t.status });
      span.end(t.finishedAt);
    }
    if (this.client) this.enqueue(t);
  }

  private enqueue(t: AiTaskTrace): void {
    const traceId = t.traceId ?? t.aiTaskId;
    const content = this.env.AI_TRACE_CONTENT;
    const metadata = { prompt_version_id: t.promptVersionId, provider: t.provider, cache_hit: t.cacheHit, fallback_used: t.fallbackUsed, repaired: t.repaired, status: t.status, error_code: t.errorCode, ai_task_id: t.aiTaskId };
    const ts = t.finishedAt.toISOString();
    this.buffer.push(
      { id: randomUUID(), type: 'trace-create', timestamp: ts, body: { id: traceId, name: t.taskCode, userId: this.hashUserId(t.userId), metadata: { env: this.env.APP_ENV }, tags: [t.taskCode], ...(content && t.output !== undefined ? { output: t.output } : {}) } },
      {
        id: randomUUID(),
        type: 'generation-create',
        timestamp: ts,
        body: {
          id: t.aiTaskId,
          traceId,
          name: t.taskCode,
          model: t.modelId ?? (t.cacheHit ? 'cache' : null),
          startTime: t.startedAt.toISOString(),
          endTime: ts,
          level: t.status === 'succeeded' ? 'DEFAULT' : 'ERROR',
          statusMessage: t.errorCode ?? undefined,
          usage: { input: t.tokensIn ?? 0, output: t.tokensOut ?? 0, unit: 'TOKENS', totalCost: t.costUsd ?? 0 },
          metadata,
          ...(content ? { input: t.input, output: t.output } : {}),
        },
      },
    );
    if (this.buffer.length >= 40) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.env.LANGFUSE_FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  /** Đẩy lô sự kiện đang chờ (gọi khi tắt app; test gọi trực tiếp) */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) await this.flushing;
    if (!this.client || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    this.flushing = this.client
      .ingest(batch)
      .catch((err: Error) => this.logger.warn({ err: err.message, events: batch.length }, 'langfuse ingestion failed (dropped)'))
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
