import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { Order, OrderCreateInput, PayInput, PayResult } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { AppError, Conflict, FeatureDisabled, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { FeatureFlagService } from './feature-flags.service.js';
import { encodeMerchantRef } from './payments/merchant-ref.js';
import { asciiDescription, PaymentProviderError } from './payments/payment-provider.js';
import { PaymentProviderRegistry } from './payments/provider-registry.js';
import { planSummary, PlansService, type PlanRow } from './plans.service.js';
import { normalizePromoCode, toVnd } from './pricing.js';
import { PromotionsService } from './promotions.service.js';

const { billingOrders, billingPayments, billingPlans, billingPromotions, billingInvoices } = schema;
export type OrderRow = typeof billingOrders.$inferSelect;
type PaymentRow = typeof billingPayments.$inferSelect;

export const CHECKOUT_FLAG = 'ff.billing.checkout';
const PAYABLE: OrderRow['status'][] = ['pending', 'failed', 'cancelled'];

/** Mã lỗi Postgres (drizzle bọc lỗi postgres.js trong `cause`) */
export function pgCode(err: unknown): string | undefined {
  let e = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}

/** Định danh người mua gửi cổng (băm – không gửi user_id/email thật) */
export function userRef(userId: string): string {
  return `u${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;
}

export class PaymentFailed extends AppError {
  constructor(provider: string, providerCode: string) {
    super('payment_failed', 'Payment provider rejected the request', HttpStatus.BAD_GATEWAY, { provider, provider_code: providerCode });
  }
}

/**
 * Đơn hàng (Sprint 7): giá chốt phía server, Idempotency-Key bắt buộc, `pending → paid | failed | cancelled | expired`
 * (hết hạn ORDER_EXPIRE_MINUTES – job order.expire + kiểm tra lười khi đọc), khởi tạo thanh toán qua PaymentProvider.
 * Quyền KHÔNG cấp ở đây – chỉ webhook/queryStatus (PaymentsService.confirm).
 */
@Injectable()
export class OrdersService {
  private readonly logger = getLogger({ component: 'billing.orders' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly plans: PlansService,
    private readonly promotions: PromotionsService,
    private readonly providers: PaymentProviderRegistry,
    private readonly flags: FeatureFlagService,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  private async assertCheckout(userId: string): Promise<void> {
    if (!(await this.flags.isEnabled(CHECKOUT_FLAG, { userId }, true))) throw new FeatureDisabled(CHECKOUT_FLAG);
  }

  // ------------------------------------------------------------------ tạo đơn
  async create(user: { id: string; isGuest: boolean }, input: OrderCreateInput, idempotencyKey: string | undefined): Promise<{ order: Order; created: boolean }> {
    if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new ValidationFailed({ issues: [{ path: 'Idempotency-Key', message: 'Idempotency-Key header (UUID) is required', code: 'idempotency_key_required' }] });
    if (user.isGuest) throw new Forbidden('Guest accounts cannot purchase – register first', { reason: 'guest_account' });
    await this.assertCheckout(user.id);
    const key = `${user.id}:${idempotencyKey.toLowerCase()}`;
    const existing = await this.byIdempotencyKey(key);
    if (existing) return { order: await this.reuse(existing, input), created: false };

    const now = this.now();
    const { plan, price } = await this.plans.resolve({ priceId: input.price_id, planId: input.plan_id });
    const subtotal = toVnd(price.amount) * input.quantity;
    let discount = 0;
    let promotionId: string | null = null;
    if (input.promotion_code) {
      const { promo, result } = await this.promotions.evaluate(user.id, input.promotion_code, plan.id, subtotal, now);
      if (!result.ok) throw new ValidationFailed({ promotion: { code: normalizePromoCode(input.promotion_code), reason: result.reason }, issues: [{ path: 'promotion_code', message: `promotion not applicable: ${result.reason}`, code: 'promotion_invalid' }] });
      discount = result.computation.discount;
      promotionId = promo!.id;
    }
    const total = subtotal - discount;
    try {
      const [row] = await this.dbs.db
        .insert(billingOrders)
        .values({ userId: user.id, planId: plan.id, priceId: price.id, promotionId, quantity: input.quantity, currency: 'VND', subtotal: String(subtotal), discount: String(discount), total: String(total), status: 'pending', idempotencyKey: key, buyerInfo: input.buyer_info ?? null, createdAt: now, expiresAt: new Date(now.getTime() + this.env.ORDER_EXPIRE_MINUTES * 60_000) })
        .returning();
      this.logger.info({ order_id: row!.id, plan: plan.code, total, promotion: !!promotionId }, 'order created');
      return { order: await this.toDto(row!), created: true };
    } catch (err) {
      // Hai request song song cùng Idempotency-Key → hàng thứ hai vi phạm UNIQUE, trả đơn đã tạo
      if (pgCode(err) === '23505') {
        const again = await this.byIdempotencyKey(key);
        if (again) return { order: await this.reuse(again, input), created: false };
      }
      throw err;
    }
  }

  private async byIdempotencyKey(key: string): Promise<OrderRow | null> {
    const [o] = await this.dbs.db.select().from(billingOrders).where(eq(billingOrders.idempotencyKey, key)).limit(1);
    return o ?? null;
  }

  /** Cùng khoá: body phải cùng giá/mã (khác → 409 – không âm thầm trả đơn của yêu cầu khác) */
  private async reuse(order: OrderRow, input: OrderCreateInput): Promise<Order> {
    const samePrice = input.price_id ? input.price_id === order.priceId : input.plan_id === order.planId;
    let samePromo = !input.promotion_code && !order.promotionId;
    if (input.promotion_code && order.promotionId) {
      const [p] = await this.dbs.db.select({ code: billingPromotions.code }).from(billingPromotions).where(eq(billingPromotions.id, order.promotionId)).limit(1);
      samePromo = p?.code === normalizePromoCode(input.promotion_code);
    }
    if (!samePrice || !samePromo) throw new Conflict('Idempotency-Key reused with a different request', { reason: 'idempotency_key_reused', order_id: order.id });
    return this.toDto(order);
  }

  // ------------------------------------------------------------------ đọc
  async ownedOrder(userId: string, orderId: string, db: DbOrTx = this.dbs.db, lock = false): Promise<OrderRow> {
    const q = db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    const [o] = lock ? await q.for('update') : await q;
    // Đơn của người khác → 404 (không lộ sự tồn tại)
    if (!o || o.userId !== userId) throw new NotFound('order', orderId);
    return o;
  }

  async get(userId: string, orderId: string): Promise<Order> {
    let o = await this.ownedOrder(userId, orderId);
    o = await this.expireIfOverdue(o);
    return this.toDto(o);
  }

  async listMine(userId: string, cursor: string | undefined, limit: number): Promise<{ data: Order[]; next_cursor: string | null }> {
    const c = decodeCursor<{ t: string; id: string }>(cursor);
    const rows = await this.dbs.db
      .select()
      .from(billingOrders)
      .where(and(eq(billingOrders.userId, userId), c ? sql`(${billingOrders.createdAt}, ${billingOrders.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(billingOrders.createdAt), desc(billingOrders.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const data = await this.toDtos(page);
    const last = page[page.length - 1];
    return { data, next_cursor: rows.length > limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null };
  }

  /** Hết hạn lười khi đọc (job order.expire vẫn quét định kỳ) */
  private async expireIfOverdue(o: OrderRow): Promise<OrderRow> {
    if (!PAYABLE.includes(o.status) || !o.expiresAt || o.expiresAt > this.now()) return o;
    const [u] = await this.dbs.db
      .update(billingOrders)
      .set({ status: 'expired' })
      .where(and(eq(billingOrders.id, o.id), inArray(billingOrders.status, PAYABLE)))
      .returning();
    return u ?? o;
  }

  /** Job order.expire: đơn pending/failed/cancelled quá expires_at → expired. Trả số đơn. */
  async expireDue(now: Date = this.now()): Promise<number> {
    const rows = await this.dbs.db
      .update(billingOrders)
      .set({ status: 'expired' })
      .where(and(inArray(billingOrders.status, PAYABLE), lt(billingOrders.expiresAt, now)))
      .returning({ id: billingOrders.id });
    if (rows.length) this.logger.info({ expired: rows.length }, 'orders expired');
    return rows.length;
  }

  // ------------------------------------------------------------------ thanh toán
  /** Kiểm tra return_url thuộc web của Allingo (chống open redirect) */
  private safeReturnUrl(url: string | undefined): string {
    const def = `${this.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/checkout/result`;
    if (!url) return def;
    const allowed = new Set([this.env.WEB_PUBLIC_URL, ...this.env.CORS_ORIGINS.split(',')].map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean));
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      /* sai URL */
    }
    if (!allowed.has(origin)) throw new ValidationFailed({ issues: [{ path: 'return_url', message: 'return_url must belong to the Allingo web origin', code: 'return_url_not_allowed' }] });
    return url;
  }

  async pay(user: { id: string }, orderId: string, input: PayInput, meta: { ip?: string | null }): Promise<PayResult> {
    await this.assertCheckout(user.id);
    const provider = this.providers.require(input.provider);
    const returnUrl = this.safeReturnUrl(input.return_url);
    const now = this.now();
    let order = await this.ownedOrder(user.id, orderId);
    order = await this.expireIfOverdue(order);
    const merchantRef = encodeMerchantRef(order.id);
    const { payment, plan } = await this.dbs.db.transaction(async (tx) => {
      const o = await this.ownedOrder(user.id, orderId, tx, true);
      if (!PAYABLE.includes(o.status) || (o.expiresAt && o.expiresAt <= now)) throw new Conflict('Order is not payable', { reason: 'order_not_payable', status: o.expiresAt && o.expiresAt <= now && PAYABLE.includes(o.status) ? 'expired' : o.status });
      if (o.status !== 'pending') await tx.update(billingOrders).set({ status: 'pending' }).where(eq(billingOrders.id, o.id));
      const [p] = await tx
        .insert(billingPayments)
        .values({ orderId: o.id, provider: provider.dbProvider, providerTxnId: null, amount: o.total, currency: o.currency, status: 'initiated', rawCallback: { merchant_ref: merchantRef, phase: 'init', provider: provider.code, return_url: returnUrl, created_at: now.toISOString() }, createdAt: now })
        .returning();
      const [pl] = await tx.select().from(billingPlans).where(eq(billingPlans.id, o.planId)).limit(1);
      return { payment: p!, plan: pl! };
    });
    try {
      const result = await provider.createPayment({
        merchantRef,
        orderId: order.id,
        amount: toVnd(order.total),
        currency: 'VND',
        description: asciiDescription(`Allingo ${plan.code} ${merchantRef.slice(-6)}`),
        returnUrl: this.providers.returnUrl(provider.code),
        ipnUrl: this.providers.ipnUrl(provider.code),
        ipAddress: normalizeIp(meta.ip),
        locale: input.locale ?? 'vi',
        createdAt: now,
        expiresAt: order.expiresAt ?? new Date(now.getTime() + this.env.ORDER_EXPIRE_MINUTES * 60_000),
        userRef: userRef(user.id),
      });
      await this.dbs.db
        .update(billingPayments)
        .set({ rawCallback: sql`${billingPayments.rawCallback} || ${JSON.stringify({ init: result.meta })}::jsonb` })
        .where(eq(billingPayments.id, payment.id));
      this.logger.info({ order_id: order.id, payment_id: payment.id, provider: provider.code, method: result.method }, 'payment initiated');
      return { payment_id: payment.id, order_id: order.id, provider: provider.code, method: result.method, redirect_url: result.redirectUrl, qr_code: result.qrCode, deeplink: result.deeplink, expires_at: (order.expiresAt ?? now).toISOString() };
    } catch (err) {
      const code = err instanceof PaymentProviderError ? err.providerCode : 'network';
      await this.dbs.db
        .update(billingPayments)
        .set({ status: 'failed', rawCallback: sql`${billingPayments.rawCallback} || ${JSON.stringify({ init_error: code })}::jsonb` })
        .where(eq(billingPayments.id, payment.id));
      this.logger.warn({ order_id: order.id, provider: provider.code, provider_code: code, err: (err as Error).message.slice(0, 200) }, 'payment initiation failed');
      throw new PaymentFailed(provider.code, code);
    }
  }

  // ------------------------------------------------------------------ DTO
  async toDto(o: OrderRow, ctx?: { plan?: PlanRow; payments?: PaymentRow[]; promoCode?: string | null; invoice?: typeof billingInvoices.$inferSelect | null }): Promise<Order> {
    const plan = ctx?.plan ?? (await this.plans.byId(o.planId))!;
    const payments = ctx?.payments ?? (await this.dbs.db.select().from(billingPayments).where(eq(billingPayments.orderId, o.id)).orderBy(desc(billingPayments.createdAt)));
    let promoCode = ctx?.promoCode;
    if (promoCode === undefined) {
      promoCode = null;
      if (o.promotionId) {
        const [p] = await this.dbs.db.select({ code: billingPromotions.code }).from(billingPromotions).where(eq(billingPromotions.id, o.promotionId)).limit(1);
        promoCode = p?.code ?? null;
      }
    }
    let invoice = ctx?.invoice;
    if (invoice === undefined) [invoice = null] = await this.dbs.db.select().from(billingInvoices).where(eq(billingInvoices.orderId, o.id)).limit(1);
    const now = this.now();
    return {
      id: o.id,
      plan: planSummary(plan),
      price_id: o.priceId,
      quantity: o.quantity,
      currency: o.currency.trim(),
      subtotal: Number(o.subtotal),
      discount: Number(o.discount),
      total: Number(o.total),
      promotion_code: promoCode,
      status: o.status,
      payments: payments.map((p) => ({ id: p.id, provider: p.provider === 'manual' ? 'mock' : p.provider, status: p.status, amount: Number(p.amount), created_at: p.createdAt.toISOString(), confirmed_at: p.confirmedAt?.toISOString() ?? null })),
      invoice: invoice ? { invoice_no: invoice.invoiceNo ?? null, pdf_url: invoice.pdfUrl ?? null, issued_at: invoice.issuedAt?.toISOString() ?? null } : null,
      created_at: o.createdAt.toISOString(),
      paid_at: o.paidAt?.toISOString() ?? null,
      expires_at: o.expiresAt?.toISOString() ?? null,
      payable: PAYABLE.includes(o.status) && (!o.expiresAt || o.expiresAt > now),
    };
  }

  async toDtos(rows: OrderRow[]): Promise<Order[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const promoIds = [...new Set(rows.map((r) => r.promotionId).filter((x): x is string => !!x))];
    const [plans, payments, promos, invoices] = await Promise.all([
      this.dbs.db.select().from(billingPlans).where(inArray(billingPlans.id, [...new Set(rows.map((r) => r.planId))])),
      this.dbs.db.select().from(billingPayments).where(inArray(billingPayments.orderId, ids)).orderBy(desc(billingPayments.createdAt)),
      promoIds.length ? this.dbs.db.select({ id: billingPromotions.id, code: billingPromotions.code }).from(billingPromotions).where(inArray(billingPromotions.id, promoIds)) : Promise.resolve([] as Array<{ id: string; code: string }>),
      this.dbs.db.select().from(billingInvoices).where(inArray(billingInvoices.orderId, ids)),
    ]);
    const planMap = new Map(plans.map((p) => [p.id, p]));
    const promoMap = new Map(promos.map((p) => [p.id, p.code]));
    return Promise.all(rows.map((r) => this.toDto(r, { plan: planMap.get(r.planId), payments: payments.filter((p) => p.orderId === r.id), promoCode: r.promotionId ? (promoMap.get(r.promotionId) ?? null) : null, invoice: invoices.find((i) => i.orderId === r.id) ?? null })));
  }
}

/** VNPay yêu cầu vnp_IpAddr IPv4/IPv6 hợp lệ; bỏ tiền tố IPv4-mapped */
export function normalizeIp(ip: string | null | undefined): string {
  if (!ip) return '127.0.0.1';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
