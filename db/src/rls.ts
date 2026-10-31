import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

export interface RlsContext {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Chạy `fn` trong transaction với SET LOCAL app.user_id/app.org_id/app.role
 * (CLAUDE.md §5.10). Các policy RLS đọc current_setting('app.*', true).
 */
export async function withRls<T>(db: Db, ctx: RlsContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`);
    await tx.execute(sql`SELECT set_config('app.org_id', ${ctx.orgId ?? ''}, true)`);
    await tx.execute(sql`SELECT set_config('app.role', ${ctx.role ?? 'learner'}, true)`);
    return fn(tx);
  });
}
