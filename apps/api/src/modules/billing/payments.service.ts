import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { BILLING_REALTIME_EVENTS, DOMAIN_EVENTS } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { FulfillmentService } from './fulfillment.service.js';
import { pgCode, type OrderRow } from './orders.service.js';
import { decodeMerchantRef } from './payments/merchant-ref.js';
import type { ParsedWebhook, PaymentProvider, WebhookAck, WebhookInput, WebhookOutcome } from './payments/payment-provider.js';
import { PaymentProviderRegistry } from './payments/provider-registry.js';
import { toVnd } from './pricing.js';
import { PromotionsService } from './promotions.service.js';

const { billingOrders, billingPayments, billingPlans } = schema;
type PaymentRow = typeof billingPayments.$inferSelect;
const PAYABLE: OrderRow['status'][] = ['pending', 'failed', 'cancelled'];

export type ConfirmSource = 'webhook' | 'reconcile' | 'mock_checkout';

export interface ConfirmResult {
  outcome: WebhookOutcome;
  orderId: string | null;
  paid?: boolean;
}

interface PaidEvent {
  order_id: string;
  user_id: string;
  plan_code: string;
  plan_kind: string;
  total: number;
  currency: string;
  provider: string;
  payment_id: string;
  subscription_id: string | null;
  credits_granted: number;
  source: ConfirmSource;
  late: boolean;
}

/**
 * Webhook-first (ADR-0012, Sprint 7): MỌI quyền được cấp tại đây từ webhook đã xác minh chữ ký hoặc queryStatus.
 * Một transaction, khoá `orders` FOR UPDATE (tuần tự hoá webhook trùng/đồng thời cùng đơn):
 *   payments (idempotent theo UNIQUE (provider, provider_txn_id)) → orders.paid → subscription/entitlements/credit
 *   (ledger `purchase|subscription_grant`) → promotions.used_count → outbox `order.paid` → audit.
 * - Webhook đến trước khi /pay trả về (hoặc không có hàng `initiated`) vẫn đúng: mã tham chiếu suy ra order_id.
 * - Đơn đã hết hạn/thất bại nhưng tiền đã trừ → vẫn ghi nhận và cấp quyền (`late = true`, audit).
 * - Đơn đã trả bằng giao dịch khác → lưu payment `success` + `duplicate_order_payment` (hoàn tiền thủ công – runbook), không cấp lại.
 * - Sai số tiền/tiền tệ → payment `failed` (`amount_mismatch`), không cấp quyền, audit.
 * Return URL chỉ hiển thị trạng thái đọc từ DB.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = getLogger({ component: 'billing.payments' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly providers: PaymentProviderRegistry,
    private readonly fulfillment: FulfillmentService,
    private readonly promotions: PromotionsService,
    private readonly credits: CreditService,
    private readonly entitlements: EntitlementService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  // ------------------------------------------------------------------ webhook
  async handleWebhook(code: string, input: WebhookInput, meta: { ip?: string | null; userAgent?: string | null }): Promise<WebhookAck> {
    const provider = this.providers.forCallback(code);
    let valid = false;
    try {
      valid = provider.verifyWebhook(input);
    } catch {
      valid = false;
    }
    if (!valid) {
      await this.rejectAudit(provider, 'invalid_signature', input, meta);
      return provider.ack('invalid_signature');
    }
    let parsed: ParsedWebhook;
    try {
      parsed = provider.parseWebhook(input);
    } catch (err) {
      await this.rejectAudit(provider, 'invalid_payload', input, meta, (err as Error).message);
      return provider.ack('invalid_payload');
    }
    try {
      const r = await this.confirm(provider, parsed, provider.code === 'mock' && input.headers['x-allingo-source'] === 'mock_checkout' ? 'mock_checkout' : 'webhook');
      return provider.ack(r.outcome);
    } catch (err) {
      this.logger.error({ provider: provider.code, err: (err as Error).message.slice(0, 300) }, 'webhook processing failed');
      return provider.ack('error');
    }
  }

  /** Không ghi payload (có thể giả mạo/chứa dữ liệu lạ) – chỉ cổng, lý do, IP, các khoá tham số */
  private async rejectAudit(provider: PaymentProvider, reason: string, input: WebhookInput, meta: { ip?: string | null; userAgent?: string | null }, detail?: string): Promise<void> {
    const keys = Object.keys(input.body && typeof input.body === 'object' ? input.body : input.query).slice(0, 40);
    this.logger.warn({ provider: provider.code, reason }, 'payment webhook rejected');
    await this.audit
      .log({ action: 'payment.webhook_rejected', entityType: 'payment_webhook', after: { provider: provider.code, reason, method: input.method, keys, detail: detail?.slice(0, 200) ?? null }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null })
      .catch((err: Error) => this.logger.error({ err: err.message }, 'audit failed'));
  }

  /** Lưu kết quả vào hàng `initiated` của lần thanh toán (nếu có), ngược lại tạo hàng mới */
  private async upsertPayment(tx: DbOrTx, attempt: PaymentRow | undefined, order: OrderRow, provider: PaymentProvider, parsed: ParsedWebhook, status: 'success' | 'failed', extra: Record<string, unknown>, now: Date): Promise<PaymentRow> {
    const raw = { ...((attempt?.rawCallback as Record<string, unknown>) ?? { merchant_ref: parsed.merchantRef, provider: provider.code }), phase: 'callback', callback: parsed.raw, provider_code: parsed.providerCode, received_at: now.toISOString(), ...extra };
    const amount = Number.isFinite(parsed.amount) ? String(parsed.amount) : order.total;
    if (attempt && attempt.status === 'initiated') {
      const [u] = await tx
        .update(billingPayments)
        .set({ providerTxnId: parsed.providerTxnId, status, amount, rawCallback: raw, signatureValid: true, confirmedAt: status === 'success' ? now : null })
        .where(eq(billingPayments.id, attempt.id))
        .returning();
      return u!;
    }
    const [p] = await tx
      .insert(billingPayments)
      .values({ orderId: order.id, provider: provider.dbProvider, providerTxnId: parsed.providerTxnId, amount, currency: parsed.currency || order.currency, status, rawCallback: raw, signatureValid: true, createdAt: now, confirmedAt: status === 'success' ? now : null })
      .returning();
    return p!;
  }

  async confirm(provider: PaymentProvider, parsed: ParsedWebhook, source: ConfirmSource): Promise<ConfirmResult> {
    const orderId = decodeMerchantRef(parsed.merchantRef);
    if (!orderId) return { outcome: 'order_not_found', orderId: null };
    const now = this.now();
    let paid: PaidEvent | null = null;
    let statusChange: { userId: string; status: string } | null = null;
    let result: ConfirmResult;
    try {
      result = await this.dbs.db.transaction(async (tx) => {
        const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1).for('update');
        if (!order) return { outcome: 'order_not_found' as const, orderId };
        if (parsed.providerTxnId) {
          const [dup] = await tx.select({ id: billingPayments.id }).from(billingPayments).where(and(eq(billingPayments.provider, provider.dbProvider), eq(billingPayments.providerTxnId, parsed.providerTxnId))).limit(1);
          if (dup) return { outcome: 'duplicate' as const, orderId };
        }
        const [attempt] = await tx
          .select()
          .from(billingPayments)
          .where(and(eq(billingPayments.orderId, order.id), eq(billingPayments.provider, provider.dbProvider), sql`${billingPayments.rawCallback}->>'merchant_ref' = ${parsed.merchantRef}`))
          .orderBy(desc(billingPayments.createdAt))
          .limit(1);
        if (parsed.status === 'pending') return { outcome: 'ok' as const, orderId };

        if (parsed.status === 'paid') {
          const expected = toVnd(order.total);
          if (!Number.isInteger(parsed.amount) || parsed.amount !== expected || parsed.currency !== order.currency.trim()) {
            await this.upsertPayment(tx, attempt, order, provider, parsed, 'failed', { reason: 'amount_mismatch', expected_amount: expected, received_amount: Number.isFinite(parsed.amount) ? parsed.amount : null }, now);
            await this.audit.log({ action: 'payment.amount_mismatch', entityType: 'order', entityId: order.id, after: { provider: provider.code, expected, received: Number.isFinite(parsed.amount) ? parsed.amount : null, currency: parsed.currency, source } }, tx);
            this.logger.warn({ order_id: order.id, provider: provider.code, source }, 'payment amount mismatch');
            return { outcome: 'amount_mismatch' as const, orderId };
          }
          if (order.status === 'paid' || order.status === 'refunded') {
            const p = await this.upsertPayment(tx, attempt, order, provider, parsed, 'success', { duplicate_order_payment: true }, now);
            await this.audit.log({ action: 'payment.duplicate_order_payment', entityType: 'order', entityId: order.id, after: { provider: provider.code, payment_id: p.id, order_status: order.status, source } }, tx);
            this.logger.warn({ order_id: order.id, provider: provider.code }, 'second successful payment for an already paid order – manual refund needed');
            return { outcome: 'already_confirmed' as const, orderId };
          }
          const payment = await this.upsertPayment(tx, attempt, order, provider, parsed, 'success', {}, now);
          const late = order.status === 'expired' || (!!order.expiresAt && order.expiresAt <= now);
          await tx.update(billingOrders).set({ status: 'paid', paidAt: now }).where(eq(billingOrders.id, order.id));
          const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.id, order.planId)).limit(1);
          const f = await this.fulfillment.grant(tx, order, plan!, now);
          if (order.promotionId) await this.promotions.markUsed(tx, order.promotionId);
          paid = { order_id: order.id, user_id: order.userId, plan_code: plan!.code, plan_kind: plan!.kind, total: expected, currency: 'VND', provider: provider.code, payment_id: payment.id, subscription_id: f.subscription_id, credits_granted: f.credits_granted, source, late };
          await this.outbox.write(tx, { aggregateType: 'order', aggregateId: order.id, eventType: DOMAIN_EVENTS.ORDER_PAID, payload: { ...paid } });
          await this.audit.log({ action: 'order.paid', entityType: 'order', entityId: order.id, before: { status: order.status }, after: { ...paid, entitlements: f.entitlements, period_end: f.period_end } }, tx);
          return { outcome: 'ok' as const, orderId, paid: true };
        }

        // failed | cancelled: chỉ đổi trạng thái đơn còn trả được; đơn đã trả/hết hạn chỉ ghi nhận lần thử
        await this.upsertPayment(tx, attempt, order, provider, parsed, 'failed', { reason: parsed.status }, now);
        if (PAYABLE.includes(order.status)) {
          const next = parsed.status === 'cancelled' ? 'cancelled' : 'failed';
          await tx.update(billingOrders).set({ status: next }).where(eq(billingOrders.id, order.id));
          statusChange = { userId: order.userId, status: next };
        }
        return { outcome: 'ok' as const, orderId };
      });
    } catch (err) {
      // Chặn cuối: hai luồng cùng mã GD vượt qua kiểm tra (không xảy ra khi đã khoá đơn) → UNIQUE (provider, provider_txn_id)
      if (pgCode(err) === '23505') return { outcome: 'duplicate', orderId };
      throw err;
    }
    const ev = paid as PaidEvent | null;
    if (ev) {
      await this.entitlements.invalidate(ev.user_id);
      this.outbox.emitLocal(DOMAIN_EVENTS.ORDER_PAID, { ...ev });
      this.outbox.emitLocal(BILLING_REALTIME_EVENTS.ORDER_UPDATED, { user_id: ev.user_id, order_id: ev.order_id, status: 'paid', paid_at: now.toISOString() });
      this.outbox.emitLocal(BILLING_REALTIME_EVENTS.CREDITS_CHANGED, { user_id: ev.user_id, balance: await this.credits.balance(ev.user_id) });
      this.outbox.emitLocal(BILLING_REALTIME_EVENTS.ENTITLEMENTS_CHANGED, { user_id: ev.user_id });
      this.logger.info({ order_id: ev.order_id, provider: ev.provider, source, late: ev.late, credits: ev.credits_granted }, 'order paid');
    }
    const sc = statusChange as { userId: string; status: string } | null;
    if (sc) this.outbox.emitLocal(BILLING_REALTIME_EVENTS.ORDER_UPDATED, { user_id: sc.userId, order_id: orderId, status: sc.status, paid_at: null });
    return result;
  }

  // ------------------------------------------------------------------ return URL (chỉ hiển thị)
  async handleReturn(code: string, query: Record<string, string>): Promise<{ order_id: string | null; status: string; provider: string; provider_status: string | null; signature_valid: boolean; redirect_url: string }> {
    const provider = this.providers.forCallback(code);
    const v = provider.verifyReturn(query);
    const orderId = decodeMerchantRef(v.merchantRef);
    let status = 'unknown';
    let target = `${this.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/checkout/result`;
    if (orderId) {
      const [o] = await this.dbs.db.select({ status: billingOrders.status }).from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
      status = o?.status ?? 'unknown';
      const [attempt] = await this.dbs.db
        .select({ raw: billingPayments.rawCallback })
        .from(billingPayments)
        .where(and(eq(billingPayments.orderId, orderId), sql`${billingPayments.rawCallback}->>'merchant_ref' = ${v.merchantRef}`))
        .limit(1);
      const ru = (attempt?.raw as Record<string, unknown> | undefined)?.return_url;
      if (typeof ru === 'string') target = ru;
    }
    const u = new URL(target);
    if (orderId) u.searchParams.set('order_id', orderId);
    u.searchParams.set('status', status);
    u.searchParams.set('provider', provider.code);
    return { order_id: orderId, status, provider: provider.code, provider_status: v.displayStatus, signature_valid: v.valid, redirect_url: u.toString() };
  }

  // ------------------------------------------------------------------ job payment.reconcile
  /**
   * Lần thanh toán `initiated` quá PAYMENT_RECONCILE_AFTER_MINUTES (≤ 48 giờ) của đơn chưa trả → queryStatus; paid → confirm
   * (cấp quyền như webhook), failed → đánh dấu; pending/không thấy → để lần sau. Lỗi một cổng không chặn cổng khác.
   */
  async reconcilePending(now: Date = this.now()): Promise<{ checked: number; paid: number; failed: number; errors: number }> {
    const cutoff = new Date(now.getTime() - this.env.PAYMENT_RECONCILE_AFTER_MINUTES * 60_000);
    const rows = await this.dbs.db
      .select({ payment: billingPayments, orderStatus: billingOrders.status })
      .from(billingPayments)
      .innerJoin(billingOrders, eq(billingOrders.id, billingPayments.orderId))
      .where(and(eq(billingPayments.status, 'initiated'), lt(billingPayments.createdAt, cutoff), gt(billingPayments.createdAt, new Date(now.getTime() - 48 * 3600_000)), inArray(billingOrders.status, ['pending', 'failed', 'cancelled', 'expired'])))
      .orderBy(billingPayments.createdAt)
      .limit(200);
    let paid = 0;
    let failed = 0;
    let errors = 0;
    for (const { payment } of rows) {
      const provider = this.providers.byDbProvider(payment.provider);
      const raw = (payment.rawCallback ?? {}) as Record<string, unknown>;
      const ref = typeof raw.merchant_ref === 'string' ? raw.merchant_ref : null;
      if (!provider || !ref) continue;
      try {
        const parsed = await provider.queryStatus({ merchantRef: ref, createdAt: payment.createdAt, amount: toVnd(payment.amount), init: (raw.init as Record<string, unknown>) ?? null });
        if (!parsed || parsed.status === 'pending') continue;
        const r = await this.confirm(provider, { ...parsed, merchantRef: ref }, 'reconcile');
        if (r.paid) paid++;
        else if (parsed.status !== 'paid') failed++;
      } catch (err) {
        errors++;
        this.logger.warn({ provider: provider.code, payment_id: payment.id, err: (err as Error).message.slice(0, 200) }, 'payment reconcile query failed');
      }
    }
    if (rows.length) this.logger.info({ checked: rows.length, paid, failed, errors }, 'payment.reconcile');
    return { checked: rows.length, paid, failed, errors };
  }

  // ------------------------------------------------------------------ cổng giả lập (dev/E2E)
  /** Trang thanh toán giả: hoàn tất → gửi webhook ký như cổng thật (trừ `drop_webhook` để thử payment.reconcile) */
  async mockComplete(ref: string, outcome: 'paid' | 'failed' | 'cancelled', opts: { dropWebhook?: boolean; ip?: string | null }): Promise<{ redirect_url: string; outcome: WebhookOutcome | 'dropped' }> {
    this.providers.forCallback('mock');
    const sim = this.providers.mock().simulate(ref, outcome);
    let r: WebhookOutcome | 'dropped' = 'dropped';
    if (!opts.dropWebhook) {
      const ack = await this.handleWebhook('mock', { method: 'POST', query: {}, body: sim.payload, headers: { 'x-mock-signature': sim.signature, 'x-allingo-source': 'mock_checkout' } }, { ip: opts.ip ?? null, userAgent: 'mock-gateway' });
      r = (ack.body as { outcome?: WebhookOutcome }).outcome ?? 'error';
    }
    return { redirect_url: `${this.providers.returnUrl('mock')}?ref=${encodeURIComponent(ref)}`, outcome: r };
  }
}
