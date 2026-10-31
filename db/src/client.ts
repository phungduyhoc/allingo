import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../drizzle/schema/index.js';

export type DbSchema = typeof schema;
export type Db = PostgresJsDatabase<DbSchema>;

export interface CreateDbOptions {
  url: string;
  max?: number;
  /** Tên ứng dụng hiển thị trong pg_stat_activity */
  applicationName?: string;
  /** Prepared statements tắt khi đi qua PgBouncer transaction mode */
  prepare?: boolean;
}

/** Tạo kết nối postgres-js + Drizzle với schema đầy đủ 6 schema. */
export function createDb(opts: CreateDbOptions): { db: Db; sql: Sql } {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? true,
    connection: { application_name: opts.applicationName ?? 'allingo', TimeZone: 'UTC' },
    onnotice: () => undefined,
    transform: { undefined: null },
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

export { schema };
