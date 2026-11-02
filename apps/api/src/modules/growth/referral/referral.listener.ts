import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import type { OutboxEvent } from '../../../shared/events/outbox.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { NotificationService } from '../notify/notification.service.js';
import { ReferralService } from './referral.service.js';

type Registered = { user_id?: string; referral_code?: string | null; device_fp?: string | null; ip?: string | null };
type Graded = { user_id?: string };
type Paid = { user_id?: string; plan_kind?: string };
type Rewarded = { referral_id: string; stage: 'started' | 'upgraded'; referrer_user_id: string; referee_user_id: string; referrer_credits: number; referee_credits: number };

/** Chuỗi referral qua outbox (S8): nghe `local.*` (cùng process) và `outbox.*` (relay worker) – mọi bước idempotent */
@Injectable()
export class ReferralListener {
  private readonly logger = getLogger({ component: 'growth.referral' });
  constructor(
    private readonly referrals: ReferralService,
    private readonly notifications: NotificationService,
  ) {}

  private async safe(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn({ what, err: (err as Error).message.slice(0, 200) }, 'referral handler failed');
    }
  }

  @OnEvent(`local.${DOMAIN_EVENTS.USER_REGISTERED}`)
  onRegisteredLocal(p: Registered): Promise<void> {
    return this.safe('registered', () => this.referrals.onRegistered(p));
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.USER_REGISTERED}`)
  onRegisteredOutbox(ev: OutboxEvent<Registered>): Promise<void> {
    return this.safe('registered', () => this.referrals.onRegistered(ev?.payload));
  }

  @OnEvent(`local.${DOMAIN_EVENTS.ATTEMPT_GRADED}`)
  onGradedLocal(p: Graded): Promise<void> {
    return this.safe('graded', () => this.referrals.onAttemptGraded(p));
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.ATTEMPT_GRADED}`)
  onGradedOutbox(ev: OutboxEvent<Graded>): Promise<void> {
    return this.safe('graded', () => this.referrals.onAttemptGraded(ev?.payload));
  }

  @OnEvent(`local.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidLocal(p: Paid): Promise<void> {
    return this.safe('paid', () => this.referrals.onOrderPaid(p));
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidOutbox(ev: OutboxEvent<Paid>): Promise<void> {
    return this.safe('paid', () => this.referrals.onOrderPaid(ev?.payload));
  }

  private rewarded(p: Rewarded | undefined): Promise<void> {
    if (!p?.referral_id) return Promise.resolve();
    return this.safe('rewarded', async () => {
      if (p.referrer_credits > 0) await this.notifications.send(p.referrer_user_id, 'growth.referral_rewarded', { credits: p.referrer_credits, stage: p.stage, is_referrer: true, referral_id: p.referral_id }, { dedupeKey: `referral:${p.referral_id}:${p.stage}:referrer` });
      if (p.referee_credits > 0) await this.notifications.send(p.referee_user_id, 'growth.referral_rewarded', { credits: p.referee_credits, stage: p.stage, is_referrer: false, referral_id: p.referral_id }, { dedupeKey: `referral:${p.referral_id}:${p.stage}:referee` });
    });
  }

  @OnEvent(`local.${DOMAIN_EVENTS.REFERRAL_REWARDED}`)
  onRewardedLocal(p: Rewarded): Promise<void> {
    return this.rewarded(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.REFERRAL_REWARDED}`)
  onRewardedOutbox(ev: OutboxEvent<Rewarded>): Promise<void> {
    return this.rewarded(ev?.payload);
  }
}
