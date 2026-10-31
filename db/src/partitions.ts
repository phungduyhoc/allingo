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
