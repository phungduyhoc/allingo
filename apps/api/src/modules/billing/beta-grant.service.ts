import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { DbOrTx } from '../../shared/db/db.module.js';
import { Conflict } from '../../shared/http/errors.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { FulfillmentService } from './fulfillment.service.js';

const { billingPlans, billingCreditLedger } = schema;

export interface BetaGrantInput {
  inviteId: string;
  program: string;
  trialDays: number;
  credits: number;
  creditValidDays: number;
  now: Date;
}

export interface BetaGrantResult {
  subscription_id: string | null;
  trial_ends_at: string | null;
  trial_skipped: 'already_pro' | null;
  credits_granted: number;
  ledger_id: number | null;
  balance: number;
}

/**
 * Quyền lợi beta tester (S12) – gọi trong transaction của growth (đổi mã mời): Pro dùng thử `trialDays` ngày (subscription
 * `trialing`, entitlement nguồn `trial`, gói `<program>_pro_monthly` – KHÔNG qua billing.promotions nên không chiếm lượt trial
 * 7 ngày, xem A196) + lô credit `promo` (ref_type `beta_invite`, ref_id = invite, có hạn). Idempotent theo ref (đổi lại → 0).
 * Đã có Pro còn hạn → chỉ cộng credit (`trial_skipped = already_pro`). Caller xoá cache entitlement sau commit.
 */
@Injectable()
export class BetaGrantService {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly credits: CreditService,
    private readonly entitlements: EntitlementService,
  ) {}

  async grant(tx: DbOrTx, userId: string, input: BetaGrantInput): Promise<BetaGrantResult> {
    const [done] = await tx
      .select({ id: billingCreditLedger.id })
      .from(billingCreditLedger)
      .where(and(eq(billingCreditLedger.userId, userId), eq(billingCreditLedger.refType, 'beta_invite'), eq(billingCreditLedger.refId, input.inviteId)))
      .limit(1);
    const ctx = await this.entitlements.getContext(userId, input.program);
    let subscriptionId: string | null = null;
    let trialEndsAt: string | null = null;
    let skipped: 'already_pro' | null = null;
    if (ctx.isPro) skipped = 'already_pro';
    else if (!done) {
      const planCode = `${input.program}_pro_monthly`;
      const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.code, planCode)).limit(1);
      if (!plan) throw new Conflict('Beta trial plan is not configured', { reason: 'trial_plan_missing', plan_code: planCode });
      const sub = await this.fulfillment.startTrial(tx, userId, plan, plan.programCodes.length ? input.program : null, input.trialDays, input.now);
      subscriptionId = sub.id;
      trialEndsAt = sub.currentPeriodEnd?.toISOString() ?? null;
    }
    let ledgerId: number | null = done ? Number(done.id) : null;
    let granted = 0;
    if (!done && input.credits > 0) {
      const g = await this.credits.grant(tx, userId, input.credits, 'promo', { refType: 'beta_invite', refId: input.inviteId, note: 'beta_tester', expiresAt: new Date(input.now.getTime() + input.creditValidDays * 86_400_000) });
      ledgerId = g.ledgerId;
      granted = input.credits;
    }
    return { subscription_id: subscriptionId, trial_ends_at: trialEndsAt, trial_skipped: skipped, credits_granted: granted, ledger_id: ledgerId, balance: await this.credits.balance(userId, tx) };
  }
}
