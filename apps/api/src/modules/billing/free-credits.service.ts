import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { UserDirectory } from '../../shared/events/user-directory.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CreditService } from './credit.service.js';
import { vnMonth, vnMonthRange } from './payments/crypto.js';

const { billingPlans, billingCreditLedger } = schema;

/** ref_id ổn định cho lô credit Free của một kỳ (cùng mọi người dùng – job credit.expire khoá theo (user, ref_type, ref_id)) */
export function freeMonthlyRefId(period: string): string {
  const h = createHash('sha256').update(`free_monthly:${period}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Free cấp lại credit hằng tháng (A105 → S8, job `credit.grant_free_monthly`, mỗi giờ). Kỳ = tháng lịch Asia/Ho_Chi_Minh.
 *  - Số credit = `billing.plans['free'].credits_included` (seed 300) – đổi trong admin không cần deploy.
 *  - Đối tượng: tài khoản đăng ký (đã nhận credit đăng ký `free_monthly`), đang hoạt động, không phải khách, KHÔNG có subscription
 *    trả phí đang hiệu lực (dùng thử vẫn tính là Free).
 *  - Không cộng dồn: lô Free của kỳ hết hạn đầu tháng sau (credit.expire thu phần chưa dùng); credit mua/tặng không bị ảnh hưởng.
 *    Tháng đăng ký: credit đăng ký (300, không hạn) được tính là lượt cấp của kỳ đó.
 *  - Idempotent theo (user, kỳ): ledger `subscription_grant` ref_type `free_monthly`, ref_id = freeMonthlyRefId(kỳ), kiểm tra
 *    dưới khoá hàng số dư.
 */
@Injectable()
export class FreeCreditsService {
  private readonly logger = getLogger({ component: 'billing.free-credits' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly credits: CreditService,
    private readonly users: UserDirectory,
    private readonly outbox: OutboxService,
  ) {}

  async monthlyAmount(): Promise<number> {
    const [free] = await this.dbs.db.select({ credits: billingPlans.creditsIncluded, period: billingPlans.creditsPeriod }).from(billingPlans).where(eq(billingPlans.code, 'free')).limit(1);
    return free && free.period === 'monthly' ? free.credits : 0;
  }

  /** Cấp cho mọi người dùng Free chưa nhận kỳ hiện tại (tối đa `maxUsers` mỗi lần chạy – lần sau chạy tiếp) */
  async grantDue(now: Date = new Date(this.clock.now()), opts: { maxUsers?: number; userIds?: string[] } = {}): Promise<{ period: string; users: number; credits: number; skipped: number }> {
    const maxUsers = opts.maxUsers ?? 5000;
    const only = opts.userIds?.length ? sql`and b.owner_id = any(${`{${opts.userIds.join(',')}}`}::uuid[])` : sql``;
    const period = vnMonth(now);
    const { start, end } = vnMonthRange(period);
    const refId = freeMonthlyRefId(period);
    const amount = await this.monthlyAmount();
    if (amount <= 0) return { period, users: 0, credits: 0, skipped: 0 };
    let cursor = '00000000-0000-0000-0000-000000000000';
    let users = 0;
    let skipped = 0;
    let scanned = 0;
    while (scanned < maxUsers) {
      const batch = await this.dbs.db.execute<{ user_id: string }>(sql`
        select b.owner_id as user_id from billing.credit_balances b
        where b.owner_type = 'user' and b.owner_id > ${cursor}::uuid ${only}
          and exists (select 1 from billing.credit_ledger l where l.user_id = b.owner_id and l.reason = 'subscription_grant' and l.ref_type = 'plan' and l.note = 'free_monthly')
          and not exists (select 1 from billing.subscriptions s where s.user_id = b.owner_id and s.status in ('active','lifetime')
                          and s.current_period_start <= ${now.toISOString()}::timestamptz and (s.current_period_end is null or s.current_period_end > ${now.toISOString()}::timestamptz))
          and not exists (select 1 from billing.credit_ledger g where g.user_id = b.owner_id and g.reason = 'subscription_grant'
                          and ((g.ref_type = 'free_monthly' and g.ref_id = ${refId}::uuid)
                               or (g.ref_type = 'plan' and g.note = 'free_monthly' and g.created_at >= ${start.toISOString()}::timestamptz and g.created_at < ${end.toISOString()}::timestamptz)))
        order by b.owner_id limit 500`);
      const ids = [...batch].map((r) => r.user_id);
      if (!ids.length) break;
      cursor = ids[ids.length - 1]!;
      scanned += ids.length;
      const contacts = new Map((await this.users.contacts(ids)).map((c) => [c.id, c]));
      for (const id of ids) {
        const c = contacts.get(id);
        if (!c || c.isGuest || c.status !== 'active') {
          skipped++;
          continue;
        }
        const granted = await this.dbs.db.transaction(async (tx) => {
          await this.credits.lock(tx, id);
          const [done] = await tx
            .select({ id: billingCreditLedger.id })
            .from(billingCreditLedger)
            .where(and(eq(billingCreditLedger.userId, id), eq(billingCreditLedger.reason, 'subscription_grant'), eq(billingCreditLedger.refType, 'free_monthly'), eq(billingCreditLedger.refId, refId)))
            .limit(1);
          if (done) return null;
          return this.credits.grant(tx, id, amount, 'subscription_grant', { refType: 'free_monthly', refId, note: `free_monthly:${period}`, expiresAt: end });
        });
        if (granted) {
          users++;
          this.outbox.emitLocal('credits.changed', { user_id: id, balance: granted.balanceAfter });
        }
      }
      if (ids.length < 500) break;
    }
    if (users) this.logger.info({ period, users, credits: users * amount, skipped }, 'free monthly credits granted');
    return { period, users, credits: users * amount, skipped };
  }
}
