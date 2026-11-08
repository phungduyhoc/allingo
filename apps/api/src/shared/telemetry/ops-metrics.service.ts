import { Global, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { partitionCoverage } from '@allingo/db';
import { QUEUES, type QueueName } from '@allingo/schemas';
import { DbService } from '../db/db.module.js';
import { QueueService } from '../queue/queue.module.js';
import { RedisService } from '../cache/redis.module.js';
import { DB_METRICS, QUEUE_METRICS, metrics } from './metrics.js';

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed', 'prioritized', 'waiting-children'] as const;

/**
 * Collector chạy khi Prometheus scrape `/v1/metrics` (S11 – ADR-0026 bổ sung): kết nối DB (pg_stat_activity),
 * max_connections, kích thước DB, độ phủ partition, độ sâu + tuổi job chờ lâu nhất của 6 hàng đợi BullMQ, dead-letter 24 giờ.
 * Partition/kích thước DB đổi chậm → cache 5 phút để scrape 15 s không tốn truy vấn catalog.
 */
@Injectable()
export class OpsMetricsService implements OnModuleInit, OnModuleDestroy {
  private slowAt = 0;

  constructor(
    private readonly dbs: DbService,
    private readonly queues: QueueService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    metrics.registerCollector('db', () => this.collectDb());
    metrics.registerCollector('queues', () => this.collectQueues());
    metrics.registerCollector('deadletter', () => this.collectDeadletter());
  }

  onModuleDestroy(): void {
    for (const n of ['db', 'queues', 'deadletter']) metrics.unregisterCollector(n);
  }

  async collectDb(): Promise<void> {
    const rows = (await this.dbs.db.execute(sql`
      SELECT coalesce(state, 'unknown') AS state, count(*)::int AS n
      FROM pg_stat_activity WHERE backend_type = 'client backend' GROUP BY 1
    `)) as unknown as Array<{ state: string; n: number }>;
    for (const s of ['active', 'idle', 'idle in transaction', 'idle in transaction (aborted)', 'unknown']) DB_METRICS.connections.set({ state: s }, 0);
    for (const r of rows) DB_METRICS.connections.set({ state: r.state }, r.n);
    const [mc] = (await this.dbs.db.execute(sql`SELECT current_setting('max_connections')::int AS n`)) as unknown as Array<{ n: number }>;
    if (mc) DB_METRICS.maxConnections.set({}, mc.n);
    if (Date.now() - this.slowAt > 300_000) {
      this.slowAt = Date.now();
      const [sz] = (await this.dbs.db.execute(sql`SELECT pg_database_size(current_database())::bigint AS b`)) as unknown as Array<{ b: string | number }>;
      if (sz) DB_METRICS.databaseSize.set({}, Number(sz.b));
      for (const c of await partitionCoverage(this.dbs.db, 2)) DB_METRICS.partitionMonthsAhead.set({ table: c.table }, c.monthsAhead);
    }
  }

  async collectQueues(): Promise<void> {
    if (!this.redis.isHealthy) return;
    await Promise.all(
      QUEUES.map(async (name: QueueName) => {
        const q = this.queues.get(name);
        const counts = await q.getJobCounts(...QUEUE_STATES);
        for (const st of QUEUE_STATES) QUEUE_METRICS.jobs.set({ queue: name, state: st }, counts[st] ?? 0);
        const [oldest] = await q.getJobs(['waiting', 'prioritized'], 0, 0, true);
        QUEUE_METRICS.oldestWaiting.set({ queue: name }, oldest?.timestamp ? Math.max(0, (Date.now() - oldest.timestamp) / 1000) : 0);
      }),
    );
  }

  async collectDeadletter(): Promise<void> {
    const rows = (await this.dbs.db.execute(sql`
      SELECT queue, count(*)::int AS n FROM ops.jobs_deadletter WHERE failed_at > now() - interval '24 hours' GROUP BY queue
    `)) as unknown as Array<{ queue: string; n: number }>;
    for (const name of QUEUES) QUEUE_METRICS.deadletter.set({ queue: name }, 0);
    for (const r of rows) QUEUE_METRICS.deadletter.set({ queue: r.queue }, r.n);
  }
}

@Global()
@Module({ providers: [OpsMetricsService], exports: [OpsMetricsService] })
export class OpsMetricsModule {}
