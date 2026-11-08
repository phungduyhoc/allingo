import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { classifySql, createDb, withRls, type Db, type QueryInfo, type RlsContext } from '@allingo/db';
import type { Sql } from 'postgres';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../telemetry/logger.js';
import { DB_METRICS } from '../telemetry/metrics.js';

export const DB = Symbol('DB');

/** Kết nối Drizzle dùng chung; vai trò DB runtime không có BYPASSRLS (CLAUDE.md §5.10) */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Db;
  readonly sql: Sql;
  readonly replica: Db;
  private readonly replicaSql: Sql | null;

  constructor(@Inject(ENV) env: Env) {
    const onQuery = env.DB_QUERY_METRICS ? queryObserver(env.DB_SLOW_QUERY_MS) : undefined;
    const primary = createDb({ url: env.DATABASE_URL, max: env.DB_POOL_MAX, applicationName: 'allingo-api', onQuery });
    DB_METRICS.poolMax.set({ pool: 'primary' }, env.DB_POOL_MAX);
    this.db = primary.db;
    this.sql = primary.sql;
    if (env.DATABASE_URL_REPLICA) {
      const replicaMax = Math.max(2, Math.floor(env.DB_POOL_MAX / 2));
      const r = createDb({ url: env.DATABASE_URL_REPLICA, max: replicaMax, applicationName: 'allingo-api-replica', onQuery });
      DB_METRICS.poolMax.set({ pool: 'replica' }, replicaMax);
      this.replica = r.db;
      this.replicaSql = r.sql;
    } else {
      this.replica = primary.db;
      this.replicaSql = null;
    }
  }

  /** Transaction có SET LOCAL app.user_id/org_id/role */
  withRls<T>(ctx: RlsContext, fn: Parameters<typeof withRls<T>>[2]): Promise<T> {
    return withRls(this.db, ctx, fn);
  }

  async ping(): Promise<boolean> {
    try {
      await this.sql`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
    await this.replicaSql?.end({ timeout: 5 });
  }
}

/**
 * S11: histogram độ trễ theo (op, bảng chính) + slow query (> DB_SLOW_QUERY_MS) → counter + log cảnh báo kèm trace_id.
 * Log chỉ có văn bản SQL tham số hoá (`$1`…) cắt 300 ký tự – không giá trị tham số (không PII).
 */
export function queryObserver(slowMs: number): (q: QueryInfo) => void {
  const logger = getLogger({ component: 'db' });
  return (q) => {
    const labels = classifySql(q.sql);
    DB_METRICS.queryDuration.observe(labels, q.ms / 1000);
    if (!q.ok) DB_METRICS.queryErrors.inc(labels);
    if (slowMs > 0 && q.ms >= slowMs) {
      DB_METRICS.slowQueries.inc(labels);
      logger.warn({ ms: Math.round(q.ms), op: labels.op, table: labels.table, sql: q.sql.replace(/\s+/g, ' ').slice(0, 300) }, 'slow query');
    }
  };
}

@Global()
@Module({
  providers: [DbService, { provide: DB, useFactory: (s: DbService) => s.db, inject: [DbService] }],
  exports: [DbService, DB],
})
export class DbModule {}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
