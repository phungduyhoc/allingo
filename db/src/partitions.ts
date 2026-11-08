import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

/** Các bảng partition theo tháng (docs/spec/allingo-schema.sql mục 7) */
export const PARTITIONED_TABLES: ReadonlyArray<{ schema: string; table: string }> = [
  { schema: 'learn', table: 'attempt_answers' },
  { schema: 'ai', table: 'ai_tasks' },
  { schema: 'ops', table: 'audit_logs' },
  { schema: 'ops', table: 'outbox' },
];

/** Đảm bảo partition cho tháng hiện tại và `monthsAhead` tháng tới. Idempotent. */
export async function ensureMonthPartitions(db: Db, monthsAhead = 2, now = new Date()): Promise<string[]> {
  const created: string[] = [];
  for (const t of PARTITIONED_TABLES) {
    for (let i = 0; i <= monthsAhead; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const month = d.toISOString().slice(0, 10);
      await db.execute(sql`SELECT ops.ensure_month_partition(${t.schema}, ${t.table}, ${month}::date)`);
      created.push(`${t.schema}.${t.table}@${month.slice(0, 7)}`);
    }
  }
  return created;
}

export interface PartitionCoverage {
  table: string;
  /** Số tháng liên tiếp SAU tháng hiện tại đã có partition (−1 = thiếu cả tháng hiện tại) */
  monthsAhead: number;
  /** Các tháng (YYYY-MM) trong [hiện tại, hiện tại + required] còn thiếu */
  missing: string[];
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Kiểm độ phủ partition (S11 – job `ops.partition.ensure` + cảnh báo): đọc pg_inherits/pg_class, so tên `<bảng>_YYYYMM`
 * với tháng hiện tại … hiện tại + `required`. Dùng cho metrics `db_partition_months_ahead` và alert PartitionMissing.
 */
export async function partitionCoverage(db: Db, required = 2, now = new Date()): Promise<PartitionCoverage[]> {
  const rows = (await db.execute(sql`
    SELECT pn.nspname AS schema, p.relname AS parent, c.relname AS child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE p.relkind = 'p'
  `)) as unknown as Array<{ schema: string; parent: string; child: string }>;
  const out: PartitionCoverage[] = [];
  for (const t of PARTITIONED_TABLES) {
    const have = new Set(
      rows
        .filter((r) => r.schema === t.schema && r.parent === t.table)
        .map((r) => /_(\d{4})(\d{2})$/.exec(r.child))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => `${m[1]}-${m[2]}`),
    );
    const missing: string[] = [];
    let ahead = -1;
    let contiguous = true;
    for (let i = 0; i <= Math.max(required, 12); i++) {
      const k = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)));
      const ok = have.has(k);
      if (i <= required && !ok) missing.push(k);
      if (contiguous && ok) ahead = i;
      else contiguous = false;
    }
    out.push({ table: `${t.schema}.${t.table}`, monthsAhead: ahead, missing });
  }
  return out;
}
