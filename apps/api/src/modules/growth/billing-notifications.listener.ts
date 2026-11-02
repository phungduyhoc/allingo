import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import type { OutboxEvent } from '../../shared/events/outbox.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { NotificationsService } from './notifications.service.js';

interface SubscriptionEventPayload {
  subscription_id: string;
  user_id: string | null;
  plan_code: string;
  plan_name?: Record<string, string>;
  program: string | null;
  period_end: string | null;
  days_before?: number;
  days_left?: number | null;
  has_successor?: boolean;
  dedupe_key: string;
}

/** Mã template in-app (web dịch `notifications.<template_code>` – CLAUDE.md §5.11) */
export const BILLING_TEMPLATES = {
  SUBSCRIPTION_EXPIRING: 'billing.subscription_expiring',
  SUBSCRIPTION_EXPIRED: 'billing.subscription_expired',
  ORDER_PAID: 'billing.order_paid',
} as const;

/**
 * growth nhận sự kiện billing (S7) → `ops.notifications` in-app qua NotificationsService:
 *  - `subscription.expiring` (7/3/1 ngày trước hết kỳ), `subscription.expired` (hạ Free, bỏ qua khi có kỳ nối tiếp), `order.paid`.
 * Nghe cả `local.*` (cùng process, nhanh) lẫn `outbox.*` (relay ở worker); chống trùng theo `dedupe_key`.
 */
@Injectable()
export class BillingNotificationsListener {
  private readonly logger = getLogger({ component: 'growth.billing-notify' });
  constructor(private readonly notifications: NotificationsService) {}

  private async notify(template: string, p: SubscriptionEventPayload | null | undefined, extra: Record<string, unknown> = {}): Promise<void> {
    if (!p?.user_id || !p.dedupe_key) return;
    try {
      const { dedupe_key, ...rest } = p;
      const r = await this.notifications.notifyInApp(p.user_id, { template_code: template, payload: { ...rest, ...extra, url: '/pricing' }, dedupe_key });
      if (r.created) this.logger.info({ template, subscription_id: p.subscription_id }, 'billing notification created');
    } catch (err) {
      this.logger.warn({ template, err: (err as Error).message.slice(0, 200) }, 'billing notification failed');
    }
  }

  @OnEvent(`local.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRING}`)
  onExpiringLocal(p: SubscriptionEventPayload): Promise<void> {
    return this.notify(BILLING_TEMPLATES.SUBSCRIPTION_EXPIRING, p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRING}`)
  onExpiringOutbox(ev: OutboxEvent<SubscriptionEventPayload>): Promise<void> {
    return this.notify(BILLING_TEMPLATES.SUBSCRIPTION_EXPIRING, ev.payload);
  }

  @OnEvent(`local.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED}`)
  onExpiredLocal(p: SubscriptionEventPayload): Promise<void> {
    return p.has_successor ? Promise.resolve() : this.notify(BILLING_TEMPLATES.SUBSCRIPTION_EXPIRED, p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED}`)
  onExpiredOutbox(ev: OutboxEvent<SubscriptionEventPayload>): Promise<void> {
    return ev.payload?.has_successor ? Promise.resolve() : this.notify(BILLING_TEMPLATES.SUBSCRIPTION_EXPIRED, ev.payload);
  }

  private orderPaid(p: { order_id: string; user_id: string; plan_code: string; subscription_id: string | null; credits_granted: number } | undefined): Promise<void> {
    if (!p?.order_id) return Promise.resolve();
    return this.notify(BILLING_TEMPLATES.ORDER_PAID, { subscription_id: p.subscription_id ?? '', user_id: p.user_id, plan_code: p.plan_code, program: null, period_end: null, dedupe_key: `order:${p.order_id}:paid` }, { order_id: p.order_id, credits_granted: p.credits_granted });
  }

  @OnEvent(`local.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidLocal(p: { order_id: string; user_id: string; plan_code: string; subscription_id: string | null; credits_granted: number }): Promise<void> {
    return this.orderPaid(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidOutbox(ev: OutboxEvent<{ order_id: string; user_id: string; plan_code: string; subscription_id: string | null; credits_granted: number }>): Promise<void> {
    return this.orderPaid(ev.payload);
  }
}
