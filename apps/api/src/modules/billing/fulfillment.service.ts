import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { CREDIT_PACK_VALID_MONTHS } from '@allingo/schemas';
import type { DbOrTx } from '../../shared/db/db.module.js';
import { CreditService } from './credit.service.js';
import { enabledFeatures, type PlanRow } from './plans.service.js';
import { addDays, addMonths, dueCreditWindows } from './subscription-periods.js';

const { billingSubscriptions, billingEntitlements, billingCreditLedger } = schema;
type OrderRow = typeof schema.billingOrders.$inferSelect;
export type SubscriptionRow = typeof billingSubscriptions.$inferSelect;

export interface FulfillmentResult {
  kind: string;
  subscription_id: string | null;
  period_start: string | null;
  period_end: string | null;
  entitlements: number;
  credits_granted: number;
}

/**
 * Cấp quyền khi đơn được thanh toán / thu hồi khi hoàn tiền (Sprint 7). Luôn chạy TRONG transaction xác nhận thanh toán
 * (payments → orders.paid → subscription/entitlements/credit → outbox), không bao giờ sửa số dư trực tiếp (CreditService).
 *
 * - credit_pack: ledger `purchase` (ref order) hết hạn sau 12 tháng.
 * - monthly/yearly/combo: subscription mới; mua lại CÙNG gói khi còn hạn = gia hạn nối tiếp (kỳ mới bắt đầu ở cuối kỳ hiện tại);
 *   entitlements theo (chương trình × tính năng của gói) với valid_from/valid_to = kỳ; credit tháng kỳ 0 cấp ngay nếu kỳ đã bắt đầu
 *   (kỳ sau: job credit.grant_monthly).
 * - lifetime: subscription `lifetime` không hạn, credit `once` cấp một lần.
 */
@Injectable()
export class FulfillmentService {
  constructor(private readonly credits: CreditService) {}

  async grant(tx: DbOrTx, order: OrderRow, plan: PlanRow, now: Date): Promise<FulfillmentResult> {
    if (plan.kind === 'credit_pack') {
      const amount = plan.creditsIncluded * Math.max(1, order.quantity);
      if (amount > 0) await this.credits.grant(tx, order.userId, amount, 'purchase', { refType: 'order', refId: order.id, note: plan.code, expiresAt: addMonths(now, CREDIT_PACK_VALID_MONTHS) });
      return { kind: plan.kind, subscription_id: null, period_start: null, period_end: null, entitlements: 0, credits_granted: amount };
    }
    if (!['monthly', 'yearly', 'lifetime', 'combo'].includes(plan.kind)) throw new Error(`plan kind ${plan.kind} is not fulfillable`);
    const programs = plan.programCodes.filter(Boolean);
    const programCode = programs.length === 1 ? programs[0]! : null;
    const lifetime = plan.kind === 'lifetime' || plan.durationDays === null;
    let start = now;
    if (!lifetime) {
      // Gia hạn nối tiếp: cuối kỳ muộn nhất của subscription CÙNG gói còn hiệu lực/sắp tới
      const [last] = await tx
        .select({ end: billingSubscriptions.currentPeriodEnd })
        .from(billingSubscriptions)
        .where(and(eq(billingSubscriptions.userId, order.userId), eq(billingSubscriptions.planId, plan.id), inArray(billingSubscriptions.status, ['active', 'trialing']), gt(billingSubscriptions.currentPeriodEnd, now)))
        .orderBy(desc(billingSubscriptions.currentPeriodEnd))
        .limit(1)
        .for('update');
      if (last?.end && last.end > now) start = last.end;
    }
    const end = lifetime ? null : addDays(start, plan.durationDays!);
    const [sub] = await tx
      .insert(billingSubscriptions)
      .values({ userId: order.userId, planId: plan.id, programCode, status: lifetime ? 'lifetime' : 'active', currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: false, sourceOrderId: order.id, updatedAt: now })
      .returning();
    const features = enabledFeatures(plan);
    const rows = (programs.length ? programs : [null]).flatMap((p) => features.map((f) => ({ userId: order.userId, programCode: p, featureCode: f, source: 'subscription', sourceId: sub!.id, validFrom: start, validTo: end })));
    if (rows.length) await tx.insert(billingEntitlements).values(rows).onConflictDoNothing();
    const credits = await this.grantDueCredits(tx, sub!, plan, now);
    return { kind: plan.kind, subscription_id: sub!.id, period_start: start.toISOString(), period_end: end?.toISOString() ?? null, entitlements: rows.length, credits_granted: credits };
  }

  /**
   * Cấp credit đến hạn của một subscription (idempotent theo (subscription_id, period) = số dòng subscription_grant đã có;
   * gọi khi đã khoá hàng subscription hoặc trong tx tạo nó). monthly → mỗi kỳ 30 ngày; once → một lần khi kỳ bắt đầu.
   */
  async grantDueCredits(tx: DbOrTx, sub: SubscriptionRow, plan: PlanRow, now: Date): Promise<number> {
    if (!sub.userId || plan.creditsIncluded <= 0) return 0;
    if (sub.currentPeriodStart > now) return 0;
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(billingCreditLedger)
      .where(and(eq(billingCreditLedger.userId, sub.userId), eq(billingCreditLedger.reason, 'subscription_grant'), eq(billingCreditLedger.refType, 'subscription'), eq(billingCreditLedger.refId, sub.id)));
    const due = plan.creditsPeriod === 'monthly' ? dueCreditWindows(sub.currentPeriodStart, sub.currentPeriodEnd, now) : 1;
    let granted = 0;
    for (let k = n; k < due; k++) {
      await this.credits.grant(tx, sub.userId, plan.creditsIncluded, 'subscription_grant', { refType: 'subscription', refId: sub.id, note: plan.creditsPeriod === 'monthly' ? `period=${k}` : 'once' });
      granted += plan.creditsIncluded;
    }
    return granted;
  }

  /**
   * Hoàn tiền: thu hồi subscription (kết thúc ngay) + entitlements + credit còn lại do đơn cấp (không làm số dư âm – A92).
   */
  async revoke(tx: DbOrTx, order: OrderRow, plan: PlanRow, now: Date, opts: { revokeCredits: boolean }): Promise<{ subscriptions: number; entitlements: number; credits_revoked: number; credits_shortfall: number }> {
    let creditsRevoked = 0;
    let shortfall = 0;
    let subs = 0;
    let ents = 0;
    if (plan.kind === 'credit_pack') {
      if (opts.revokeCredits) {
        const remaining = await this.credits.remainingOf(tx, order.userId, { refType: 'order', refId: order.id });
        const granted = plan.creditsIncluded * Math.max(1, order.quantity);
        const r = await this.credits.revoke(tx, order.userId, remaining, 'refund', { refType: 'order', refId: order.id, note: 'order_refund' });
        creditsRevoked += r.revoked;
        shortfall += granted - r.revoked;
      }
      return { subscriptions: 0, entitlements: 0, credits_revoked: creditsRevoked, credits_shortfall: shortfall };
    }
    const rows = await tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.sourceOrderId, order.id)).for('update');
    for (const s of rows) {
      const start = s.currentPeriodStart > now ? now : s.currentPeriodStart;
      await tx.update(billingSubscriptions).set({ status: 'expired', currentPeriodStart: start, currentPeriodEnd: now, cancelAtPeriodEnd: true, updatedAt: now }).where(eq(billingSubscriptions.id, s.id));
      const e = await tx
        .update(billingEntitlements)
        .set({ validTo: now, validFrom: sql`least(${billingEntitlements.validFrom}, ${now.toISOString()}::timestamptz)` })
        .where(and(eq(billingEntitlements.source, 'subscription'), eq(billingEntitlements.sourceId, s.id)))
        .returning({ id: billingEntitlements.id });
      ents += e.length;
      subs++;
      if (opts.revokeCredits && s.userId) {
        const [{ g } = { g: 0 }] = await tx
          .select({ g: sql<number>`coalesce(sum(${billingCreditLedger.delta}), 0)::int` })
          .from(billingCreditLedger)
          .where(and(eq(billingCreditLedger.userId, s.userId), eq(billingCreditLedger.reason, 'subscription_grant'), eq(billingCreditLedger.refType, 'subscription'), eq(billingCreditLedger.refId, s.id)));
        const remaining = await this.credits.remainingOf(tx, s.userId, { refType: 'subscription', refId: s.id });
        const r = await this.credits.revoke(tx, s.userId, remaining, 'refund', { refType: 'subscription', refId: s.id, note: 'order_refund' });
        creditsRevoked += r.revoked;
        shortfall += Math.max(0, g - r.revoked);
      }
    }
    return { subscriptions: subs, entitlements: ents, credits_revoked: creditsRevoked, credits_shortfall: shortfall };
  }
}
