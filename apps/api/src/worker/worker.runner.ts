import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { schema, ensureMonthPartitions  } from '@allingo/db';
import type { QueueName } from '@allingo/schemas';
import { ENV, type Env } from '../config/env.js';
import { DbService } from '../shared/db/db.module.js';
import { RedisService } from '../shared/cache/redis.module.js';
import { OutboxService } from '../shared/events/outbox.service.js';
import { getLogger } from '../shared/telemetry/logger.js';
import { QuotaService } from '../modules/billing/index.js';
import { AttemptsService } from '../modules/test-engine/index.js';
import { DeletionService } from '../modules/iam/index.js';

type Handler = (job: Job) => Promise<unknown>;

/**
 * Vòng chạy worker: (1) outbox relay mỗi 2 giây; (2) attempt.expire mỗi phút; (3) quota.flush 00:05 giờ VN;
 * (4) partition.ensure hằng ngày; (5) processors BullMQ theo hàng đợi (grading/content/media/notify/analytics/maintenance).
 * Job thất bại sau retry → ops.jobs_deadletter.
 */
@Injectable()
export class WorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = getLogger({ component: 'worker' });
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly workers: Worker[] = [];
  private relaying = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly quotas: QuotaService,
    private readonly attempts: AttemptsService,
    private readonly deletion: DeletionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.timers.push(setInterval(() => void this.relay(), 2000));
    this.timers.push(setInterval(() => void this.expire(), 60_000));
    this.timers.push(setInterval(() => void this.nightly(), 60_000));
    this.timers.push(setInterval(() => void this.purge(), this.env.PURGE_SCAN_INTERVAL_SECONDS * 1000));
    await ensureMonthPartitions(this.dbs.db, 2).catch((err: Error) => this.logger.warn({ err: err.message }, 'partition ensure failed'));
    const handlers: Record<QueueName, Record<string, Handler>> = {
      maintenance: {
        'quota.flush': async () => ({ flushed: await this.quotas.flushToDb() }),
        'partition.ensure': async () => ({ created: await ensureMonthPartitions(this.dbs.db, 2) }),
        'attempt.expire': async () => ({ expired: await this.attempts.expireOverdue() }),
        'iam.purge': async () => ({ purged: await this.deletion.purgeDue() }),
      },
      grading: {},
      content: {},
      media: {},
      notify: {},
      analytics: {},
    };
    if (this.redis.isHealthy || this.redis.client.status === 'connecting') {
      for (const [queue, map] of Object.entries(handlers) as Array<[QueueName, Record<string, Handler>]>) {
        const w = new Worker(
          queue,
          async (job) => {
            const h = map[job.name];
            if (!h) {
              this.logger.warn({ queue, job: job.name }, 'no handler');
              return null;
            }
            return h(job);
          },
          { connection: this.redis.duplicateForQueue(), prefix: this.env.QUEUE_PREFIX, concurrency: queue === 'grading' ? 4 : 2 },
        );
        w.on('failed', (job, err) => void this.deadLetter(queue, job, err));
        w.on('error', (err) => this.logger.warn({ queue, err: err.message }, 'worker error'));
        this.workers.push(w);
      }
    } else {
      this.logger.warn('redis unavailable: BullMQ processors disabled, timers still run');
    }
    this.logger.info('worker started');
  }

  /** Xoá tài khoản đến hạn (iam.deletion_requests, CLAUDE.md §9) */
  private async purge(): Promise<void> {
    try {
      const n = await this.deletion.purgeDue();
      if (n) this.logger.info({ purged: n }, 'iam.purge');
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'iam.purge failed');
    }
  }

  private async relay(): Promise<void> {
    if (this.relaying) return;
    this.relaying = true;
    try {
      const n = await this.outbox.relayBatch(200);
      if (n) this.logger.debug({ n }, 'outbox relayed');
    } catch (err) {
      this.logger.error({ err }, 'outbox relay failed');
    } finally {
      this.relaying = false;
    }
  }

  private async expire(): Promise<void> {
    try {
      const n = await this.attempts.expireOverdue();
      if (n) this.logger.info({ n }, 'attempts auto-submitted');
    } catch (err) {
      this.logger.error({ err }, 'attempt expire failed');
    }
  }

  private lastNightly = '';
  private async nightly(): Promise<void> {
    const now = new Date();
    const vn = new Date(now.getTime() + 7 * 3600_000);
    const key = vn.toISOString().slice(0, 10);
    if (vn.getUTCHours() === 0 && vn.getUTCMinutes() >= 5 && this.lastNightly !== key) {
      this.lastNightly = key;
      try {
        const flushed = await this.quotas.flushToDb();
        const parts = await ensureMonthPartitions(this.dbs.db, 2);
        this.logger.info({ flushed, parts: parts.length }, 'nightly maintenance done');
      } catch (err) {
        this.logger.error({ err }, 'nightly maintenance failed');
      }
    }
  }

  private async deadLetter(queue: string, job: Job | undefined, err: Error): Promise<void> {
    if (!job || (job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return;
    try {
      await this.dbs.db.insert(schema.opsJobsDeadletter).values({ queue, jobId: String(job.id), payload: job.data as Record<string, unknown>, error: err.message.slice(0, 1000), attempts: job.attemptsMade });
      this.logger.error({ queue, job: job.name, id: job.id }, 'job moved to dead-letter');
    } catch (e) {
      this.logger.error({ err: e }, 'dead-letter insert failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
  }
}
