import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { BILLING_REALTIME_EVENTS, DOMAIN_EVENTS, type AdminCreditAdjustInput, type RefundInput } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { UserDirectory } from '../../shared/events/user-directory.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Conflict, NotFound } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { OrdersService } from './orders.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { vnDayRange } from './payments/crypto.js';

const { billingOrders, billingPayments, billingPlans, billingSubscriptions } = schema;

/**
 * Billing cho admin (Sprint 7): hoàn tiền THỦ CÔNG (tiền trả lại qua cổng/chuyển khoản ngoài hệ thống – runbook),
 * danh sách đơn có lọc, tổng hợp doanh thu theo cổng/ngày. TODO(S8): gọi `PaymentProvider.refund` tự động.
 */
@Injectable()
export class BillingAdminService {
  private readonly logger = getLogger({ component: 'billing.admin' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly orders: OrdersService,
    private readonly fulfillment: FulfillmentService,
    private readonly credits: CreditService,
    private readonly entitlements: EntitlementService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly users: UserDirectory,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** POST /admin/orders/{id}/refund – đơn `paid` → `refunded`, thu hồi quyền + credit còn lại (không làm số dư âm), audit */
  async refund(actor: { id: string; roles: string[] }, orderId: string, input: RefundInput, meta: { ip?: string | null; userAgent?: string | null }) {
    const now = new Date(this.clock.now());
    const res = await this.dbs.db.transaction(async (tx) => {
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1).for('update');
      if (!order) throw new NotFound('order', orderId);
      if (order.status !== 'paid') throw new Conflict('Only paid orders can be refunded', { reason: 'order_not_paid', status: order.status });
      const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.id, order.planId)).limit(1);
      const revoked = await this.fulfillment.revoke(tx, order, plan!, now, { revokeCredits: input.revoke_credits });
      // S8: credit tặng kèm đơn (credit_bonus – lô ref promotion:<order>) còn lại cũng thu hồi (không làm số dư âm)
      if (input.revoke_credits && order.promotionId) {
        const bonusLeft = await this.credits.remainingOf(tx, order.userId, { refType: 'promotion', refId: order.id });
        if (bonusLeft > 0) revoked.credits_revoked += (await this.credits.revoke(tx, order.userId, bonusLeft, 'refund', { refType: 'promotion', refId: order.id, note: 'order_refund_bonus' })).revoked;
      }
      await tx.update(billingOrders).set({ status: 'refunded' }).where(eq(billingOrders.id, order.id));
      const refundedPayments = await tx
        .update(billingPayments)
        .set({ status: 'refunded', rawCallback: sql`coalesce(${billingPayments.rawCallback}, '{}'::jsonb) || ${JSON.stringify({ refund: { at: now.toISOString(), by: actor.id, mode: 'manual' } })}::jsonb` })
        .where(and(eq(billingPayments.orderId, order.id), eq(billingPayments.status, 'success')))
        .returning({ id: billingPayments.id, provider: billingPayments.provider });
      const payload = { order_id: order.id, user_id: order.userId, plan_code: plan!.code, total: Number(order.total), reason: input.reason, mode: 'manual', ...revoked, payments: refundedPayments.map((p) => p.id) };
      await this.outbox.write(tx, { aggregateType: 'order', aggregateId: order.id, eventType: DOMAIN_EVENTS.ORDER_REFUNDED, payload });
      await this.audit.log({ action: 'order.refund', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'order', entityId: order.id, before: { status: 'paid' }, after: { ...payload, provider_refund: 'manual_todo' }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      return { order, revoked, providers: [...new Set(refundedPayments.map((p) => p.provider))] };
    });
    await this.entitlements.invalidate(res.order.userId);
    // S8: huỷ hoá đơn điện tử (InvoicesService nghe local + outbox order.refunded)
    this.outbox.emitLocal(DOMAIN_EVENTS.ORDER_REFUNDED, { order_id: orderId, user_id: res.order.userId, reason: input.reason });
    this.outbox.emitLocal(BILLING_REALTIME_EVENTS.ORDER_UPDATED, { user_id: res.order.userId, order_id: orderId, status: 'refunded', paid_at: res.order.paidAt?.toISOString() ?? null });
    this.outbox.emitLocal(BILLING_REALTIME_EVENTS.CREDITS_CHANGED, { user_id: res.order.userId, balance: await this.credits.balance(res.order.userId) });
    this.outbox.emitLocal(BILLING_REALTIME_EVENTS.ENTITLEMENTS_CHANGED, { user_id: res.order.userId });
    this.logger.info({ order_id: orderId, ...res.revoked }, 'order refunded (manual)');
    const [fresh] = await this.dbs.db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    return { order: await this.orders.toDto(fresh!), revoked: res.revoked, provider_refund: { mode: 'manual', providers: res.providers.map((p) => (p === 'manual' ? 'mock' : p)), todo: 'Hoàn tiền tự động qua API cổng – chưa làm (runbook payments §4)' } };
  }

  /** GET /admin/billing/orders */
  async listOrders(q: { status?: string; provider?: string; user_id?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const providerDb = q.provider === 'mock' ? 'manual' : q.provider;
    const rows = await this.dbs.db
      .select()
      .from(billingOrders)
      .where(
        and(
          q.status ? eq(billingOrders.status, q.status as typeof billingOrders.$inferSelect.status) : undefined,
          q.user_id ? eq(billingOrders.userId, q.user_id) : undefined,
          q.from ? gte(billingOrders.createdAt, vnDayRange(q.from).start) : undefined,
          q.to ? lt(billingOrders.createdAt, vnDayRange(q.to).end) : undefined,
          providerDb ? sql`exists (select 1 from billing.payments p where p.order_id = ${billingOrders.id} and p.provider = ${providerDb}::billing.payment_provider)` : undefined,
          c ? sql`(${billingOrders.createdAt}, ${billingOrders.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(billingOrders.createdAt), desc(billingOrders.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const dtos = await this.orders.toDtos(page);
    const txns = page.length ? await this.dbs.db.select({ id: billingPayments.id, txn: billingPayments.providerTxnId, raw: billingPayments.rawCallback }).from(billingPayments).where(inArray(billingPayments.orderId, page.map((p) => p.id))) : [];
    const txnMap = new Map(txns.map((t) => [t.id, { provider_txn_id: t.txn, merchant_ref: ((t.raw as Record<string, unknown> | null)?.merchant_ref as string | undefined) ?? null }]));
    const last = page[page.length - 1];
    return {
      data: dtos.map((d, i) => ({ ...d, user_id: page[i]!.userId, payments: d.payments.map((p) => ({ ...p, ...(txnMap.get(p.id) ?? { provider_txn_id: null, merchant_ref: null }) })) })),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }

  /** GET /admin/billing/summary – theo ngày VN × cổng; đơn kẹt (pending quá PAYMENT_RECONCILE_AFTER_MINUTES) */
  async summary(q: { from?: string; to?: string }) {
    const now = new Date(this.clock.now());
    const to = q.to ? vnDayRange(q.to).end : now;
    const from = q.from ? vnDayRange(q.from).start : new Date(to.getTime() - 30 * 86_400_000);
    const byDay = await this.dbs.db.execute<{ day: string; provider: string; paid: number; revenue: string }>(sql`
      select to_char(p.confirmed_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as day, p.provider::text as provider,
             count(*)::int as paid, coalesce(sum(p.amount), 0)::text as revenue
      from billing.payments p
      where p.status in ('success','refunded') and p.confirmed_at >= ${from.toISOString()}::timestamptz and p.confirmed_at < ${to.toISOString()}::timestamptz
      group by 1, 2 order by 1, 2`);
    const byStatus = await this.dbs.db.execute<{ status: string; n: number }>(sql`select status::text as status, count(*)::int as n from billing.orders where created_at >= ${from.toISOString()}::timestamptz and created_at < ${to.toISOString()}::timestamptz group by 1`);
    const [stuck] = await this.dbs.db.execute<{ n: number }>(sql`select count(*)::int as n from billing.orders o where o.status = 'pending' and o.created_at < ${new Date(now.getTime() - this.env.PAYMENT_RECONCILE_AFTER_MINUTES * 60_000).toISOString()}::timestamptz`);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      by_day: [...byDay].map((r) => ({ day: r.day, provider: r.provider === 'manual' ? 'mock' : r.provider, paid: r.paid, revenue: Number(r.revenue) })),
      orders_by_status: Object.fromEntries([...byStatus].map((r) => [r.status, r.n])),
      stuck_pending: stuck?.n ?? 0,
      revenue_total: [...byDay].reduce((s, r) => s + Number(r.revenue), 0),
    };
  }

  // ------------------------------------------------------------------ S8: credit thủ công + ledger người dùng
  /** POST /admin/users/{userId}/credits – reason `admin_adjust`, lý do bắt buộc, audit có admin id (không ghi PII) */
  async adjustCredits(actor: { id: string; roles: string[] }, userId: string, input: AdminCreditAdjustInput, meta: { ip?: string | null; userAgent?: string | null }) {
    const target = await this.users.contact(userId);
    if (!target) throw new NotFound('user', userId);
    const r = await this.dbs.db.transaction(async (tx) => {
      const res = await this.credits.adjust(tx, userId, input.delta, { actorId: actor.id, note: input.note, expiresAt: input.expires_at ? new Date(input.expires_at) : undefined });
      await this.audit.log({ action: 'user.grant_credits', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: userId, after: { delta: input.delta, balance_after: res.balanceAfter, ledger_id: res.ledgerId, reason: 'admin_adjust', note: input.note, expires_at: input.expires_at ?? null }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      return res;
    });
    this.outbox.emitLocal(BILLING_REALTIME_EVENTS.CREDITS_CHANGED, { user_id: userId, balance: r.balanceAfter });
    this.logger.info({ user_id: userId, delta: input.delta, actor: actor.id }, 'credits adjusted by admin');
    return { user_id: userId, delta: input.delta, balance_after: r.balanceAfter, ledger_id: r.ledgerId, reason: 'admin_adjust' as const, note: input.note, actor_id: actor.id };
  }

  /** GET /admin/users/{userId}/credits/ledger – số dư + ledger (cursor id giảm dần) */
  async userLedger(userId: string, cursor: string | undefined, limit: number) {
    const target = await this.users.contact(userId);
    if (!target) throw new NotFound('user', userId);
    const [balance, page] = await Promise.all([this.credits.balance(userId), this.credits.ledgerPage(userId, cursor, limit)]);
    return { user_id: userId, balance, ...page };
  }

  /** GET /admin/billing/payments */
  async listPayments(q: { status?: string; provider?: string; order_id?: string; user_id?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const providerDb = q.provider === 'mock' ? 'manual' : q.provider;
    const rows = await this.dbs.db
      .select({ p: billingPayments, userId: billingOrders.userId })
      .from(billingPayments)
      .innerJoin(billingOrders, eq(billingOrders.id, billingPayments.orderId))
      .where(
        and(
          q.status ? eq(billingPayments.status, q.status) : undefined,
          providerDb ? eq(billingPayments.provider, providerDb as typeof billingPayments.$inferSelect.provider) : undefined,
          q.order_id ? eq(billingPayments.orderId, q.order_id) : undefined,
          q.user_id ? eq(billingOrders.userId, q.user_id) : undefined,
          q.from ? gte(billingPayments.createdAt, vnDayRange(q.from).start) : undefined,
          q.to ? lt(billingPayments.createdAt, vnDayRange(q.to).end) : undefined,
          c ? sql`(${billingPayments.createdAt}, ${billingPayments.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map(({ p, userId }) => {
        const raw = (p.rawCallback ?? {}) as Record<string, unknown>;
        const flags = [raw.duplicate_order_payment ? 'duplicate_order_payment' : null, raw.reason === 'amount_mismatch' ? 'amount_mismatch' : null, raw.refund ? 'refunded_manual' : null].filter((x): x is string => !!x);
        return { id: p.id, order_id: p.orderId, user_id: userId, provider: p.provider === 'manual' ? 'mock' : p.provider, provider_txn_id: p.providerTxnId ?? null, merchant_ref: (raw.merchant_ref as string | undefined) ?? null, amount: Number(p.amount), currency: p.currency.trim(), status: p.status, signature_valid: p.signatureValid ?? null, created_at: p.createdAt.toISOString(), confirmed_at: p.confirmedAt?.toISOString() ?? null, flags };
      }),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.p.createdAt.toISOString(), id: last.p.id }) : null,
    };
  }

  /** GET /admin/billing/subscriptions */
  async listSubscriptions(q: { status?: string; user_id?: string; plan_code?: string; program?: string; expiring_within_days?: number; cursor?: string; limit: number }) {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const now = new Date(this.clock.now());
    const rows = await this.dbs.db
      .select({ s: billingSubscriptions, p: billingPlans })
      .from(billingSubscriptions)
      .innerJoin(billingPlans, eq(billingPlans.id, billingSubscriptions.planId))
      .where(
        and(
          q.status ? eq(billingSubscriptions.status, q.status as typeof billingSubscriptions.$inferSelect.status) : undefined,
          q.user_id ? eq(billingSubscriptions.userId, q.user_id) : undefined,
          q.plan_code ? eq(billingPlans.code, q.plan_code) : undefined,
          q.program ? eq(billingSubscriptions.programCode, q.program) : undefined,
          q.expiring_within_days ? and(inArray(billingSubscriptions.status, ['active', 'trialing']), gte(billingSubscriptions.currentPeriodEnd, now), lt(billingSubscriptions.currentPeriodEnd, new Date(now.getTime() + q.expiring_within_days * 86_400_000))) : undefined,
          c ? sql`(${billingSubscriptions.createdAt}, ${billingSubscriptions.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(billingSubscriptions.createdAt), desc(billingSubscriptions.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: page.map((r) => ({ ...this.subscriptions.toDto(r.s, r.p, now), user_id: r.s.userId, created_at: r.s.createdAt.toISOString() })), next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.s.createdAt.toISOString(), id: last.s.id }) : null };
  }
}
