import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import type { OutboxEvent } from '../../shared/events/outbox.service.js';
import { MailerService } from '../../shared/notify/mailer.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { InvoicesService } from '../billing/index.js';
import { UsersService } from '../iam/index.js';
import { NotificationService } from './notify/notification.service.js';

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
  trial?: boolean;
  trial_days?: number;
  dedupe_key: string;
}

interface PaidPayload {
  order_id: string;
  user_id: string;
  plan_code: string;
  plan_name?: Record<string, string>;
  total?: number;
  subscription_id: string | null;
  credits_granted: number;
  bonus_credits?: number;
}

/** Mã template (web dịch in-app `notifications.<template_code>` – CLAUDE.md §5.11; email/push dựng ở server) */
export const BILLING_TEMPLATES = {
  SUBSCRIPTION_EXPIRING: 'billing.subscription_expiring',
  SUBSCRIPTION_EXPIRED: 'billing.subscription_expired',
  ORDER_PAID: 'billing.order_paid',
  INVOICE_ISSUED: 'billing.invoice_issued',
  TRIAL_STARTED: 'billing.trial_started',
  TRIAL_ENDING: 'billing.trial_ending',
  TRIAL_ENDED: 'billing.trial_ended',
  ADMIN_INVOICE_FAILED: 'admin.invoice_failed',
} as const;

/**
 * growth nhận sự kiện billing → NotificationService (S8 – thay in-app đơn kênh S7): nhắc gia hạn 7/3/1 ngày, hết hạn (bỏ qua khi
 * có kỳ nối tiếp), đã thanh toán (biên lai), hoá đơn điện tử (email kèm PDF tới email người mua), dùng thử (bắt đầu/sắp hết/hết),
 * hoá đơn vào dead-letter (admin + OPS_ALERT_EMAIL). Nghe cả `local.*` và `outbox.*`; chống trùng theo `dedupe_key`.
 */
@Injectable()
export class BillingNotificationsListener {
  private readonly logger = getLogger({ component: 'growth.billing-notify' });
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
    private readonly invoices: InvoicesService,
    private readonly users: UsersService,
    private readonly mailer: MailerService,
  ) {}

  private async safe(template: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn({ template, err: (err as Error).message.slice(0, 200) }, 'billing notification failed');
    }
  }

  private subscriptionData(p: SubscriptionEventPayload) {
    return { subscription_id: p.subscription_id, plan_code: p.plan_code, plan_name: p.plan_name ?? p.plan_code, program: p.program, period_end: p.period_end, days_before: p.days_before ?? null, days_left: p.days_left ?? null, trial_days: p.trial_days ?? null };
  }

  private expiring(p: SubscriptionEventPayload | undefined): Promise<void> {
    if (!p?.user_id || !p.dedupe_key) return Promise.resolve();
    const template = p.trial ? BILLING_TEMPLATES.TRIAL_ENDING : BILLING_TEMPLATES.SUBSCRIPTION_EXPIRING;
    return this.safe(template, () => this.notifications.send(p.user_id!, template, this.subscriptionData(p), { dedupeKey: p.dedupe_key }));
  }

  private expired(p: SubscriptionEventPayload | undefined): Promise<void> {
    if (!p?.user_id || !p.dedupe_key || p.has_successor) return Promise.resolve();
    const template = p.trial ? BILLING_TEMPLATES.TRIAL_ENDED : BILLING_TEMPLATES.SUBSCRIPTION_EXPIRED;
    return this.safe(template, () => this.notifications.send(p.user_id!, template, this.subscriptionData(p), { dedupeKey: p.dedupe_key }));
  }

  @OnEvent(`local.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRING}`)
  onExpiringLocal(p: SubscriptionEventPayload): Promise<void> {
    return this.expiring(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRING}`)
  onExpiringOutbox(ev: OutboxEvent<SubscriptionEventPayload>): Promise<void> {
    return this.expiring(ev?.payload);
  }

  @OnEvent(`local.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED}`)
  onExpiredLocal(p: SubscriptionEventPayload): Promise<void> {
    return this.expired(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED}`)
  onExpiredOutbox(ev: OutboxEvent<SubscriptionEventPayload>): Promise<void> {
    return this.expired(ev?.payload);
  }

  private trialStarted(p: SubscriptionEventPayload | undefined): Promise<void> {
    if (!p?.user_id) return Promise.resolve();
    return this.safe(BILLING_TEMPLATES.TRIAL_STARTED, () => this.notifications.send(p.user_id!, BILLING_TEMPLATES.TRIAL_STARTED, this.subscriptionData(p), { dedupeKey: p.dedupe_key ?? `sub:${p.subscription_id}:trial_started` }));
  }

  @OnEvent(`local.${DOMAIN_EVENTS.SUBSCRIPTION_TRIAL_STARTED}`)
  onTrialLocal(p: SubscriptionEventPayload): Promise<void> {
    return this.trialStarted(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.SUBSCRIPTION_TRIAL_STARTED}`)
  onTrialOutbox(ev: OutboxEvent<SubscriptionEventPayload>): Promise<void> {
    return this.trialStarted(ev?.payload);
  }

  private orderPaid(p: PaidPayload | undefined): Promise<void> {
    if (!p?.order_id || !p.user_id) return Promise.resolve();
    const data = { order_id: p.order_id, plan_code: p.plan_code, plan_name: p.plan_name ?? p.plan_code, total: p.total ?? null, credits_granted: p.credits_granted, bonus_credits: p.bonus_credits ?? 0, subscription_id: p.subscription_id };
    return this.safe(BILLING_TEMPLATES.ORDER_PAID, () => this.notifications.send(p.user_id, BILLING_TEMPLATES.ORDER_PAID, data, { dedupeKey: `order:${p.order_id}:paid` }));
  }

  @OnEvent(`local.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidLocal(p: PaidPayload): Promise<void> {
    return this.orderPaid(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidOutbox(ev: OutboxEvent<PaidPayload>): Promise<void> {
    return this.orderPaid(ev?.payload);
  }

  /** Hoá đơn phát hành → email kèm PDF tới email người mua trên hoá đơn (thiếu → email tài khoản) + in-app */
  private invoiceIssued(p: { order_id?: string } | undefined): Promise<void> {
    if (!p?.order_id) return Promise.resolve();
    return this.safe(BILLING_TEMPLATES.INVOICE_ISSUED, async () => {
      const ctx = await this.invoices.emailContext(p.order_id!);
      if (!ctx) return;
      await this.notifications.send(ctx.userId, BILLING_TEMPLATES.INVOICE_ISSUED, ctx.data, { dedupeKey: `invoice:${p.order_id}:issued`, emailTo: ctx.to, attachments: ctx.attachment ? [ctx.attachment] : undefined });
    });
  }

  @OnEvent(`local.${DOMAIN_EVENTS.INVOICE_ISSUED}`)
  onInvoiceLocal(p: { order_id?: string }): Promise<void> {
    return this.invoiceIssued(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.INVOICE_ISSUED}`)
  onInvoiceOutbox(ev: OutboxEvent<{ order_id?: string }>): Promise<void> {
    return this.invoiceIssued(ev?.payload);
  }

  /** Hoá đơn vào dead-letter → mọi admin (in-app + email) và OPS_ALERT_EMAIL */
  private invoiceFailed(p: { order_id?: string; op?: string; attempts?: number; error_code?: string; dedupe_key?: string } | undefined): Promise<void> {
    if (!p?.order_id) return Promise.resolve();
    return this.safe(BILLING_TEMPLATES.ADMIN_INVOICE_FAILED, async () => {
      const data = { order_id: p.order_id, op: p.op ?? 'issue', attempts: p.attempts ?? 0, error_code: p.error_code ?? 'unknown' };
      const dedupe = p.dedupe_key ?? `invoice:${p.order_id}:${data.op}:failed`;
      let fresh = false;
      const admins = await this.users.idsWithRoles(['admin', 'superadmin']);
      for (const adminId of admins) {
        const r = await this.notifications.send(adminId, BILLING_TEMPLATES.ADMIN_INVOICE_FAILED, data, { dedupeKey: dedupe });
        if (r.results.some((x) => x.status !== 'duplicate')) fresh = true;
      }
      // Email vận hành một lần (local + outbox cùng tới: lần sau thấy thông báo admin đã có → bỏ)
      if (this.env.OPS_ALERT_EMAIL && (fresh || !admins.length)) {
        await this.mailer.send({ to: this.env.OPS_ALERT_EMAIL, subject: `[Allingo ops] E-invoice ${data.op} failed – order ${data.order_id}`, text: `Invoice ${data.op} for order ${data.order_id} failed after ${data.attempts} attempts (error ${data.error_code}). See docs/runbooks/invoices.md and GET /v1/admin/billing/dead-letters.` });
      }
    });
  }

  @OnEvent(`local.${DOMAIN_EVENTS.INVOICE_FAILED}`)
  onInvoiceFailedLocal(p: { order_id?: string }): Promise<void> {
    return this.invoiceFailed(p);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.INVOICE_FAILED}`)
  onInvoiceFailedOutbox(ev: OutboxEvent<{ order_id?: string }>): Promise<void> {
    return this.invoiceFailed(ev?.payload);
  }
}
