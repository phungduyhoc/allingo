import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { QueueName } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../cache/redis.module.js';
import { getLogger } from '../telemetry/logger.js';
import { QueueService, jobIdFor } from './queue.module.js';

export interface JobContext {
  jobId: string;
  businessId: string;
  /** Ghi tiến độ/trạng thái để client polling (GET …/{jobId}) */
  status(patch: Partial<JobStatus>): Promise<void>;
}
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

export interface JobStatus {
  job: string;
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: Record<string, unknown> | null;
  result?: unknown;
  error?: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const STATUS_TTL_SECONDS = 7 * 24 * 3600;
const MEMORY_STATUS_MAX = 500;

/**
 * Job nền dùng chung (CLAUDE.md §5.5): module nghiệp vụ `register(queue, name, handler)`; `dispatch` đưa job vào BullMQ
 * (jobId = `<job>__<business_id>` → idempotent) hoặc chạy trong process khi `JOBS_INLINE=true` / Redis không sẵn sàng
 * (dev không chạy worker – A59). Worker (src/worker) lấy handler qua `handlersFor(queue)`.
 * Trạng thái job (để polling) lưu Redis 7 ngày, dự phòng bộ nhớ khi Redis mất.
 */
@Injectable()
export class JobsService {
  private readonly logger = getLogger({ component: 'jobs' });
  private readonly handlers = new Map<string, { queue: QueueName; handler: JobHandler }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly memoryStatus = new Map<string, JobStatus>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly queues: QueueService,
    private readonly redis: RedisService,
  ) {}

  register(queue: QueueName, name: string, handler: JobHandler): void {
    this.handlers.set(name, { queue, handler });
  }

  /** Bộ xử lý BullMQ cho worker: name → (job) => handler(payload) */
  handlersFor(queue: QueueName): Record<string, (job: Job) => Promise<unknown>> {
    const out: Record<string, (job: Job) => Promise<unknown>> = {};
    for (const [name, h] of this.handlers) {
      if (h.queue !== queue) continue;
      out[name] = (job: Job) => {
        const data = (job.data ?? {}) as Record<string, unknown>;
        const businessId = typeof data._business_id === 'string' ? data._business_id : String(job.id ?? '');
        return this.execute(name, h.handler, data, businessId, String(job.id ?? jobIdFor(name, businessId)));
      };
    }
    return out;
  }

  /**
   * Đưa job vào hàng đợi hoặc chạy inline. Trả `done` (promise kết quả) khi chạy inline – test/CLI có thể chờ.
   * Cùng businessId đang chạy inline → trả promise đang chạy (idempotent trong process).
   */
  async dispatch(queue: QueueName, name: string, businessId: string, payload: Record<string, unknown>): Promise<{ jobId: string; mode: 'queued' | 'inline'; done?: Promise<unknown> }> {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler registered for job ${name}`);
    const jobId = jobIdFor(name, businessId);
    const existing = await this.getStatus(name, businessId);
    if (!existing) await this.writeStatus({ job: name, id: businessId, status: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const data = { ...payload, _business_id: businessId };
    if (!this.env.JOBS_INLINE && this.redis.isHealthy) {
      const ok = await this.queues.enqueue(queue, name, businessId, data, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } });
      if (ok) return { jobId, mode: 'queued' };
      this.logger.warn({ job: name }, 'enqueue failed → inline execution (degraded)');
    }
    const running = this.inflight.get(jobId);
    if (running) return { jobId, mode: 'inline', done: running };
    const done = this.execute(name, h.handler, data, businessId, jobId).finally(() => this.inflight.delete(jobId));
    // Không để unhandled rejection khi caller không chờ
    done.catch(() => undefined);
    this.inflight.set(jobId, done);
    return { jobId, mode: 'inline', done };
  }

  private async execute(name: string, handler: JobHandler, payload: Record<string, unknown>, businessId: string, jobId: string): Promise<unknown> {
    const ctx: JobContext = {
      jobId,
      businessId,
      status: (patch) => this.patchStatus(name, businessId, patch),
    };
    await this.patchStatus(name, businessId, { status: 'running', error: null });
    try {
      const result = await handler(payload, ctx);
      await this.patchStatus(name, businessId, { status: 'completed', result: result ?? null });
      return result;
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'job failed';
      this.logger.error({ job: name, job_id: jobId, err: message }, 'job failed');
      await this.patchStatus(name, businessId, { status: 'failed', error: message });
      throw err;
    }
  }

  // ------------------------------------------------------------------ trạng thái
  private skey(name: string, id: string) {
    return `jobstatus:${name}:${id}`;
  }

  async getStatus(name: string, id: string): Promise<JobStatus | null> {
    const raw = await this.redis.safe((r) => r.get(this.skey(name, id)));
    if (raw) {
      try {
        return JSON.parse(raw) as JobStatus;
      } catch {
        return null;
      }
    }
    return this.memoryStatus.get(this.skey(name, id)) ?? null;
  }

  async patchStatus(name: string, id: string, patch: Partial<JobStatus>): Promise<void> {
    const now = new Date().toISOString();
    const cur = (await this.getStatus(name, id)) ?? { job: name, id, status: 'queued' as const, created_at: now, updated_at: now };
    await this.writeStatus({ ...cur, ...patch, job: name, id, updated_at: now });
  }

  private async writeStatus(s: JobStatus): Promise<void> {
    const key = this.skey(s.job, s.id);
    const ok = await this.redis.safe((r) => r.set(key, JSON.stringify(s), 'EX', STATUS_TTL_SECONDS));
    if (ok === null) {
      this.memoryStatus.set(key, s);
      if (this.memoryStatus.size > MEMORY_STATUS_MAX) this.memoryStatus.delete(this.memoryStatus.keys().next().value!);
    } else this.memoryStatus.delete(key);
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
