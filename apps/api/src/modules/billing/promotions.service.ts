import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  DEFAULT_PROGRAM,
  DOMAIN_EVENTS,
  promotionConditionsSchema,
  type PromotionAdmin,
  type PromotionCreateInput,
  type PromotionKind,
  type PromotionPatchInput,
  type PromotionRedeemInput,
  type PromotionRedeemResult,
  type PromotionValidateResult,
} from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { UserDirectory } from '../../shared/events/user-directory.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Conflict, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { pgCode } from './pg-code.js';
import { evaluatePromotion, normalizePromoCode, promotionKind, toVnd, type PromotionEvaluation, type PromotionRow } from './pricing.js';
import { addDays } from './subscription-periods.js';

const { billingPromotions, billingPromotionRedemptions, billingOrders, billingPlans, billingEntitlements } = schema;
type SubscriptionRow = typeof schema.billingSubscriptions.$inferSelect;
type PromoDbRow = typeof billingPromotions.$inferSelect;
type OrderRow = typeof billingOrders.$inferSelect;
type PlanRow = typeof billingPlans.$inferSelect;

const PAYABLE = ['pending', 'failed', 'cancelled'] as const;

export interface PromotionPlanContext {
  id: string;
  kind: string;
  programCodes: string[];
}

/**
 * Khuyến mãi đầy đủ (Sprint 8, ADR-0030): loại percent | fixed | credit_bonus | trial_days; điều kiện (gói, loại gói, chương trình,
 * người dùng mới, thời gian, tổng lượt, lượt/người, tổng tối thiểu); không cộng dồn (một mã/đơn).
 *  - POST /orders: khoá hàng mã (FOR UPDATE) → đánh giá → GIỮ LƯỢT (`promotion_redemptions.status = reserved`) cùng transaction
 *    tạo đơn; đơn cũ còn chờ thanh toán của chính người dùng với cùng mã bị thay thế (expired + nhả lượt).
 *  - Thanh toán (PaymentsService.confirm): reserved → redeemed, used_count + 1, credit_bonus cộng credit (ledger `promo`),
 *    outbox `promotion.redeemed`. Đơn hết hạn → released.
 *  - POST /promotions/redeem: trial_days (subscription `trialing` một lần/người – UNIQUE partial) và credit_bonus standalone.
 * Lượt dùng = đã dùng + đang giữ (đơn còn trả được); S7 (trước bảng redemptions) tính đơn paid/refunded có promotion_id.
 */
@Injectable()
export class PromotionsService {
  private readonly logger = getLogger({ component: 'billing.promotions' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly credits: CreditService,
    private readonly fulfillment: FulfillmentService,
    private readonly entitlements: EntitlementService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly users: UserDirectory,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  toRow(p: PromoDbRow): PromotionRow {
    const parsed = promotionConditionsSchema.safeParse(p.conditions ?? {});
    return { id: p.id, code: p.code, kind: promotionKind(p.kind), value: Number(p.value), planIds: p.planIds ?? null, validFrom: p.validFrom, validTo: p.validTo, maxUses: p.maxUses ?? null, usedCount: p.usedCount, perUserLimit: p.perUserLimit, isActive: p.isActive, conditions: parsed.success ? parsed.data : {}, stackable: false, name: (p.name) ?? null };
  }

  async findByCode(code: string, db: DbOrTx = this.dbs.db, lock = false): Promise<PromotionRow | null> {
    const q = db.select().from(billingPromotions).where(eq(billingPromotions.code, normalizePromoCode(code))).limit(1);
    const [p] = lock ? await q.for('update') : await q;
    return p ? this.toRow(p) : null;
  }

  // ------------------------------------------------------------------ lượt dùng
  /** Lượt của người dùng (đã dùng + đang giữ còn hiệu lực; đơn S7 paid/refunded không có hàng redemption) */
  async userUses(userId: string, promotionId: string, now: Date, db: DbOrTx = this.dbs.db): Promise<number> {
    const [r] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select r.id from billing.promotion_redemptions r left join billing.orders o on o.id = r.order_id
        where r.promotion_id = ${promotionId} and r.user_id = ${userId}
          and (r.status = 'redeemed' or (r.status = 'reserved' and o.status in ('pending','failed','cancelled') and o.expires_at > ${now.toISOString()}::timestamptz))
        union all
        select o.id from billing.orders o
        where o.user_id = ${userId} and o.promotion_id = ${promotionId} and o.status in ('paid','refunded')
          and not exists (select 1 from billing.promotion_redemptions r2 where r2.order_id = o.id)
      ) x`);
    return r?.n ?? 0;
  }

  /** @deprecated S7 – giữ cho tương thích: đơn đã thanh toán có mã */
  async userPaidUses(userId: string, promotionId: string, db: DbOrTx = this.dbs.db): Promise<number> {
    return this.userUses(userId, promotionId, this.now(), db);
  }

  /** Lượt đang giữ toàn hệ thống (đơn chờ thanh toán còn hạn) – cộng used_count khi so max_uses */
  private async activeReservations(promotionId: string, now: Date, db: DbOrTx): Promise<number> {
    const [r] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from billing.promotion_redemptions r join billing.orders o on o.id = r.order_id
      where r.promotion_id = ${promotionId} and r.status = 'reserved' and o.status in ('pending','failed','cancelled') and o.expires_at > ${now.toISOString()}::timestamptz`);
    return r?.n ?? 0;
  }

  private async userContext(userId: string, db: DbOrTx): Promise<{ createdAt: Date; isGuest: boolean; paidOrders: number }> {
    const c = await this.users.contact(userId);
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(billingOrders)
      .where(and(eq(billingOrders.userId, userId), inArray(billingOrders.status, ['paid', 'refunded'])));
    return { createdAt: c?.createdAt ?? new Date(0), isGuest: c?.isGuest ?? false, paidOrders: r?.n ?? 0 };
  }

  /** Trial đã dùng (redemption trial_days hoặc entitlement nguồn `trial` bất kỳ lúc nào) */
  private async trialUsed(userId: string, db: DbOrTx): Promise<boolean> {
    const [r] = await db.execute<{ used: boolean }>(sql`
      select (exists (select 1 from billing.promotion_redemptions where user_id = ${userId} and kind = 'trial_days' and status = 'redeemed')
           or exists (select 1 from billing.entitlements where user_id = ${userId} and source = 'trial')) as used`);
    return !!r?.used;
  }

  // ------------------------------------------------------------------ đánh giá
  async evaluate(userId: string | null, code: string, plan: PromotionPlanContext | null, subtotal: number, now: Date, db: DbOrTx = this.dbs.db, opts: { mode?: 'order' | 'redeem'; program?: string | null; lock?: boolean } = {}): Promise<{ promo: PromotionRow | null; result: PromotionEvaluation }> {
    const promo = await this.findByCode(code, db, opts.lock);
    const mode = opts.mode ?? (plan ? 'order' : 'redeem');
    if (!promo) return { promo, result: evaluatePromotion(null, { subtotal, now, userPaidUses: 0, mode }) };
    // S10: ẩn danh (validate trên /pricing) – chỉ điều kiện không phụ thuộc người dùng (A169)
    if (!userId) return { promo, result: evaluatePromotion(promo, { mode, planId: plan ? plan.id : null, planKind: plan?.kind ?? null, planPrograms: plan?.programCodes ?? null, subtotal, now, userPaidUses: 0, activeReservations: await this.activeReservations(promo.id, now, db), program: opts.program ?? promo.conditions?.program_codes?.[0] ?? DEFAULT_PROGRAM }) };
    const [uses, reserved, user] = await Promise.all([this.userUses(userId, promo.id, now, db), this.activeReservations(promo.id, now, db), this.userContext(userId, db)]);
    let trialUsed = false;
    let alreadyPro = false;
    const program = opts.program ?? promo.conditions?.program_codes?.[0] ?? DEFAULT_PROGRAM;
    if (promo.kind === 'trial_days') {
      trialUsed = await this.trialUsed(userId, db);
      alreadyPro = (await this.entitlements.getContext(userId, program)).isPro;
    }
    const result = evaluatePromotion(promo, { mode, planId: plan ? plan.id : null, planKind: plan?.kind ?? null, planPrograms: plan?.programCodes ?? null, subtotal, now, userPaidUses: uses, activeReservations: reserved, user, program, trialUsed, alreadyPro });
    return { promo, result };
  }

  /** POST /promotions/validate – luôn 200; không có gói → đánh giá như đổi mã (trial/credit standalone) */
  async validate(userId: string | null, code: string, plan: PromotionPlanContext | null, subtotal: number, now: Date, program?: string): Promise<PromotionValidateResult> {
    const { promo, result } = await this.evaluate(userId, code, plan, subtotal, now, this.dbs.db, { mode: plan ? 'order' : 'redeem', program: program ?? null });
    let reason = result.ok ? null : result.reason;
    // Mã cần đơn nhưng gọi validate không có gói → plan_required (không phải requires_order)
    if (!plan && reason === 'requires_order') reason = 'plan_required';
    // Ẩn danh: điều kiện theo người dùng chưa kiểm (mọi mã có lượt/người; người dùng mới; dùng thử một lần/người)
    const requiresLogin = !userId && !!promo && result.ok;
    return {
      valid: result.ok,
      ...(userId ? {} : { requires_login: requiresLogin }),
      code: normalizePromoCode(code),
      reason,
      kind: promo ? (promotionKind(promo.kind)) : null,
      value: promo ? promo.value : null,
      subtotal: result.computation.subtotal,
      discount: result.computation.discount,
      total: result.computation.total,
      currency: 'VND',
      promotion_id: promo?.id ?? null,
      name: promo?.name ?? null,
      applies_to: result.appliesTo,
      bonus_credits: result.ok ? (result.computation.bonusCredits ?? 0) : 0,
      trial_days: promo && promotionKind(promo.kind) === 'trial_days' ? Math.floor(promo.value) : null,
      stackable: false,
    };
  }

  // ------------------------------------------------------------------ áp vào đơn
  /**
   * Trong transaction tạo đơn: khoá hàng mã, thay thế đơn cũ còn chờ của chính người dùng cùng mã, đánh giá.
   * Ném ValidationFailed (`details.promotion = {code, reason}`) khi không áp dụng được.
   */
  async lockForOrder(tx: DbOrTx, userId: string, code: string, plan: PromotionPlanContext, subtotal: number, now: Date): Promise<{ promo: PromotionRow; discount: number; bonusCredits: number; superseded: string[] }> {
    const promo = await this.findByCode(code, tx, true);
    let superseded: string[] = [];
    if (promo) {
      const rows = await tx.execute<{ id: string }>(sql`
        update billing.orders o set status = 'expired'
        from billing.promotion_redemptions r
        where r.order_id = o.id and r.promotion_id = ${promo.id} and r.user_id = ${userId} and r.status = 'reserved'
          and o.status in ('pending','failed','cancelled')
        returning o.id`);
      superseded = [...rows].map((r) => r.id);
      if (superseded.length) await this.releaseForOrders(superseded, tx, now);
    }
    const { result } = await this.evaluate(userId, code, plan, subtotal, now, tx, { mode: 'order' });
    if (!promo || !result.ok) {
      throw new ValidationFailed({ promotion: { code: normalizePromoCode(code), reason: result.ok ? 'not_found' : result.reason }, issues: [{ path: 'promotion_code', message: `promotion not applicable: ${result.ok ? 'not_found' : result.reason}`, code: 'promotion_invalid' }] });
    }
    if (superseded.length) this.logger.info({ promotion: promo.code, superseded: superseded.length }, 'pending orders superseded by a new order with the same code');
    return { promo, discount: result.computation.discount, bonusCredits: result.computation.bonusCredits ?? 0, superseded };
  }

  /** Giữ lượt cho đơn vừa tạo (cùng transaction) */
  async reserve(tx: DbOrTx, promo: PromotionRow, userId: string, orderId: string, discount: number, bonusCredits: number): Promise<void> {
    await tx.insert(billingPromotionRedemptions).values({ promotionId: promo.id, userId, orderId, kind: promotionKind(promo.kind), status: 'reserved', discount: String(discount), credits: bonusCredits });
  }

  /** Nhả lượt của các đơn hết hạn/bị thay thế */
  async releaseForOrders(orderIds: string[], db: DbOrTx = this.dbs.db, now: Date = this.now()): Promise<number> {
    if (!orderIds.length) return 0;
    const r = await db
      .update(billingPromotionRedemptions)
      .set({ status: 'released', releasedAt: now })
      .where(and(inArray(billingPromotionRedemptions.orderId, orderIds), eq(billingPromotionRedemptions.status, 'reserved')))
      .returning({ id: billingPromotionRedemptions.id });
    return r.length;
  }

  /**
   * Đơn được thanh toán (trong transaction xác nhận): used_count + 1, reserved → redeemed (không có → tạo – đơn S7/bị thay thế
   * nhưng vẫn trả tiền), credit_bonus cộng credit (ledger `promo`, lô hết hạn theo credit_valid_days), outbox `promotion.redeemed`.
   */
  async onOrderPaid(tx: DbOrTx, order: OrderRow, now: Date): Promise<{ bonusCredits: number; code: string | null }> {
    if (!order.promotionId) return { bonusCredits: 0, code: null };
    const [p] = await tx.select().from(billingPromotions).where(eq(billingPromotions.id, order.promotionId)).limit(1);
    if (!p) return { bonusCredits: 0, code: null };
    const promo = this.toRow(p);
    await tx.update(billingPromotions).set({ usedCount: sql`${billingPromotions.usedCount} + 1` }).where(eq(billingPromotions.id, promo.id));
    const kind = promotionKind(promo.kind);
    const bonus = kind === 'credit_bonus' ? Math.floor(promo.value) : 0;
    const [u] = await tx
      .update(billingPromotionRedemptions)
      .set({ status: 'redeemed', redeemedAt: now, credits: bonus })
      .where(eq(billingPromotionRedemptions.orderId, order.id))
      .returning({ id: billingPromotionRedemptions.id });
    if (!u) await tx.insert(billingPromotionRedemptions).values({ promotionId: promo.id, userId: order.userId, orderId: order.id, kind, status: 'redeemed', discount: order.discount, credits: bonus, redeemedAt: now });
    if (bonus > 0) await this.credits.grant(tx, order.userId, bonus, 'promo', { refType: 'promotion', refId: order.id, note: `code=${promo.code}`, expiresAt: addDays(now, promo.conditions?.credit_valid_days ?? 365) });
    await this.outbox.write(tx, { aggregateType: 'promotion', aggregateId: promo.id, eventType: DOMAIN_EVENTS.PROMOTION_REDEEMED, payload: { promotion_id: promo.id, code: promo.code, kind, user_id: order.userId, order_id: order.id, discount: toVnd(order.discount), credits: bonus } });
    return { bonusCredits: bonus, code: promo.code };
  }

  /** @deprecated S7 – dùng onOrderPaid */
  async markUsed(tx: DbOrTx, promotionId: string): Promise<void> {
    await tx.update(billingPromotions).set({ usedCount: sql`${billingPromotions.usedCount} + 1` }).where(eq(billingPromotions.id, promotionId));
  }

  // ------------------------------------------------------------------ đổi mã (trial / credit)
  async redeem(user: { id: string; isGuest: boolean; roles: string[] }, input: PromotionRedeemInput, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<PromotionRedeemResult> {
    const now = this.now();
    const code = normalizePromoCode(input.code);
    let events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    let out: PromotionRedeemResult;
    try {
      out = await this.dbs.db.transaction(async (tx) => {
        const program = input.program ?? null;
        const { promo, result } = await this.evaluate(user.id, code, null, 0, now, tx, { mode: 'redeem', program, lock: true });
        if (!promo || !result.ok) throw new ValidationFailed({ promotion: { code, reason: result.ok ? 'not_found' : result.reason }, issues: [{ path: 'code', message: `promotion not redeemable: ${result.ok ? 'not_found' : result.reason}`, code: 'promotion_invalid' }] });
        const kind = promotionKind(promo.kind);
        await tx.update(billingPromotions).set({ usedCount: sql`${billingPromotions.usedCount} + 1` }).where(eq(billingPromotions.id, promo.id));
        if (kind === 'trial_days') {
          const prog = program ?? promo.conditions?.program_codes?.[0] ?? DEFAULT_PROGRAM;
          const planCode = promo.conditions?.trial_plan_code ?? `${prog}_pro_monthly`;
          const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.code, planCode)).limit(1);
          if (!plan) throw new Conflict('Trial plan is not configured', { reason: 'trial_plan_missing', plan_code: planCode });
          const days = result.computation.trialDays ?? Math.floor(promo.value);
          const sub = await this.fulfillment.startTrial(tx, user.id, plan, plan.programCodes.length ? prog : null, days, now);
          const [red] = await tx.insert(billingPromotionRedemptions).values({ promotionId: promo.id, userId: user.id, kind, status: 'redeemed', subscriptionId: sub.id, redeemedAt: now }).returning({ id: billingPromotionRedemptions.id });
          const trialPayload = { subscription_id: sub.id, user_id: user.id, plan_code: plan.code, plan_name: plan.name, program: sub.programCode ?? null, trial_days: days, period_end: sub.currentPeriodEnd!.toISOString(), promotion_code: promo.code, dedupe_key: `sub:${sub.id}:trial_started` };
          await this.outbox.write(tx, { aggregateType: 'subscription', aggregateId: sub.id, eventType: DOMAIN_EVENTS.SUBSCRIPTION_TRIAL_STARTED, payload: trialPayload });
          const redeemed = { promotion_id: promo.id, code: promo.code, kind, user_id: user.id, order_id: null, subscription_id: sub.id, discount: 0, credits: 0 };
          await this.outbox.write(tx, { aggregateType: 'promotion', aggregateId: promo.id, eventType: DOMAIN_EVENTS.PROMOTION_REDEEMED, payload: redeemed });
          await this.audit.log({ action: 'promotion.redeem', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'promotion', entityId: promo.id, after: { kind, subscription_id: sub.id, trial_days: days, program: sub.programCode ?? null }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
          events = [
            { type: DOMAIN_EVENTS.SUBSCRIPTION_TRIAL_STARTED, payload: trialPayload },
            { type: DOMAIN_EVENTS.PROMOTION_REDEEMED, payload: redeemed },
          ];
          const [planRow] = await tx.select().from(billingPlans).where(eq(billingPlans.id, sub.planId)).limit(1);
          return { code: promo.code, kind: 'trial_days' as const, redemption_id: red!.id, credits_granted: 0, balance: await this.credits.balance(user.id, tx), subscription: this.subscriptionDto(sub, planRow!, now), trial_ends_at: sub.currentPeriodEnd!.toISOString() };
        }
        const credits = result.computation.bonusCredits ?? Math.floor(promo.value);
        const [red] = await tx.insert(billingPromotionRedemptions).values({ promotionId: promo.id, userId: user.id, kind, status: 'redeemed', credits, redeemedAt: now }).returning({ id: billingPromotionRedemptions.id });
        const g = await this.credits.grant(tx, user.id, credits, 'promo', { refType: 'promotion', refId: red!.id, note: `code=${promo.code}`, expiresAt: addDays(now, promo.conditions?.credit_valid_days ?? 365) });
        const redeemed = { promotion_id: promo.id, code: promo.code, kind, user_id: user.id, order_id: null, discount: 0, credits };
        await this.outbox.write(tx, { aggregateType: 'promotion', aggregateId: promo.id, eventType: DOMAIN_EVENTS.PROMOTION_REDEEMED, payload: redeemed });
        await this.audit.log({ action: 'promotion.redeem', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'promotion', entityId: promo.id, after: { kind, credits }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
        events = [{ type: DOMAIN_EVENTS.PROMOTION_REDEEMED, payload: redeemed }];
        return { code: promo.code, kind: 'credit_bonus' as const, redemption_id: red!.id, credits_granted: credits, balance: g.balanceAfter, subscription: null, trial_ends_at: null };
      });
    } catch (err) {
      // Hai lần đổi trial đồng thời → UNIQUE partial ux_promotion_redemptions_trial_once
      if (pgCode(err) === '23505') throw new ValidationFailed({ promotion: { code, reason: 'trial_already_used' }, issues: [{ path: 'code', message: 'promotion not redeemable: trial_already_used', code: 'promotion_invalid' }] });
      throw err;
    }
    await this.entitlements.invalidate(user.id);
    for (const e of events) this.outbox.emitLocal(e.type, e.payload);
    this.outbox.emitLocal('credits.changed', { user_id: user.id, balance: out.balance });
    if (out.kind === 'trial_days') this.outbox.emitLocal('entitlements.changed', { user_id: user.id });
    this.logger.info({ promotion: out.code, kind: out.kind }, 'promotion redeemed');
    return out;
  }

  private subscriptionDto(s: SubscriptionRow, plan: PlanRow, now: Date) {
    const started = s.currentPeriodStart <= now;
    const notEnded = !s.currentPeriodEnd || s.currentPeriodEnd > now;
    return {
      id: s.id,
      plan: { id: plan.id, code: plan.code, kind: plan.kind, programs: plan.programCodes.filter(Boolean), name: plan.name, credits_included: plan.creditsIncluded, credits_period: plan.creditsPeriod ?? null, duration_days: plan.durationDays ?? null },
      program: s.programCode ?? null,
      status: s.status,
      current_period_start: s.currentPeriodStart.toISOString(),
      current_period_end: s.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      is_current: started && notEnded,
      upcoming: !started,
      days_left: s.currentPeriodEnd ? Math.max(0, Math.ceil((s.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000)) : null,
      source_order_id: s.sourceOrderId ?? null,
    };
  }

  // ------------------------------------------------------------------ admin CRUD
  private async planIdsFor(codes: string[] | undefined, db: DbOrTx): Promise<string[] | null | undefined> {
    if (codes === undefined) return undefined;
    if (!codes.length) return null;
    const rows = await db.select({ id: billingPlans.id, code: billingPlans.code }).from(billingPlans).where(inArray(billingPlans.code, codes));
    const missing = codes.filter((c) => !rows.some((r) => r.code === c));
    if (missing.length) throw new ValidationFailed({ issues: [{ path: 'plan_codes', message: `unknown plan codes: ${missing.join(', ')}`, code: 'unknown_plan' }] });
    return rows.map((r) => r.id);
  }

  private async toAdmin(rows: PromoDbRow[]): Promise<PromotionAdmin[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const planIds = [...new Set(rows.flatMap((r) => r.planIds ?? []))];
    const [plans, stats] = await Promise.all([
      planIds.length ? this.dbs.db.select({ id: billingPlans.id, code: billingPlans.code }).from(billingPlans).where(inArray(billingPlans.id, planIds)) : Promise.resolve([] as Array<{ id: string; code: string }>),
      this.dbs.db
        .select({ promotionId: billingPromotionRedemptions.promotionId, status: billingPromotionRedemptions.status, n: sql<number>`count(*)::int`, discount: sql<string>`coalesce(sum(${billingPromotionRedemptions.discount}), 0)::text`, credits: sql<number>`coalesce(sum(${billingPromotionRedemptions.credits}), 0)::int` })
        .from(billingPromotionRedemptions)
        .where(inArray(billingPromotionRedemptions.promotionId, ids))
        .groupBy(billingPromotionRedemptions.promotionId, billingPromotionRedemptions.status),
    ]);
    const planCode = new Map(plans.map((p) => [p.id, p.code]));
    return rows.map((r) => {
      const row = this.toRow(r);
      const s = stats.filter((x) => x.promotionId === r.id);
      const by = (st: string) => s.find((x) => x.status === st);
      return {
        id: r.id,
        code: r.code,
        kind: row.kind as PromotionKind,
        value: row.value,
        name: (r.name) ?? null,
        plan_ids: r.planIds ?? [],
        plan_codes: (r.planIds ?? []).map((id) => planCode.get(id) ?? id),
        conditions: row.conditions ?? {},
        valid_from: r.validFrom.toISOString(),
        valid_to: r.validTo.toISOString(),
        max_uses: r.maxUses ?? null,
        used_count: r.usedCount,
        per_user_limit: r.perUserLimit,
        is_active: r.isActive,
        stackable: false,
        stats: { reserved: by('reserved')?.n ?? 0, redeemed: by('redeemed')?.n ?? 0, released: by('released')?.n ?? 0, discount_total: Number(by('redeemed')?.discount ?? 0), credits_total: by('redeemed')?.credits ?? 0 },
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      };
    });
  }

  async adminList(q: { active?: boolean; kind?: PromotionKind; q?: string; cursor?: string; limit: number }): Promise<{ data: PromotionAdmin[]; next_cursor: string | null }> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const rows = await this.dbs.db
      .select()
      .from(billingPromotions)
      .where(
        and(
          q.active === undefined ? undefined : eq(billingPromotions.isActive, q.active),
          q.kind ? (q.kind === 'fixed' ? inArray(billingPromotions.kind, ['fixed', 'amount']) : eq(billingPromotions.kind, q.kind)) : undefined,
          q.q ? ilike(billingPromotions.code, `%${q.q.replace(/[%_\\]/g, '')}%`) : undefined,
          c ? sql`(${billingPromotions.createdAt}, ${billingPromotions.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(billingPromotions.createdAt), desc(billingPromotions.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: await this.toAdmin(page), next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null };
  }

  async adminGet(id: string): Promise<PromotionAdmin> {
    const [r] = await this.dbs.db.select().from(billingPromotions).where(eq(billingPromotions.id, id)).limit(1);
    if (!r) throw new NotFound('promotion', id);
    return (await this.toAdmin([r]))[0]!;
  }

  async adminCreate(input: PromotionCreateInput, actor: { id: string; roles: string[] }, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<PromotionAdmin> {
    const planIds = await this.planIdsFor(input.plan_codes, this.dbs.db);
    try {
      const [row] = await this.dbs.db
        .insert(billingPromotions)
        .values({ code: input.code, kind: input.kind, value: String(input.value), name: input.name ?? null, planIds: planIds ?? null, validFrom: new Date(input.valid_from), validTo: new Date(input.valid_to), maxUses: input.max_uses ?? null, perUserLimit: input.per_user_limit, isActive: input.is_active, conditions: input.conditions ?? {}, stackable: false })
        .returning();
      await this.audit.log({ action: 'promotion.create', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'promotion', entityId: row!.id, after: { code: row!.code, kind: row!.kind, value: input.value, plan_codes: input.plan_codes ?? [], conditions: input.conditions ?? {}, max_uses: input.max_uses ?? null, per_user_limit: input.per_user_limit }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
      return (await this.toAdmin([row!]))[0]!;
    } catch (err) {
      if (pgCode(err) === '23505') throw new Conflict('Promotion code already exists', { reason: 'code_taken', code: input.code });
      throw err;
    }
  }

  async adminPatch(id: string, input: PromotionPatchInput, actor: { id: string; roles: string[] }, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<PromotionAdmin> {
    const [before] = await this.dbs.db.select().from(billingPromotions).where(eq(billingPromotions.id, id)).limit(1);
    if (!before) throw new NotFound('promotion', id);
    const planIds = await this.planIdsFor(input.plan_codes, this.dbs.db);
    const kind = input.kind ?? promotionKind(before.kind);
    const value = input.value ?? Number(before.value);
    const from = input.valid_from ? new Date(input.valid_from) : before.validFrom;
    const to = input.valid_to ? new Date(input.valid_to) : before.validTo;
    if (to <= from) throw new ValidationFailed({ issues: [{ path: 'valid_to', message: 'valid_to must be after valid_from', code: 'invalid_range' }] });
    if ((kind === 'percent' && value > 100) || (kind === 'trial_days' && value > 90)) throw new ValidationFailed({ issues: [{ path: 'value', message: `value out of range for kind ${kind}`, code: 'invalid_value' }] });
    const [row] = await this.dbs.db
      .update(billingPromotions)
      .set({
        kind,
        value: String(value),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(planIds !== undefined ? { planIds } : {}),
        validFrom: from,
        validTo: to,
        ...(input.max_uses !== undefined ? { maxUses: input.max_uses } : {}),
        ...(input.per_user_limit !== undefined ? { perUserLimit: input.per_user_limit } : {}),
        ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
        updatedAt: new Date(),
      })
      .where(eq(billingPromotions.id, id))
      .returning();
    await this.audit.log({ action: 'promotion.update', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'promotion', entityId: id, before: { kind: before.kind, value: Number(before.value), is_active: before.isActive, valid_to: before.validTo.toISOString(), max_uses: before.maxUses ?? null }, after: { ...input }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    return (await this.toAdmin([row!]))[0]!;
  }

  /** Danh sách trial đang hiệu lực (cho admin/kiểm tra) */
  async trialEntitlements(userId: string) {
    return this.dbs.db.select().from(billingEntitlements).where(and(eq(billingEntitlements.userId, userId), eq(billingEntitlements.source, 'trial'))).orderBy(asc(billingEntitlements.validFrom));
  }
}

export { PAYABLE as PROMO_PAYABLE_STATUSES };
