import { performance } from 'node:perf_hooks';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../drizzle/schema/index.js';

export type DbSchema = typeof schema;
export type Db = PostgresJsDatabase<DbSchema>;

/** Thông tin một truy vấn đã chạy xong (S11 – metrics/slow query). `sql` là văn bản có tham số `$n` – KHÔNG chứa giá trị */
export interface QueryInfo {
  sql: string;
  ms: number;
  ok: boolean;
}

export interface CreateDbOptions {
  url: string;
  max?: number;
  /** Tên ứng dụng hiển thị trong pg_stat_activity */
  applicationName?: string;
  /** Prepared statements tắt khi đi qua PgBouncer transaction mode */
  prepare?: boolean;
  /** S11: gọi sau mỗi truy vấn (kể cả trong transaction) – dùng cho histogram độ trễ + slow query log */
  onQuery?: (info: QueryInfo) => void;
  /** Giây chờ kết nối rảnh trước khi đóng (postgres-js idle_timeout); mặc định không đóng */
  idleTimeout?: number;
}

type Fn = (...args: unknown[]) => unknown;

/**
 * Bọc client postgres-js để đo thời gian mọi truy vấn (Drizzle gọi `unsafe()`; transaction/savepoint truyền client con).
 * postgres-js thực thi query sau một microtask (`await 1` trong handle()), nên gắn `.then` ngay sau `unsafe()` không làm
 * mất `.values()` mà Drizzle gọi đồng bộ tiếp theo.
 */
export function instrumentSql<T extends object>(client: T, onQuery: (info: QueryInfo) => void): T {
  const observe = (text: string, started: number, q: unknown) => {
    if (q && typeof (q as PromiseLike<unknown>).then === 'function') {
      (q as PromiseLike<unknown>).then(
        () => onQuery({ sql: text, ms: performance.now() - started, ok: true }),
        () => onQuery({ sql: text, ms: performance.now() - started, ok: false }),
      );
    }
    return q;
  };
  const wrap = (target: object): object =>
    new Proxy(target, {
      apply(fn, thisArg, args: unknown[]) {
        // sql`...` (tagged template): args[0] là TemplateStringsArray
        const strings = args[0];
        const text = Array.isArray(strings) ? (strings as string[]).join('$?') : 'tagged';
        return observe(text, performance.now(), Reflect.apply(fn as Fn, thisArg, args));
      },
      get(t, prop, receiver) {
        const v = Reflect.get(t, prop, receiver) as unknown;
        if (typeof v !== 'function') return v;
        if (prop === 'unsafe') {
          return (...args: unknown[]) => observe(typeof args[0] === 'string' ? args[0] : '', performance.now(), (v as Fn).apply(t, args));
        }
        if (prop === 'begin' || prop === 'savepoint') {
          return (...args: unknown[]) => {
            const idx = typeof args[0] === 'function' ? 0 : 1;
            const cb = args[idx] as Fn | undefined;
            if (typeof cb === 'function') args[idx] = (inner: object) => cb(wrap(inner));
            return (v as Fn).apply(t, args);
          };
        }
        return (v as Fn).bind(t);
      },
    });
  return wrap(client) as T;
}

/** Tạo kết nối postgres-js + Drizzle với schema đầy đủ 6 schema. */
export function createDb(opts: CreateDbOptions): { db: Db; sql: Sql } {
  const raw = postgres(opts.url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? true,
    connection: { application_name: opts.applicationName ?? 'allingo', TimeZone: 'UTC' },
    onnotice: () => undefined,
    transform: { undefined: null },
    ...(opts.idleTimeout ? { idle_timeout: opts.idleTimeout } : {}),
  });
  const sql = opts.onQuery ? instrumentSql(raw, opts.onQuery) : raw;
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

/** Loại câu lệnh + bảng chính từ văn bản SQL (nhãn metrics, cardinality thấp) */
export function classifySql(text: string): { op: string; table: string } {
  const s = text.trimStart().slice(0, 600);
  const opMatch = /^(\w+)/.exec(s);
  let op = (opMatch?.[1] ?? 'other').toLowerCase();
  if (!['select', 'insert', 'update', 'delete', 'with', 'begin', 'commit', 'rollback', 'set', 'savepoint', 'release'].includes(op)) op = 'other';
  const t = /\b(?:from|into|update|join)\s+((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)/i.exec(s);
  const table = t ? t[1]!.replace(/"/g, '').toLowerCase() : '-';
  return { op, table: /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(table) ? table : '-' };
}

export { schema };
