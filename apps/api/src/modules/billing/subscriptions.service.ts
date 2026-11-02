import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, type Subscription } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { Conflict, NotFound } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { EntitlementService } from './entitlement.service.js';
import { FulfillmentService, type SubscriptionRow } from './fulfillment.service.js';
import { planSummary, type PlanRow } from './plans.service.js';
import { daysLeft, reminderThreshold } from './subscription-periods.js';

const { billingSubscriptions, billingPlans } = schema;

/**
 * Subscription (Sprint 7): không auto-renew thẻ ở năm 1 – gia hạn = mua lại (kỳ nối tiếp, FulfillmentService).
 *  - Huỷ (`POST /me/subscriptions/{id}/cancel`): `cancel_at_period_end = true`, giữ quyền tới `current_period_end`,
 *    ngừng cấp credit tháng các kỳ còn lại.
 *  - Job subscription.expire: hết kỳ → `expired` (hoặc `cancelled` nếu đã huỷ) → entitlements hết hiệu lực theo valid_to,
 *    outbox `subscription.expired`; nhắc trước 7/3/1 ngày → outbox `subscription.expiring` (growth tạo ops.notifications).
 *    Không nhắc/không báo hạ Free khi đã có kỳ nối tiếp.
 *  - Job credit.grant_monthly: cấp credit các kỳ 30 ngày đến hạn (idempotent theo (subscription_id, period)).
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = getLogger({ component: 'billing.subscriptions' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly fulfillment: FulfillmentService,
    private readonly entitlements: EntitlementService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  /** Khoá một hàng subscription (FOR UPDATE trên đúng bảng – Postgres không nhận `OF` có schema) rồi đọc gói */
  private async lockWithPlan(tx: DbOrTx, id: string, opts: { skipLocked?: boolean; extra?: SQL } = {}): Promise<{ s: SubscriptionRow; p: PlanRow } | null> {
    const [row] = await tx
      .select()
      .from(billingSubscriptions)
      .where(and(eq(billingSubscriptions.id, id), opts.extra))
      .limit(1)
      .for('update', opts.skipLocked ? { skipLocked: true } : {});
    if (!row) return null;
    const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.id, row.planId)).limit(1);
    return plan ? { s: row, p: plan } : null;
  }

  toDto(s: SubscriptionRow, plan: PlanRow, now = this.now()): Subscription {
    const started = s.currentPeriodStart <= now;
    const notEnded = !s.currentPeriodEnd || s.currentPeriodEnd > now;
    const live = s.status === 'active' || s.status === 'lifetime' || s.status === 'trialing';
    return {
      id: s.id,
      plan: planSummary(plan),
      program: s.programCode ?? null,
      status: s.status,
      current_period_start: s.currentPeriodStart.toISOString(),
      current_period_end: s.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      is_current: live && started && notEnded,
      upcoming: live && !started,
      days_left: live && notEnded ? daysLeft(s.currentPeriodEnd, now) : 0,
      source_order_id: s.sourceOrderId ?? null,
    };
  }

  async listMine(userId: string): Promise<Subscription[]> {
    const rows = await this.dbs.db
      .select({ s: billingSubscriptions, p: billingPlans })
      .from(billingSubscriptions)
      .innerJoin(billingPlans, eq(billingPlans.id, billingSubscriptions.planId))
      .where(eq(billingSubscriptions.userId, userId))
      .orderBy(desc(billingSubscriptions.currentPeriodStart))
      .limit(100);
    const now = this.now();
    return rows.map((r) => this.toDto(r.s, r.p, now));
  }

  async cancel(user: { id: string; roles: string[] }, subscriptionId: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<Subscription> {
    const out = await this.dbs.db.transaction(async (tx) => {
      const row = await this.lockWithPlan(tx, subscriptionId);
      if (!row || row.s.userId !== user.id) throw new NotFound('subscription', subscriptionId);
      if (row.s.status === 'lifetime' || !row.s.currentPeriodEnd) throw new Conflict('Lifetime subscription cannot be cancelled', { reason: 'lifetime' });
      if (row.s.status !== 'active' && row.s.status !== 'trialing') throw new Conflict('Subscription is not active', { reason: 'not_active', status: row.s.status });
      if (row.s.cancelAtPeriodEnd) return this.toDto(row.s, row.p);
      const now = this.now();
      const [u] = await tx.update(billingSubscriptions).set({ cancelAtPeriodEnd: true, updatedAt: now }).where(eq(billingSubscriptions.id, subscriptionId)).returning();
      await this.outbox.write(tx, { aggregateType: 'subscription', aggregateId: subscriptionId, eventType: DOMAIN_EVENTS.SUBSCRIPTION_CANCELLED, payload: { subscription_id: subscriptionId, user_id: user.id, plan_code: row.p.code, period_end: row.s.currentPeriodEnd.toISOString() } });
      await this.audit.log({ action: 'subscription.cancel', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'subscription', entityId: subscriptionId, before: { cancel_at_period_end: false }, after: { cancel_at_period_end: true, period_end: row.s.currentPeriodEnd.toISOString() }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      return this.toDto(u!, row.p, now);
    });
    await this.entitlements.invalidate(user.id);
    return out;
  }

  /** Có kỳ nối tiếp (cùng chương trình, còn hiệu lực sau kỳ này) → không nhắc / không báo hạ Free */
  private async hasSuccessor(db: DbOrTx, s: SubscriptionRow): Promise<boolean> {
    if (!s.userId || !s.currentPeriodEnd) return false;
    const [r] = await db
      .select({ id: billingSubscriptions.id })
      .from(billingSubscriptions)
      .where(
        and(
          eq(billingSubscriptions.userId, s.userId),
          ne(billingSubscriptions.id, s.id),
          inArray(billingSubscriptions.status, ['active', 'lifetime', 'trialing']),
          s.programCode ? eq(billingSubscriptions.programCode, s.programCode) : isNull(billingSubscriptions.programCode),
          or(isNull(billingSubscriptions.currentPeriodEnd), gt(billingSubscriptions.currentPeriodEnd, s.currentPeriodEnd)),
          lte(billingSubscriptions.currentPeriodStart, new Date(s.currentPeriodEnd.getTime() + 60_000)),
        ),
      )
      .limit(1);
    return !!r;
  }

  private event(s: SubscriptionRow, plan: PlanRow, extra: Record<string, unknown>) {
    return { subscription_id: s.id, user_id: s.userId, plan_code: plan.code, plan_name: plan.name, program: s.programCode ?? null, period_end: s.currentPeriodEnd?.toISOString() ?? null, cancel_at_period_end: s.cancelAtPeriodEnd, ...extra };
  }

  /** Job subscription.expire (phần hết hạn) */
  async expireDue(now: Date = this.now()): Promise<{ expired: number; notified: number }> {
    // S8: gồm cả dùng thử (`trialing`) – hết trial → `expired`, thông báo billing.trial_ended
    const due = await this.dbs.db.select({ id: billingSubscriptions.id }).from(billingSubscriptions).where(and(inArray(billingSubscriptions.status, ['active', 'trialing']), lte(billingSubscriptions.currentPeriodEnd, now))).limit(500);
    let expired = 0;
    let notified = 0;
    const users = new Set<string>();
    for (const { id } of due) {
      const ev = await this.dbs.db.transaction(async (tx) => {
        const row = await this.lockWithPlan(tx, id, { skipLocked: true, extra: inArray(billingSubscriptions.status, ['active', 'trialing']) });
        if (!row || !row.s.currentPeriodEnd || row.s.currentPeriodEnd > now) return null;
        const trial = row.s.status === 'trialing';
        const status = trial ? 'expired' : row.s.cancelAtPeriodEnd ? 'cancelled' : 'expired';
        await tx.update(billingSubscriptions).set({ status, updatedAt: now }).where(eq(billingSubscriptions.id, id));
        const successor = await this.hasSuccessor(tx, row.s);
        const payload = this.event(row.s, row.p, { status, trial, has_successor: successor, dedupe_key: `sub:${id}:expired` });
        await this.outbox.write(tx, { aggregateType: 'subscription', aggregateId: id, eventType: DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED, payload });
        return { userId: row.s.userId, payload, successor };
      });
      if (!ev) continue;
      expired++;
      if (ev.userId) users.add(ev.userId);
      if (!ev.successor) {
        this.outbox.emitLocal(DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED, ev.payload);
        notified++;
      }
    }
    for (const u of users) await this.entitlements.invalidate(u);
    if (expired) this.logger.info({ expired, notified }, 'subscriptions expired');
    return { expired, notified };
  }

  /** Job subscription.expire (phần nhắc trước 7/3/1 ngày) – mỗi (subscription, kỳ, mốc) một lần */
  async remindDue(now: Date = this.now()): Promise<{ reminded: number }> {
    const rows = await this.dbs.db
      .select({ s: billingSubscriptions, p: billingPlans })
      .from(billingSubscriptions)
      .innerJoin(billingPlans, eq(billingPlans.id, billingSubscriptions.planId))
      .where(and(inArray(billingSubscriptions.status, ['active', 'trialing']), gt(billingSubscriptions.currentPeriodEnd, now), lte(billingSubscriptions.currentPeriodEnd, new Date(now.getTime() + 7 * 86_400_000)), lte(billingSubscriptions.currentPeriodStart, now)))
      .limit(1000);
    let reminded = 0;
    for (const { s, p } of rows) {
      // S8: dùng thử chỉ nhắc 1 ngày trước khi hết (billing.trial_ending)
      const trial = s.status === 'trialing';
      const d = reminderThreshold(s.currentPeriodEnd!, now, trial ? [1] : undefined);
      if (d === null || (await this.hasSuccessor(this.dbs.db, s))) continue;
      const dedupe = `sub:${s.id}:${s.currentPeriodEnd!.getTime()}:d${d}`;
      if (!(await this.claimOnce(dedupe))) continue;
      const payload = this.event(s, p, { days_before: d, days_left: daysLeft(s.currentPeriodEnd, now), trial, dedupe_key: dedupe });
      await this.outbox.write(this.dbs.db, { aggregateType: 'subscription', aggregateId: s.id, eventType: DOMAIN_EVENTS.SUBSCRIPTION_EXPIRING, payload });
      this.outbox.emitLocal(DOMAIN_EVENTS.SUBSCRIPTION_EXPIRING, payload);
      reminded++;
    }
    return { reminded };
  }

  /** Đánh dấu một lần: Redis SET NX (10 ngày); Redis mất → tra outbox 8 ngày gần nhất (growth vẫn chống trùng theo dedupe_key) */
  private async claimOnce(key: string): Promise<boolean> {
    const r = await this.redis.safe((c) => c.set(`billing:once:${key}`, '1', 'EX', 10 * 86_400, 'NX'));
    if (r !== null) return r === 'OK';
    const [hit] = await this.dbs.db
      .select({ id: schema.opsOutbox.id })
      .from(schema.opsOutbox)
      .where(and(gt(schema.opsOutbox.createdAt, new Date(Date.now() - 8 * 86_400_000)), sql`${schema.opsOutbox.payload}->>'dedupe_key' = ${key}`))
      .limit(1);
    return !hit;
  }

  /** Job credit.grant_monthly */
  async grantMonthlyDue(now: Date = this.now()): Promise<{ subscriptions: number; credits: number }> {
    const rows = await this.dbs.db
      .select({ id: billingSubscriptions.id })
      .from(billingSubscriptions)
      .innerJoin(billingPlans, eq(billingPlans.id, billingSubscriptions.planId))
      .where(and(eq(billingSubscriptions.status, 'active'), eq(billingSubscriptions.cancelAtPeriodEnd, false), eq(billingPlans.creditsPeriod, 'monthly'), gt(billingPlans.creditsIncluded, 0), lte(billingSubscriptions.currentPeriodStart, now)))
      .limit(2000);
    let subs = 0;
    let credits = 0;
    const users = new Set<string>();
    for (const { id } of rows) {
      const granted = await this.dbs.db.transaction(async (tx) => {
        const row = await this.lockWithPlan(tx, id, { extra: and(eq(billingSubscriptions.status, 'active'), eq(billingSubscriptions.cancelAtPeriodEnd, false)) });
        if (!row) return { n: 0, userId: null };
        return { n: await this.fulfillment.grantDueCredits(tx, row.s, row.p, now), userId: row.s.userId };
      });
      if (granted.n > 0) {
        subs++;
        credits += granted.n;
        if (granted.userId) users.add(granted.userId);
      }
    }
    for (const u of users) this.outbox.emitLocal('credits.changed', { user_id: u });
    if (credits) this.logger.info({ subscriptions: subs, credits }, 'monthly credits granted');
    return { subscriptions: subs, credits };
  }
}
