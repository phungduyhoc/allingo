import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { partitionCoverage, schema } from '@allingo/db';
import { QUEUES, type QueueName } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import type { AuthUser } from '../../shared/auth/auth.guard.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OUTBOX_DLQ_QUEUE, OutboxService, type OutboxDeliveryResult } from '../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Conflict, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { QueueService } from '../../shared/queue/queue.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { FeatureFlagService } from '../billing/index.js';
import { ContentReportsService } from '../catalog/index.js';
import { SupportService } from '../growth/index.js';

const { opsJobsDeadletter, opsAuditLogs } = schema;
type DeadLetterRow = typeof opsJobsDeadletter.$inferSelect;

/** Tên job của một dead-letter: cột job_name (S12) → tiền tố jobId `<job>__<id>` → media.process (jobId = asset id) */
export function deadLetterJobName(r: Pick<DeadLetterRow, 'jobName' | 'jobId' | 'queue'>): string | null {
  if (r.jobName) return r.jobName;
  const i = r.jobId.indexOf('__');
  if (i > 0) return r.jobId.slice(0, i);
  return r.queue === 'media' ? 'media.process' : null;
}

/**
 * Admin hệ thống (S12): trạng thái hàng đợi/dead-letter/partition/cờ/SLA/outbox, dead-letter mọi hàng đợi + replay, tìm audit log.
 * Replay: xoá job thất bại cũ còn trong BullMQ (cùng jobId) rồi thêm lại; Redis/BullMQ không sẵn → chạy inline qua JobsService.
 * B7/S26: dead-letter `queue = outbox` → OutboxService.replayDeadLetter (giao lại đúng consumer lỗi, inline).
 */
@Injectable()
export class AdminOpsService {
  private readonly logger = getLogger({ component: 'admin.ops' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly jobs: JobsService,
    private readonly flags: FeatureFlagService,
    private readonly reports: ContentReportsService,
    private readonly support: SupportService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async systemStatus() {
    const queues: Array<Record<string, number | string>> = [];
    if (this.redis.isHealthy) {
      for (const name of QUEUES) {
        try {
          const q = this.queues.get(name);
          const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'prioritized');
          const [oldest] = await q.getJobs(['waiting', 'prioritized'], 0, 0, true);
          queues.push({ queue: name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, prioritized: c.prioritized ?? 0, oldest_waiting_sec: oldest?.timestamp ? Math.max(0, Math.round((Date.now() - oldest.timestamp) / 1000)) : 0 });
        } catch (err) {
          this.logger.warn({ queue: name, err: (err as Error).message }, 'queue counts failed');
        }
      }
    }
    const [dl] = (await this.dbs.db.execute(sql`select count(*)::int as total, count(*) filter (where failed_at > now() - interval '24 hours')::int as last_24h, count(*) filter (where replayed_at is null and coalesce(payload->>'resolved_at', '') = '')::int as unreplayed from ops.jobs_deadletter`)) as unknown as Array<{ total: number; last_24h: number; unreplayed: number }>;
    const byQueue = (await this.dbs.db.execute(sql`select queue, count(*)::int as n from ops.jobs_deadletter where replayed_at is null group by queue`)) as unknown as Array<{ queue: string; n: number }>;
    const coverage = await partitionCoverage(this.dbs.db, 2);
    // B7/S26: chờ giao (không tính dead-letter), đang thử lại, dead-letter
    const ob = await this.outbox.backlog();
    return {
      redis_healthy: this.redis.isHealthy,
      queues,
      dead_letters: { total: dl?.total ?? 0, last_24h: dl?.last_24h ?? 0, unreplayed: dl?.unreplayed ?? 0, by_queue: Object.fromEntries(byQueue.map((x) => [x.queue, x.n])) },
      partitions: coverage.map((c) => ({ table: c.table, months_ahead: c.monthsAhead, missing: c.missing })),
      flags: await this.flags.list(),
      sla: { content_reports_overdue: await this.reports.overdueCount(), support_tickets_overdue: await this.support.overdueCount() },
      outbox: ob,
    };
  }

  private dlDto(r: DeadLetterRow) {
    return { id: r.id, queue: r.queue, job: deadLetterJobName(r), job_id: r.jobId, error: r.error?.slice(0, 500) ?? null, attempts: r.attempts ?? null, failed_at: r.failedAt.toISOString(), replayed_at: r.replayedAt?.toISOString() ?? null, replay_count: r.replayCount };
  }

  async deadLetters(q: { queue?: string; job?: string; replayed?: boolean; cursor?: string; limit: number }) {
    const conds: SQL[] = [];
    if (q.queue) conds.push(eq(opsJobsDeadletter.queue, q.queue));
    if (q.job) conds.push(sql`(${opsJobsDeadletter.jobName} = ${q.job} or starts_with(${opsJobsDeadletter.jobId}, ${`${q.job}__`}))`);
    if (q.replayed === true) conds.push(sql`${opsJobsDeadletter.replayedAt} is not null`);
    if (q.replayed === false) conds.push(sql`${opsJobsDeadletter.replayedAt} is null`);
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${opsJobsDeadletter.failedAt}, ${opsJobsDeadletter.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(opsJobsDeadletter).where(conds.length ? and(...conds) : undefined).orderBy(desc(opsJobsDeadletter.failedAt), desc(opsJobsDeadletter.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: page.map((r) => this.dlDto(r)), next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.failedAt.toISOString(), id: last.id }) : null };
  }

  async replay(actor: AuthUser, id: string) {
    const [row] = await this.dbs.db.select().from(opsJobsDeadletter).where(eq(opsJobsDeadletter.id, id)).limit(1);
    if (!row) throw new NotFound('dead_letter', id);
    const name = deadLetterJobName(row);
    if (!name) throw new Conflict('Cannot determine job name for this dead-letter', { reason: 'no_handler' });
    // B7/S26: dead-letter của outbox → mở lại sự kiện và giao ngay các consumer còn lỗi (idempotent theo consumer)
    if (row.queue === OUTBOX_DLQ_QUEUE) return this.replayOutbox(actor, row, name);
    const queue = row.queue as QueueName;
    if (!(QUEUES as readonly string[]).includes(queue)) throw new Conflict('Unknown queue', { reason: 'no_handler', queue });
    const payload = { ...((row.payload ?? {}) as Record<string, unknown>) };
    delete payload.resolved_at;
    let mode: 'queued' | 'inline' = 'queued';
    let result: unknown = null;
    let error: string | null = null;
    let queued = false;
    if (!this.env.JOBS_INLINE && this.redis.isHealthy) {
      try {
        const q = this.queues.get(queue);
        const existing = await q.getJob(row.jobId);
        if (existing) {
          const st = await existing.getState();
          if (st === 'failed' || st === 'completed') await existing.remove();
          else throw new Conflict('Job is still pending in the queue', { reason: 'job_pending', state: st });
        }
        await q.add(name, payload, { jobId: row.jobId, attempts: Math.max(1, row.attempts ?? 2), backoff: { type: 'exponential', delay: 5000 } });
        queued = true;
      } catch (err) {
        if (err instanceof Conflict) throw err;
        this.logger.warn({ err: (err as Error).message, dead_letter_id: id }, 'replay enqueue failed → inline');
      }
    }
    if (!queued) {
      mode = 'inline';
      const businessId = typeof payload._business_id === 'string' ? payload._business_id : `replay-${id}`;
      try {
        const r = await this.jobs.dispatch(queue, name, `${businessId}__replay${row.replayCount + 1}`, payload);
        result = r.done ? await r.done : null;
      } catch (err) {
        if ((err as Error).message?.startsWith('No handler registered')) throw new Conflict('No handler for this job in the API process', { reason: 'no_handler', job: name });
        error = (err as Error).message.slice(0, 500);
      }
    }
    const [after] = await this.dbs.db.update(opsJobsDeadletter).set({ replayedAt: new Date(), replayCount: row.replayCount + 1, jobName: name }).where(eq(opsJobsDeadletter.id, id)).returning();
    await this.audit.log({ action: 'job.dead_letter_replayed', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'dead_letter', entityId: id, after: { queue, job: name, mode, error: error ? 'failed' : null, replay_count: after!.replayCount } });
    return { ...this.dlDto(after!), mode, result: (result as Record<string, unknown> | null) ?? null, error };
  }

  private async replayOutbox(actor: AuthUser, row: DeadLetterRow, name: string) {
    const result: OutboxDeliveryResult = await this.outbox.replayDeadLetter(row).catch((err: Error) => {
      throw new Conflict('Dead-letter payload is not a replayable outbox event', { reason: 'no_handler', detail: err.message.slice(0, 200) });
    });
    const error = result.failed.length ? result.failed.map((f) => `${f.consumer}: ${f.error}`).join(' | ').slice(0, 500) : null;
    const [after] = await this.dbs.db.update(opsJobsDeadletter).set({ replayedAt: new Date(), replayCount: row.replayCount + 1, jobName: name }).where(eq(opsJobsDeadletter.id, row.id)).returning();
    await this.audit.log({ action: 'job.dead_letter_replayed', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'dead_letter', entityId: row.id, after: { queue: row.queue, job: name, mode: 'inline', status: result.status, delivered: result.delivered.length, failed: result.failed.length, replay_count: after!.replayCount } });
    return { ...this.dlDto(after!), mode: 'inline' as const, result: { status: result.status, delivered: result.delivered, failed: result.failed.map((f) => f.consumer), attempts: result.attempts }, error };
  }

  async auditLogs(q: { actor?: string; action?: string; entity_type?: string; entity_id?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (from > to) throw new ValidationFailed({ issues: [{ path: 'from', message: 'from must be before to' }] });
    if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new ValidationFailed({ issues: [{ path: 'from', message: 'range must be ≤ 366 days' }] });
    const conds: SQL[] = [sql`${opsAuditLogs.createdAt} >= ${from.toISOString()}::timestamptz`, sql`${opsAuditLogs.createdAt} <= ${to.toISOString()}::timestamptz`];
    if (q.actor) conds.push(eq(opsAuditLogs.actorUserId, q.actor));
    if (q.action) {
      const a = q.action.trim();
      if (a.endsWith('*') || a.endsWith('.')) conds.push(sql`starts_with(${opsAuditLogs.action}, ${a.replace(/\*$/, '')})`);
      else conds.push(eq(opsAuditLogs.action, a));
    }
    if (q.entity_type) conds.push(eq(opsAuditLogs.entityType, q.entity_type));
    if (q.entity_id) conds.push(eq(opsAuditLogs.entityId, q.entity_id));
    const c = decodeCursor<{ at: string; id: number }>(q.cursor);
    if (c) conds.push(sql`(${opsAuditLogs.createdAt}, ${opsAuditLogs.id}) < (${c.at}::timestamptz, ${c.id}::bigint)`);
    const rows = await this.dbs.db.select().from(opsAuditLogs).where(and(...conds)).orderBy(desc(opsAuditLogs.createdAt), desc(opsAuditLogs.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({ id: Number(r.id), actor_user_id: r.actorUserId ?? null, actor_role: r.actorRole ?? null, action: r.action, entity_type: r.entityType ?? null, entity_id: r.entityId ?? null, before: (r.before as Record<string, unknown> | null) ?? null, after: (r.after as Record<string, unknown> | null) ?? null, created_at: r.createdAt.toISOString() })),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: Number(last.id) }) : null,
    };
  }

  /** Retention: dead-letter đã replay/giải quyết cũ hơn `before` */
  async purgeDeadLetters(before: Date): Promise<number> {
    const r = (await this.dbs.db.execute(sql`delete from ops.jobs_deadletter where failed_at < ${before.toISOString()}::timestamptz and (replayed_at is not null or coalesce(payload->>'resolved_at', '') <> '') returning 1`)) as unknown as unknown[];
    return r.length;
  }
}
