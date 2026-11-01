import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { GUEST_WELCOME_CREDITS } from '@allingo/schemas';
import type { DbOrTx } from '../../shared/db/db.module.js';
import { CreditService } from '../billing/index.js';

/** Credit khởi điểm: khách nhận GUEST_WELCOME_CREDITS; tài khoản đăng ký nhận credits_included của gói Free (cấp lại hằng tháng – Sprint 7) */
@Injectable()
export class WelcomeCreditsService {
  constructor(private readonly credits: CreditService) {}

  async grant(tx: DbOrTx, userId: string, kind: 'guest' | 'registered'): Promise<void> {
    let amount = GUEST_WELCOME_CREDITS;
    if (kind === 'registered') {
      const [free] = await tx.select({ credits: schema.billingPlans.creditsIncluded }).from(schema.billingPlans).where(eq(schema.billingPlans.code, 'free')).limit(1);
      amount = free?.credits ?? 0;
    }
    if (amount > 0) await this.credits.grant(tx, userId, amount, 'subscription_grant', { refType: 'plan', note: kind === 'guest' ? 'guest_welcome' : 'free_monthly' });
  }
}
