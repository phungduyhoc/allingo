import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import type { QueueName } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../cache/redis.module.js';
import { getLogger } from '../telemetry/logger.js';

/**
 * jobId idempotent: `<job_name>__<business_id>`. BullMQ ≥ 5 từ chối custom id chứa ':' (dành cho khoá Redis nội bộ),
 * nên không dùng dạng `grade.speaking:<id>`.
 */
export function jobIdFor(jobName: string, businessId: string): string {
  return `${jobName}__${businessId}`.replaceAll(':', '_');
}

/**
 * Hàng đợi BullMQ (CLAUDE.md §5.5): tác vụ > 2 giây là job, jobId = id nghiệp vụ để idempotent.
 * Tên job theo `aggregate.action` (vd grade.speaking, attempt.expire).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly logger = getLogger({ component: 'queue' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  get(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.redis.duplicateForQueue(),
        prefix: this.env.QUEUE_PREFIX,
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  /** Đưa job vào hàng đợi; jobId = id nghiệp vụ (idempotent). Trả false nếu hàng đợi không sẵn sàng. */
  async enqueue(queue: QueueName, jobName: string, businessId: string, payload: Record<string, unknown>, opts: JobsOptions = {}): Promise<boolean> {
    try {
      await this.get(queue).add(jobName, payload, { jobId: jobIdFor(jobName, businessId), ...opts });
      return true;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, queue, jobName }, 'enqueue failed');
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
