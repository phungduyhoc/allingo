import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { createDb, withRls, type Db, type RlsContext } from '@allingo/db';
import type { Sql } from 'postgres';
import { ENV, type Env } from '../../config/env.js';

export const DB = Symbol('DB');

/** Kết nối Drizzle dùng chung; vai trò DB runtime không có BYPASSRLS (CLAUDE.md §5.10) */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Db;
  readonly sql: Sql;
  readonly replica: Db;
  private readonly replicaSql: Sql | null;

  constructor(@Inject(ENV) env: Env) {
    const primary = createDb({ url: env.DATABASE_URL, max: env.DB_POOL_MAX, applicationName: 'allingo-api' });
    this.db = primary.db;
    this.sql = primary.sql;
    if (env.DATABASE_URL_REPLICA) {
      const r = createDb({ url: env.DATABASE_URL_REPLICA, max: Math.max(2, Math.floor(env.DB_POOL_MAX / 2)), applicationName: 'allingo-api-replica' });
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

@Global()
@Module({
  providers: [DbService, { provide: DB, useFactory: (s: DbService) => s.db, inject: [DbService] }],
  exports: [DbService, DB],
})
export class DbModule {}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
