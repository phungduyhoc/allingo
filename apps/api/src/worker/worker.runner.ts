import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { schema, ensureMonthPartitions, partitionCoverage } from '@allingo/db';
import type { QueueName } from '@allingo/schemas';
import { ENV, type Env } from '../config/env.js';
import { DbService } from '../shared/db/db.module.js';
import { RedisService } from '../shared/cache/redis.module.js';
import { OutboxService } from '../shared/events/outbox.service.js';
import { JobsService } from '../shared/queue/jobs.service.js';
import { getLogger } from '../shared/telemetry/logger.js';
import { BillingJobsService, QuotaService } from '../modules/billing/index.js';
import { AttemptsService } from '../modules/test-engine/index.js';
import { DeletionService } from '../modules/iam/index.js';
import { MediaProcessorService, mediaJobHandlers } from '../modules/speech/index.js';
import { QueueService } from '../shared/queue/queue.module.js';
import { DB_METRICS, QUEUE_METRICS } from '../shared/telemetry/metrics.js';
import { instrumentJob, startWorkerMetricsServer } from './job-instrumentation.js';
import type http from 'node:http';

/** Hàng đợi ưu tiên thấp – tạm dừng khi grading dồn (backpressure S11: grading > content/media > notify/analytics) */
export const LOW_PRIORITY_QUEUES: readonly QueueName[] = ['notify', 'analytics'];

/** Quyết định backpressure thuần: dừng khi độ sâu grading ≥ ngưỡng, chạy lại khi ≤ ngưỡng/2 (trễ để không dao động) */
export function backpressureDecision(paused: boolean, gradingDepth: number, threshold: number): boolean {
  if (!paused && gradingDepth >= threshold) return true;
  if (paused && gradingDepth <= Math.floor(threshold / 2)) return false;
  return paused;
}

type Handler = (job: Job) => Promise<unknown>;

/**
 * Vòng chạy worker: (1) outbox relay mỗi 2 giây; (2) attempt.expire mỗi phút; (3) quota.flush 00:05 giờ VN;
 * (4) partition.ensure hằng ngày; (5) processors BullMQ theo hàng đợi (grading/content/media/notify/analytics/maintenance);
 * (6) lịch job billing S7 (BillingJobsService: order.expire 1′, payment.reconcile 5′, subscription.expire 10′, credit.* 1 giờ,
 *     billing.reconcile 01:30 giờ VN).
 * Job thất bại sau retry → ops.jobs_deadletter.
 */
@Injectable()
export class WorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = getLogger({ component: 'worker' });
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly workers: Worker[] = [];
  private readonly byQueue = new Map<QueueName, Worker>();
  private relaying = false;
  private lowPriorityPaused = false;
  private metricsServer: http.Server | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly quotas: QuotaService,
    private readonly attempts: AttemptsService,
    private readonly deletion: DeletionService,
    private readonly media: MediaProcessorService,
    private readonly jobs: JobsService,
    private readonly billingJobs: BillingJobsService,
    private readonly queues: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.timers.push(setInterval(() => void this.relay(), 2000));
    this.timers.push(setInterval(() => void this.expire(), 60_000));
    this.timers.push(setInterval(() => void this.nightly(), 60_000));
    this.timers.push(setInterval(() => void this.purge(), this.env.PURGE_SCAN_INTERVAL_SECONDS * 1000));
    // S7: lịch job billing (chu kỳ + khoá Redis chống chạy trùng giữa các replica)
    this.billingJobs.startScheduler('worker');
    await this.ensurePartitions().catch((err: Error) => this.logger.warn({ err: err.message }, 'partition ensure failed'));
    const handlers: Record<QueueName, Record<string, Handler>> = {
      maintenance: {
        'quota.flush': async () => ({ flushed: await this.quotas.flushToDb() }),
        'partition.ensure': async () => ({ created: await ensureMonthPartitions(this.dbs.db, 2) }),
        // S11: tên chuẩn `ops.partition.ensure` – tạo trước 2 tháng + kiểm độ phủ; thiếu → log lỗi (alert PartitionMissing đọc metrics)
        'ops.partition.ensure': async () => this.ensurePartitions(),
        'attempt.expire': async () => ({ expired: await this.attempts.expireOverdue() }),
        'iam.purge': async () => ({ purged: await this.deletion.purgeDue() }),
        // S7: order.expire, payment.reconcile, subscription.expire, credit.grant_monthly, credit.expire, billing.reconcile
        ...this.jobs.handlersFor('maintenance'),
      },
      // Sprint 5: summary.attempt (learning), content.generate / eval.run (catalog, ai-gateway) – đăng ký qua JobsService
      grading: { ...this.jobs.handlersFor('grading') },
      content: { ...this.jobs.handlersFor('content') },
      // media.process: chuẩn hoá audio/ảnh + waveform/thumbnail (ffmpeg trong image worker, ADR-0025)
      media: mediaJobHandlers(this.media),
      notify: { ...this.jobs.handlersFor('notify') },
      analytics: { ...this.jobs.handlersFor('analytics') },
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
            return instrumentJob(queue, job, () => h(job));
          },
          { connection: this.redis.duplicateForQueue(), prefix: this.env.QUEUE_PREFIX, concurrency: queue === 'grading' ? 4 : 2 },
        );
        w.on('failed', (job, err) => void this.deadLetter(queue, job, err));
        w.on('error', (err) => this.logger.warn({ queue, err: err.message }, 'worker error'));
        this.workers.push(w);
        this.byQueue.set(queue, w);
      }
      // S11: backpressure – grading dồn → tạm dừng notify/analytics (5 s/lần)
      this.timers.push(setInterval(() => void this.backpressure(), 5000));
    } else {
      this.logger.warn('redis unavailable: BullMQ processors disabled, timers still run');
    }
    this.metricsServer = startWorkerMetricsServer(this.env.WORKER_METRICS_PORT, this.env.METRICS_TOKEN || this.env.INTERNAL_API_TOKEN);
    this.logger.info('worker started');
  }

  /** S11 – ops.partition.ensure: tạo partition tháng hiện tại + 2 tháng tới, rồi kiểm lại; còn thiếu → log error (alert) */
  async ensurePartitions(): Promise<{ created: string[]; missing: string[] }> {
    const created = await ensureMonthPartitions(this.dbs.db, 2);
    const coverage = await partitionCoverage(this.dbs.db, 2);
    const missing = coverage.flatMap((c) => c.missing.map((m) => `${c.table}@${m}`));
    for (const c of coverage) DB_METRICS.partitionMonthsAhead.set({ table: c.table }, c.monthsAhead);
    if (missing.length) this.logger.error({ missing }, 'partition coverage incomplete after ensure');
    return { created, missing };
  }

  /** Backpressure (S11): đọc độ sâu grading (waiting + prioritized), dừng/chạy lại worker ưu tiên thấp */
  async backpressure(): Promise<void> {
    try {
      const counts = await this.queues.get('grading').getJobCounts('waiting', 'prioritized');
      const depth = (counts.waiting ?? 0) + (counts.prioritized ?? 0);
      const next = backpressureDecision(this.lowPriorityPaused, depth, this.env.QUEUE_BACKPRESSURE_GRADING_DEPTH);
      if (next === this.lowPriorityPaused) return;
      this.lowPriorityPaused = next;
      for (const q of LOW_PRIORITY_QUEUES) {
        const w = this.byQueue.get(q);
        if (!w) continue;
        if (next) await w.pause(true);
        else await w.resume();
        QUEUE_METRICS.workerPaused.set({ queue: q }, next ? 1 : 0);
      }
      this.logger.warn({ grading_depth: depth, paused: next, queues: LOW_PRIORITY_QUEUES }, next ? 'backpressure: low-priority workers paused' : 'backpressure: low-priority workers resumed');
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'backpressure check failed');
    }
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
        const parts = await this.ensurePartitions();
        this.logger.info({ flushed, parts: parts.created.length, missing: parts.missing }, 'nightly maintenance done');
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
    this.metricsServer?.close();
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
  }
}
