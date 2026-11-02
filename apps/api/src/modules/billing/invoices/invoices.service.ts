import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  DOMAIN_EVENTS,
  INVOICE_MAX_ATTEMPTS,
  INVOICE_RETRY_BACKOFF_MINUTES,
  JOB_NAMES,
  pickLocalized,
  type AdminInvoice,
  type BuyerType,
  type DeadLetter,
  type InvoiceReconciliation,
  type InvoiceStatus,
  type OrderInvoice,
} from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import type { OutboxEvent } from '../../../shared/events/outbox.service.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { UserDirectory } from '../../../shared/events/user-directory.js';
import { withUserEmails } from '../admin-emails.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { Conflict, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { JobsService } from '../../../shared/queue/jobs.service.js';
import { StorageService } from '../../../shared/storage/storage.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { vnDayRange, vnMonthRange } from '../payments/crypto.js';
import { toVnd } from '../pricing.js';
import { EInvoiceError, splitVat, vndInWords, type EInvoiceProvider, type InvoiceBuyer, type InvoiceIssueInput, type InvoiceRef } from './einvoice-provider.js';
import { InvoiceProviderRegistry } from './invoice-provider.registry.js';

const { billingInvoices, billingOrders, billingPlans, opsJobsDeadletter } = schema;
export type InvoiceRow = typeof billingInvoices.$inferSelect;
type OrderRow = typeof billingOrders.$inferSelect;
type PlanRow = typeof billingPlans.$inferSelect;

/** Trạng thái phụ trong `billing.invoices.raw` (không thêm cột – S80) */
interface InvoiceRaw {
  attempts?: number;
  next_retry_at?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  retryable?: boolean;
  provider_ref?: string | null;
  lookup_url?: string | null;
  pdf_key?: string | null;
  issuing_until?: string | null;
  cancel_attempts?: number;
  cancel_next_retry_at?: string | null;
  cancel_reason?: string | null;
  cancelling_until?: string | null;
  dead_letter_id?: string | null;
  history?: Array<{ at: string; op: string; ok: boolean; code?: string }>;
}

const rawOf = (r: InvoiceRow): InvoiceRaw => (r.raw ?? {});
const pushHistory = (raw: InvoiceRaw, e: { at: string; op: string; ok: boolean; code?: string }) => [...(raw.history ?? []), e].slice(-20);
const CLAIM_SECONDS = 120;
const STUCK_PENDING_MINUTES = 10;

export interface InvoiceIssueOutcome {
  order_id: string;
  status: InvoiceStatus | 'busy' | 'not_found';
  invoice_no?: string | null;
  attempts?: number;
  error_code?: string;
  skipped?: string;
}

/**
 * Hoá đơn điện tử (Sprint 8, ADR-0030). Một đơn `paid` ↔ một hàng `billing.invoices` (UNIQUE order_id):
 *  - `order.paid` (local + outbox) → hàng `pending` (ảnh chụp người mua) → job `invoice.issue` (JobsService, hàng maintenance).
 *  - Phát hành qua EInvoiceProvider (refId = order_id, nhà cung cấp chống trùng) → PDF lưu bucket `invoices`
 *    (`<yyyy>/<mm>/<order>.pdf`, URL ký 10 phút khi đọc) → `issued` + outbox `invoice.issued` (growth gửi email kèm PDF).
 *  - Lỗi → `error` + `raw.next_retry_at` theo backoff 1/5/15/60/240 phút (job `invoice.retry` quét); hết 6 lần (1 + 5 thử lại)
 *    → `failed` + `ops.jobs_deadletter` + outbox `invoice.failed` (growth báo admin). Admin thử lại từ dead-letter.
 *  - `order.refunded` → hoá đơn `issued` → `cancel_pending` → job `invoice.cancel` → `cancelled` (cùng retry/dead-letter);
 *    chưa phát hành → `skipped`.
 *  - Đối chiếu tháng: số hoá đơn hiệu lực = đơn paid − refunded (reconcileMonth).
 * Không log tên/email/MST/địa chỉ người mua (CLAUDE.md §9).
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'billing.invoices' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly registry: InvoiceProviderRegistry,
    private readonly jobs: JobsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly users: UserDirectory,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  onModuleInit(): void {
    this.jobs.register('maintenance', JOB_NAMES.INVOICE_ISSUE, (p) => this.issue(String(p.order_id)));
    this.jobs.register('maintenance', JOB_NAMES.INVOICE_CANCEL, (p) => this.cancel(String(p.order_id)));
  }

  // ------------------------------------------------------------------ sự kiện
  @OnEvent(`local.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidLocal(p: { order_id?: string }): Promise<void> {
    return this.safeRequestIssue(p?.order_id);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.ORDER_PAID}`)
  onPaidOutbox(ev: OutboxEvent<{ order_id?: string }>): Promise<void> {
    return this.safeRequestIssue(ev?.payload?.order_id);
  }

  @OnEvent(`local.${DOMAIN_EVENTS.ORDER_REFUNDED}`)
  onRefundedLocal(p: { order_id?: string; reason?: string }): Promise<void> {
    return this.safeRequestCancel(p?.order_id, p?.reason);
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.ORDER_REFUNDED}`)
  onRefundedOutbox(ev: OutboxEvent<{ order_id?: string; reason?: string }>): Promise<void> {
    return this.safeRequestCancel(ev?.payload?.order_id, ev?.payload?.reason);
  }

  private async safeRequestIssue(orderId: string | undefined): Promise<void> {
    if (!orderId) return;
    await this.requestIssue(orderId).catch((err: Error) => this.logger.error({ order_id: orderId, err: err.message.slice(0, 200) }, 'invoice request failed'));
  }

  private async safeRequestCancel(orderId: string | undefined, reason?: string): Promise<void> {
    if (!orderId) return;
    await this.requestCancel(orderId, reason ?? 'refund').catch((err: Error) => this.logger.error({ order_id: orderId, err: err.message.slice(0, 200) }, 'invoice cancel request failed'));
  }

  // ------------------------------------------------------------------ người mua
  /** Ảnh chụp người mua: orders.buyer_info (đã validate ở POST /orders) + tên/email tài khoản khi thiếu (cá nhân) */
  async buyerFor(order: OrderRow): Promise<InvoiceBuyer> {
    const b = (order.buyerInfo ?? {}) as { type?: BuyerType; name?: string; email?: string; tax_code?: string; company?: string; address?: string };
    const type: BuyerType = b.type ?? (b.tax_code ? 'business' : 'personal');
    const contact = !b.name || !b.email ? await this.users.contact(order.userId) : null;
    return {
      type,
      name: b.name ?? (type === 'personal' ? (contact?.displayName ?? null) : null),
      email: b.email ?? contact?.email ?? null,
      taxCode: type === 'business' ? (b.tax_code ?? null) : null,
      company: type === 'business' ? (b.company ?? null) : null,
      address: b.address ?? null,
    };
  }

  private buyerJson(b: InvoiceBuyer): Record<string, unknown> {
    return { type: b.type, name: b.name, email: b.email, tax_code: b.taxCode, company: b.company, address: b.address };
  }

  private buyerFromRow(r: InvoiceRow): InvoiceBuyer {
    const b = (r.buyer ?? {}) as { type?: BuyerType; name?: string | null; email?: string | null; tax_code?: string | null; company?: string | null; address?: string | null };
    return { type: b.type ?? 'personal', name: b.name ?? null, email: b.email ?? null, taxCode: b.tax_code ?? null, company: b.company ?? null, address: b.address ?? null };
  }

  /** Dữ liệu phát hành (thuần theo đơn/gói/người mua): giá đã gồm thuế, tách thuế theo EINVOICE_VAT_RATE */
  buildInput(order: OrderRow, plan: PlanRow, buyer: InvoiceBuyer, issueDate: Date): InvoiceIssueInput {
    const rate = this.env.EINVOICE_VAT_RATE;
    const total = toVnd(order.total);
    const subtotal = toVnd(order.subtotal);
    const { totalWithoutVat, vatAmount } = splitVat(total, rate);
    const grossWithoutVat = splitVat(subtotal, rate).totalWithoutVat;
    const planName = pickLocalized(plan.name, 'vi') || plan.code;
    const lineName = plan.kind === 'credit_pack' ? `Gói credit AI Allingo – ${planName}` : `Dịch vụ luyện thi trực tuyến Allingo – ${planName}`;
    return {
      refId: order.id,
      issueDate,
      currency: 'VND',
      buyer,
      lines: [{ code: plan.code, name: lineName, unit: 'Gói', quantity: 1, unitPrice: grossWithoutVat, amountWithoutVat: totalWithoutVat, vatAmount, amount: total }],
      subtotal: grossWithoutVat,
      discount: grossWithoutVat - totalWithoutVat,
      vatRate: rate,
      totalWithoutVat,
      vatAmount,
      total,
      totalInWords: vndInWords(total),
      paymentMethod: 'TM/CK',
    };
  }

  // ------------------------------------------------------------------ yêu cầu phát hành
  /** Tạo hàng pending (idempotent) rồi đặt job invoice.issue. Đơn chưa paid → bỏ qua. */
  async requestIssue(orderId: string): Promise<{ dispatched: boolean; status: string }> {
    const [order] = await this.dbs.db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!order || (order.status !== 'paid' && order.status !== 'refunded')) return { dispatched: false, status: 'order_not_paid' };
    const buyer = await this.buyerFor(order);
    const [created] = await this.dbs.db
      .insert(billingInvoices)
      .values({ orderId, provider: this.registry.activeCode, status: order.status === 'refunded' ? 'skipped' : 'pending', buyer: this.buyerJson(buyer), raw: { attempts: 0 } })
      .onConflictDoNothing()
      .returning();
    const row = created ?? (await this.byOrder(orderId));
    if (!row || row.status !== 'pending') return { dispatched: false, status: row?.status ?? 'unknown' };
    if (!created && rawOf(row).issuing_until && new Date(rawOf(row).issuing_until!) > this.now()) return { dispatched: false, status: 'busy' };
    await this.dispatch(JOB_NAMES.INVOICE_ISSUE, orderId, rawOf(row).attempts ?? 0);
    return { dispatched: true, status: 'pending' };
  }

  private async dispatch(job: string, orderId: string, attempt: number): Promise<{ done?: Promise<unknown> }> {
    // Mỗi lần thử một jobId (BullMQ giữ jobId đã xong → không thể dùng lại)
    const d = await this.jobs.dispatch('maintenance', job, `${orderId}-${job === JOB_NAMES.INVOICE_ISSUE ? 'i' : 'c'}${attempt}`, { order_id: orderId });
    d.done?.catch(() => undefined);
    return { done: d.done };
  }

  async byOrder(orderId: string, db: DbOrTx = this.dbs.db): Promise<InvoiceRow | null> {
    const [r] = await db.select().from(billingInvoices).where(eq(billingInvoices.orderId, orderId)).limit(1);
    return r ?? null;
  }

  // ------------------------------------------------------------------ job invoice.issue
  async issue(orderId: string, now: Date = this.now()): Promise<InvoiceIssueOutcome> {
    let inv = await this.byOrder(orderId);
    if (!inv) {
      await this.requestIssueRowOnly(orderId);
      inv = await this.byOrder(orderId);
      if (!inv) return { order_id: orderId, status: 'not_found' };
    }
    if (inv.status !== 'pending' && inv.status !== 'error') return { order_id: orderId, status: inv.status as InvoiceStatus, skipped: 'not_issuable' };
    const [order] = await this.dbs.db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!order) return { order_id: orderId, status: 'not_found' };
    if (order.status === 'refunded') {
      await this.dbs.db.update(billingInvoices).set({ status: 'skipped', updatedAt: now }).where(eq(billingInvoices.id, inv.id));
      return { order_id: orderId, status: 'skipped', skipped: 'order_refunded' };
    }
    if (order.status !== 'paid') return { order_id: orderId, status: inv.status as InvoiceStatus, skipped: 'order_not_paid' };
    // Giữ quyền xử lý (nhiều replica/worker): chỉ một luồng phát hành tại một thời điểm
    const [claimed] = await this.dbs.db
      .update(billingInvoices)
      .set({ raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ issuing_until: new Date(now.getTime() + CLAIM_SECONDS * 1000).toISOString() })}::jsonb`, updatedAt: now })
      .where(and(eq(billingInvoices.id, inv.id), inArray(billingInvoices.status, ['pending', 'error']), sql`(${billingInvoices.raw}->>'issuing_until' is null or (${billingInvoices.raw}->>'issuing_until')::timestamptz < ${now.toISOString()}::timestamptz)`))
      .returning();
    if (!claimed) return { order_id: orderId, status: 'busy' };
    const raw = rawOf(claimed);
    const provider = this.registry.byCode(claimed.provider) ?? this.registry.active();
    const [plan] = await this.dbs.db.select().from(billingPlans).where(eq(billingPlans.id, order.planId)).limit(1);
    const buyer = this.buyerFromRow(claimed);
    try {
      let ref: InvoiceRef;
      let series: string | null = claimed.series;
      let invoiceNo: string | null = claimed.invoiceNo;
      let lookupCode: string | null = claimed.lookupCode;
      let lookupUrl: string | null = raw.lookup_url ?? null;
      let issuedAt: Date = claimed.issuedAt ?? now;
      let pdf: Buffer | undefined;
      if (raw.provider_ref) {
        // Lần trước đã phát hành ở nhà cung cấp nhưng lỗi sau đó (tải PDF/lưu) – không phát hành lại
        ref = { refId: orderId, providerRef: raw.provider_ref, series, invoiceNo, issuedAt };
      } else {
        const r = await provider.issue(this.buildInput(order, plan!, buyer, now));
        series = r.series;
        invoiceNo = r.invoiceNo;
        lookupCode = r.lookupCode;
        lookupUrl = r.lookupUrl;
        issuedAt = r.issuedAt;
        pdf = r.pdf;
        ref = { refId: orderId, providerRef: r.providerRef, series, invoiceNo, issuedAt };
        await this.dbs.db
          .update(billingInvoices)
          .set({ series, invoiceNo, lookupCode, issuedAt, raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ provider_ref: r.providerRef, lookup_url: lookupUrl })}::jsonb`, updatedAt: now })
          .where(eq(billingInvoices.id, claimed.id));
      }
      pdf ??= await provider.getPdf(ref);
      const ym = new Date(issuedAt.getTime() + 7 * 3600_000).toISOString().slice(0, 7).replace('-', '/');
      const pdfKey = `${ym}/${orderId}.pdf`;
      await this.storage.putObject('invoices', pdfKey, pdf, { contentType: 'application/pdf' });
      const payload = { order_id: orderId, user_id: order.userId, invoice_no: invoiceNo, series, lookup_code: lookupCode, lookup_url: lookupUrl, provider: provider.code, total: toVnd(order.total), plan_code: plan!.code, plan_name: plan!.name, issued_at: issuedAt.toISOString() };
      const after = await this.dbs.db.transaction(async (tx) => {
        const [o] = await tx.select({ status: billingOrders.status }).from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1).for('update');
        const refundedMeanwhile = o?.status === 'refunded';
        const patch: InvoiceRaw = { attempts: (raw.attempts ?? 0) + 1, next_retry_at: null, issuing_until: null, last_error: null, last_error_code: null, pdf_key: pdfKey, provider_ref: ref.providerRef, lookup_url: lookupUrl, history: pushHistory(raw, { at: now.toISOString(), op: 'issue', ok: true }), ...(refundedMeanwhile ? { cancel_attempts: 0, cancel_reason: 'refund', cancel_next_retry_at: now.toISOString() } : {}) };
        await tx
          .update(billingInvoices)
          .set({ status: refundedMeanwhile ? 'cancel_pending' : 'issued', series, invoiceNo, lookupCode, issuedAt, pdfUrl: `storage://invoices/${pdfKey}`, raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: now })
          .where(eq(billingInvoices.id, claimed.id));
        await this.outbox.write(tx, { aggregateType: 'invoice', aggregateId: claimed.id, eventType: DOMAIN_EVENTS.INVOICE_ISSUED, payload });
        await this.audit.log({ action: 'invoice.issued', entityType: 'order', entityId: orderId, after: { invoice_id: claimed.id, provider: provider.code, series, invoice_no: invoiceNo, attempts: patch.attempts, buyer_type: buyer.type } }, tx);
        await tx.execute(sql`update ops.jobs_deadletter set payload = payload || ${JSON.stringify({ resolved_at: now.toISOString() })}::jsonb where job_id = ${`invoice.issue__${orderId}`} and payload->>'resolved_at' is null`);
        return { refundedMeanwhile };
      });
      this.outbox.emitLocal(DOMAIN_EVENTS.INVOICE_ISSUED, payload);
      this.logger.info({ order_id: orderId, provider: provider.code, invoice_no: invoiceNo, attempts: (raw.attempts ?? 0) + 1 }, 'invoice issued');
      if (after.refundedMeanwhile) await this.dispatch(JOB_NAMES.INVOICE_CANCEL, orderId, 0);
      return { order_id: orderId, status: after.refundedMeanwhile ? 'cancel_pending' : 'issued', invoice_no: invoiceNo, attempts: (raw.attempts ?? 0) + 1 };
    } catch (err) {
      return this.recordFailure(claimed, order.userId, 'issue', err, now);
    }
  }

  /** Tạo hàng pending không đặt job (job tự gọi khi chưa có hàng) */
  private async requestIssueRowOnly(orderId: string): Promise<void> {
    const [order] = await this.dbs.db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!order || (order.status !== 'paid' && order.status !== 'refunded')) return;
    const buyer = await this.buyerFor(order);
    await this.dbs.db.insert(billingInvoices).values({ orderId, provider: this.registry.activeCode, status: order.status === 'refunded' ? 'skipped' : 'pending', buyer: this.buyerJson(buyer), raw: { attempts: 0 } }).onConflictDoNothing();
  }

  /** Ghi lần thất bại; hết lượt → dead-letter + outbox invoice.failed */
  private async recordFailure(inv: InvoiceRow, userId: string, op: 'issue' | 'cancel', err: unknown, now: Date): Promise<InvoiceIssueOutcome> {
    const raw = rawOf(inv);
    const code = err instanceof EInvoiceError ? err.providerCode : 'internal';
    const message = ((err as Error)?.message ?? 'error').slice(0, 300);
    const retryable = err instanceof EInvoiceError ? err.retryable : true;
    const attempts = (op === 'issue' ? (raw.attempts ?? 0) : (raw.cancel_attempts ?? 0)) + 1;
    const exhausted = attempts >= INVOICE_MAX_ATTEMPTS;
    const delayMin = INVOICE_RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, INVOICE_RETRY_BACKOFF_MINUTES.length - 1)]!;
    const next = exhausted ? null : new Date(now.getTime() + delayMin * 60_000).toISOString();
    const job = op === 'issue' ? JOB_NAMES.INVOICE_ISSUE : JOB_NAMES.INVOICE_CANCEL;
    let deadLetterId: string | null = null;
    await this.dbs.db.transaction(async (tx) => {
      if (exhausted) {
        const [dl] = await tx
          .insert(opsJobsDeadletter)
          .values({ queue: 'maintenance', jobId: `${job}__${inv.orderId}`, payload: { job, order_id: inv.orderId, invoice_id: inv.id, provider: inv.provider, error_code: code, retryable }, error: `${code}: ${message}`, attempts, failedAt: now })
          .returning({ id: opsJobsDeadletter.id });
        deadLetterId = dl!.id;
      }
      const patch: InvoiceRaw =
        op === 'issue'
          ? { attempts, next_retry_at: next, issuing_until: null, last_error: message, last_error_code: code, retryable, ...(deadLetterId ? { dead_letter_id: deadLetterId } : {}), history: pushHistory(raw, { at: now.toISOString(), op, ok: false, code }) }
          : { cancel_attempts: attempts, cancel_next_retry_at: next, cancelling_until: null, last_error: message, last_error_code: code, retryable, ...(deadLetterId ? { dead_letter_id: deadLetterId } : {}), history: pushHistory(raw, { at: now.toISOString(), op, ok: false, code }) };
      const status = op === 'issue' ? (exhausted ? 'failed' : 'error') : 'cancel_pending';
      await tx.update(billingInvoices).set({ status, raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: now }).where(eq(billingInvoices.id, inv.id));
      if (exhausted) {
        await this.outbox.write(tx, { aggregateType: 'invoice', aggregateId: inv.id, eventType: DOMAIN_EVENTS.INVOICE_FAILED, payload: { order_id: inv.orderId, user_id: userId, op, attempts, error_code: code, dead_letter_id: deadLetterId, dedupe_key: `invoice:${inv.orderId}:${op}:dl:${deadLetterId}` } });
        await this.audit.log({ action: 'invoice.dead_lettered', entityType: 'order', entityId: inv.orderId, after: { op, attempts, error_code: code, dead_letter_id: deadLetterId, provider: inv.provider } }, tx);
      }
    });
    if (exhausted) {
      this.outbox.emitLocal(DOMAIN_EVENTS.INVOICE_FAILED, { order_id: inv.orderId, user_id: userId, op, attempts, error_code: code, dead_letter_id: deadLetterId, dedupe_key: `invoice:${inv.orderId}:${op}:dl:${deadLetterId}` });
      this.logger.error({ order_id: inv.orderId, op, attempts, error_code: code }, 'invoice moved to dead-letter');
    } else this.logger.warn({ order_id: inv.orderId, op, attempts, error_code: code, next_retry_at: next }, 'invoice attempt failed');
    return { order_id: inv.orderId, status: op === 'issue' ? (exhausted ? 'failed' : 'error') : 'cancel_pending', attempts, error_code: code };
  }

  // ------------------------------------------------------------------ huỷ khi hoàn tiền
  async requestCancel(orderId: string, reason: string): Promise<{ dispatched: boolean; status: string }> {
    const now = this.now();
    const row = await this.byOrder(orderId);
    if (!row) {
      // Hoàn tiền trước khi kịp phát hành → đánh dấu bỏ qua (job issue sẽ không phát hành)
      const [order] = await this.dbs.db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
      if (!order) return { dispatched: false, status: 'not_found' };
      await this.dbs.db.insert(billingInvoices).values({ orderId, provider: this.registry.activeCode, status: 'skipped', buyer: this.buyerJson(await this.buyerFor(order)), raw: { attempts: 0, cancel_reason: reason } }).onConflictDoNothing();
      return { dispatched: false, status: 'skipped' };
    }
    if (row.status === 'pending' || row.status === 'error' || row.status === 'failed') {
      // Chưa phát hành: lần phát hành đang chạy (nếu có) sẽ thấy đơn refunded và chuyển cancel_pending
      const [u] = await this.dbs.db
        .update(billingInvoices)
        .set({ status: 'skipped', raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ cancel_reason: reason })}::jsonb`, updatedAt: now })
        .where(and(eq(billingInvoices.id, row.id), inArray(billingInvoices.status, ['pending', 'error', 'failed']), sql`(${billingInvoices.raw}->>'issuing_until' is null or (${billingInvoices.raw}->>'issuing_until')::timestamptz < ${now.toISOString()}::timestamptz)`))
        .returning({ id: billingInvoices.id });
      return { dispatched: false, status: u ? 'skipped' : row.status };
    }
    if (row.status !== 'issued') return { dispatched: false, status: row.status };
    await this.dbs.db
      .update(billingInvoices)
      .set({ status: 'cancel_pending', raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ cancel_reason: reason, cancel_attempts: 0, cancel_next_retry_at: null })}::jsonb`, updatedAt: now })
      .where(and(eq(billingInvoices.id, row.id), eq(billingInvoices.status, 'issued')));
    await this.dispatch(JOB_NAMES.INVOICE_CANCEL, orderId, 0);
    return { dispatched: true, status: 'cancel_pending' };
  }

  async cancel(orderId: string, now: Date = this.now()): Promise<InvoiceIssueOutcome> {
    const inv = await this.byOrder(orderId);
    if (!inv) return { order_id: orderId, status: 'not_found' };
    if (inv.status !== 'cancel_pending') return { order_id: orderId, status: inv.status as InvoiceStatus, skipped: 'not_cancellable' };
    const [claimed] = await this.dbs.db
      .update(billingInvoices)
      .set({ raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ cancelling_until: new Date(now.getTime() + CLAIM_SECONDS * 1000).toISOString() })}::jsonb`, updatedAt: now })
      .where(and(eq(billingInvoices.id, inv.id), eq(billingInvoices.status, 'cancel_pending'), sql`(${billingInvoices.raw}->>'cancelling_until' is null or (${billingInvoices.raw}->>'cancelling_until')::timestamptz < ${now.toISOString()}::timestamptz)`))
      .returning();
    if (!claimed) return { order_id: orderId, status: 'busy' };
    const raw = rawOf(claimed);
    const [order] = await this.dbs.db.select({ userId: billingOrders.userId }).from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    const provider = this.registry.byCode(claimed.provider) ?? this.registry.active();
    const ref: InvoiceRef = { refId: orderId, providerRef: raw.provider_ref ?? '', series: claimed.series, invoiceNo: claimed.invoiceNo, issuedAt: claimed.issuedAt };
    try {
      const r = await provider.cancel(ref, raw.cancel_reason ?? 'refund', now);
      // PDF bản huỷ (nếu nhà cung cấp trả) – không bắt buộc
      if (raw.pdf_key) {
        const pdf = await provider.getPdf(ref).catch(() => null);
        if (pdf) await this.storage.putObject('invoices', raw.pdf_key, pdf, { contentType: 'application/pdf' }).catch(() => undefined);
      }
      const payload = { order_id: orderId, user_id: order?.userId ?? null, invoice_no: claimed.invoiceNo, series: claimed.series, provider: provider.code, cancelled_at: r.cancelledAt.toISOString() };
      await this.dbs.db.transaction(async (tx) => {
        await tx
          .update(billingInvoices)
          .set({ status: 'cancelled', cancelledAt: r.cancelledAt, raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ cancelling_until: null, cancel_next_retry_at: null, cancel_attempts: (raw.cancel_attempts ?? 0) + 1, history: pushHistory(raw, { at: now.toISOString(), op: 'cancel', ok: true }) })}::jsonb`, updatedAt: now })
          .where(eq(billingInvoices.id, claimed.id));
        await this.outbox.write(tx, { aggregateType: 'invoice', aggregateId: claimed.id, eventType: DOMAIN_EVENTS.INVOICE_CANCELLED, payload });
        await this.audit.log({ action: 'invoice.cancelled', entityType: 'order', entityId: orderId, after: { invoice_id: claimed.id, provider: provider.code, invoice_no: claimed.invoiceNo } }, tx);
        await tx.execute(sql`update ops.jobs_deadletter set payload = payload || ${JSON.stringify({ resolved_at: now.toISOString() })}::jsonb where job_id = ${`invoice.cancel__${orderId}`} and payload->>'resolved_at' is null`);
      });
      this.outbox.emitLocal(DOMAIN_EVENTS.INVOICE_CANCELLED, payload);
      this.logger.info({ order_id: orderId, provider: provider.code }, 'invoice cancelled');
      return { order_id: orderId, status: 'cancelled', invoice_no: claimed.invoiceNo };
    } catch (err) {
      return this.recordFailure(claimed, order?.userId ?? '', 'cancel', err, now);
    }
  }

  // ------------------------------------------------------------------ job invoice.retry
  /** Quét thử lại theo backoff + hàng pending bị kẹt (> 10′) + đơn paid 7 ngày gần đây chưa có hoá đơn (mất sự kiện) */
  async retryDue(now: Date = this.now()): Promise<{ issue: number; cancel: number; stuck: number; missing: number }> {
    const due = await this.dbs.db
      .select()
      .from(billingInvoices)
      .where(and(eq(billingInvoices.status, 'error'), sql`(${billingInvoices.raw}->>'next_retry_at')::timestamptz <= ${now.toISOString()}::timestamptz`))
      .limit(200);
    const stuck = await this.dbs.db
      .select()
      .from(billingInvoices)
      .where(and(eq(billingInvoices.status, 'pending'), lt(billingInvoices.updatedAt, new Date(now.getTime() - STUCK_PENDING_MINUTES * 60_000))))
      .limit(200);
    const cancels = await this.dbs.db
      .select()
      .from(billingInvoices)
      .where(and(eq(billingInvoices.status, 'cancel_pending'), sql`(${billingInvoices.raw}->>'cancel_next_retry_at')::timestamptz <= ${now.toISOString()}::timestamptz`))
      .limit(200);
    const missing = await this.dbs.db
      .select({ id: billingOrders.id })
      .from(billingOrders)
      .leftJoin(billingInvoices, eq(billingInvoices.orderId, billingOrders.id))
      .where(and(eq(billingOrders.status, 'paid'), gte(billingOrders.paidAt, new Date(now.getTime() - 7 * 86_400_000)), lt(billingOrders.paidAt, new Date(now.getTime() - 60_000)), isNull(billingInvoices.id)))
      .limit(200);
    for (const r of [...due, ...stuck]) await this.dispatch(JOB_NAMES.INVOICE_ISSUE, r.orderId, rawOf(r).attempts ?? 0);
    for (const r of cancels) await this.dispatch(JOB_NAMES.INVOICE_CANCEL, r.orderId, rawOf(r).cancel_attempts ?? 0);
    for (const o of missing) await this.requestIssue(o.id);
    return { issue: due.length, cancel: cancels.length, stuck: stuck.length, missing: missing.length };
  }

  // ------------------------------------------------------------------ đọc
  /** Hoá đơn trong Order DTO: URL PDF ký 10 phút khi đã phát hành/huỷ */
  async toOrderInvoice(row: InvoiceRow | null): Promise<OrderInvoice | null> {
    if (!row) return null;
    const raw = rawOf(row);
    let pdfUrl: string | null = null;
    let pdfExpires: string | null = null;
    if (raw.pdf_key && (row.status === 'issued' || row.status === 'cancelled' || row.status === 'cancel_pending')) {
      const ttl = this.storage.defaultTtlSec;
      pdfUrl = await this.storage.presignGet('invoices', raw.pdf_key, ttl).catch(() => null);
      pdfExpires = pdfUrl ? new Date(Date.now() + ttl * 1000).toISOString() : null;
    }
    const buyer = (row.buyer ?? {}) as { type?: BuyerType };
    return {
      status: row.status as InvoiceStatus,
      provider: row.provider,
      series: row.series ?? null,
      invoice_no: row.invoiceNo ?? null,
      lookup_code: row.lookupCode ?? null,
      lookup_url: raw.lookup_url ?? null,
      pdf_url: pdfUrl,
      pdf_expires_at: pdfExpires,
      issued_at: row.issuedAt?.toISOString() ?? null,
      cancelled_at: row.cancelledAt?.toISOString() ?? null,
      buyer_type: buyer.type ?? null,
    };
  }

  /** PDF + dữ liệu để growth gửi email hoá đơn (người nhận: email người mua trên hoá đơn, nếu không – email tài khoản) */
  async emailContext(orderId: string): Promise<{ userId: string; to: string | null; data: Record<string, unknown>; attachment: { filename: string; content: Buffer; contentType: string } | null } | null> {
    const [row] = await this.dbs.db.select({ inv: billingInvoices, order: billingOrders }).from(billingInvoices).innerJoin(billingOrders, eq(billingOrders.id, billingInvoices.orderId)).where(eq(billingInvoices.orderId, orderId)).limit(1);
    if (!row || row.inv.status !== 'issued') return null;
    const raw = rawOf(row.inv);
    const buyer = this.buyerFromRow(row.inv);
    const content = raw.pdf_key ? await this.storage.getObjectBuffer('invoices', raw.pdf_key).catch(() => null) : null;
    const [plan] = await this.dbs.db.select({ name: billingPlans.name, code: billingPlans.code }).from(billingPlans).where(eq(billingPlans.id, row.order.planId)).limit(1);
    return {
      userId: row.order.userId,
      to: buyer.email,
      data: { order_id: orderId, invoice_no: row.inv.invoiceNo, series: row.inv.series, lookup_code: row.inv.lookupCode, lookup_url: raw.lookup_url ?? null, total: toVnd(row.order.total), plan_name: plan?.name ?? null, plan_code: plan?.code ?? null, buyer_type: buyer.type, company: buyer.type === 'business' ? buyer.company : null, issued_at: row.inv.issuedAt?.toISOString() ?? null },
      attachment: content ? { filename: `hoa-don-${row.inv.series ?? 'X'}-${row.inv.invoiceNo ?? orderId.slice(0, 8)}.pdf`, content, contentType: 'application/pdf' } : null,
    };
  }

  private toAdmin(r: { inv: InvoiceRow; userId: string; orderStatus: OrderRow['status']; total: string }): AdminInvoice {
    const raw = rawOf(r.inv);
    return {
      id: r.inv.id,
      order_id: r.inv.orderId,
      user_id: r.userId,
      order_status: r.orderStatus,
      total: Number(r.total),
      status: r.inv.status as InvoiceStatus,
      provider: r.inv.provider,
      series: r.inv.series ?? null,
      invoice_no: r.inv.invoiceNo ?? null,
      lookup_code: r.inv.lookupCode ?? null,
      buyer_type: ((r.inv.buyer ?? {}) as { type?: BuyerType }).type ?? null,
      attempts: raw.attempts ?? 0,
      last_error: raw.last_error_code ? `${raw.last_error_code}` : null,
      next_retry_at: raw.next_retry_at ?? raw.cancel_next_retry_at ?? null,
      issued_at: r.inv.issuedAt?.toISOString() ?? null,
      cancelled_at: r.inv.cancelledAt?.toISOString() ?? null,
      created_at: r.inv.createdAt.toISOString(),
      updated_at: r.inv.updatedAt.toISOString(),
    };
  }

  /** GET /admin/billing/invoices */
  async list(q: { status?: InvoiceStatus; order_id?: string; user_id?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const rows = await this.dbs.db
      .select({ inv: billingInvoices, userId: billingOrders.userId, orderStatus: billingOrders.status, total: billingOrders.total })
      .from(billingInvoices)
      .innerJoin(billingOrders, eq(billingOrders.id, billingInvoices.orderId))
      .where(
        and(
          q.status ? eq(billingInvoices.status, q.status) : undefined,
          q.order_id ? eq(billingInvoices.orderId, q.order_id) : undefined,
          q.user_id ? eq(billingOrders.userId, q.user_id) : undefined,
          q.from ? gte(billingInvoices.createdAt, vnDayRange(q.from).start) : undefined,
          q.to ? lt(billingInvoices.createdAt, vnDayRange(q.to).end) : undefined,
          c ? sql`(${billingInvoices.createdAt}, ${billingInvoices.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(billingInvoices.createdAt), desc(billingInvoices.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: await withUserEmails(this.users, page.map((r) => this.toAdmin(r))), next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.inv.createdAt.toISOString(), id: last.inv.id }) : null };
  }

  /** Đối chiếu tháng (lịch VN, theo paid_at): hoá đơn hiệu lực phải bằng đơn paid − refunded */
  async reconcileMonth(month: string): Promise<InvoiceReconciliation> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationFailed({ issues: [{ path: 'month', message: 'month must be YYYY-MM', code: 'invalid_month' }] });
    const { start, end } = vnMonthRange(month);
    const rows = await this.dbs.db
      .select({ orderId: billingOrders.id, orderStatus: billingOrders.status, invStatus: billingInvoices.status })
      .from(billingOrders)
      .leftJoin(billingInvoices, eq(billingInvoices.orderId, billingOrders.id))
      .where(and(inArray(billingOrders.status, ['paid', 'refunded']), gte(billingOrders.paidAt, start), lt(billingOrders.paidAt, end)));
    const paid = rows.length;
    const refunded = rows.filter((r) => r.orderStatus === 'refunded').length;
    const issued = rows.filter((r) => r.invStatus === 'issued').length;
    const cancelled = rows.filter((r) => r.invStatus === 'cancelled').length;
    const pending = rows.filter((r) => r.invStatus === 'pending' || r.invStatus === 'error' || r.invStatus === 'cancel_pending').length;
    const failed = rows.filter((r) => r.invStatus === 'failed').length;
    const missing = rows.filter((r) => r.orderStatus === 'paid' && r.invStatus !== 'issued').map((r) => ({ order_id: r.orderId, invoice_status: r.invStatus ?? null }));
    const unexpected = rows.filter((r) => r.orderStatus === 'refunded' && (r.invStatus === 'issued' || r.invStatus === 'cancel_pending')).map((r) => ({ order_id: r.orderId, invoice_status: r.invStatus!, order_status: r.orderStatus }));
    const expected = paid - refunded;
    return { month, from: start.toISOString(), to: end.toISOString(), orders_paid: paid, orders_refunded: refunded, expected_invoices: expected, invoices_issued: issued, invoices_cancelled: cancelled, invoices_pending: pending, invoices_failed: failed, matched: issued === expected && missing.length === 0 && unexpected.length === 0, missing: missing.slice(0, 500), unexpected: unexpected.slice(0, 500) };
  }

  // ------------------------------------------------------------------ dead-letter (admin)
  private toDeadLetter(r: typeof opsJobsDeadletter.$inferSelect): DeadLetter {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const [job, businessId] = r.jobId.includes('__') ? (r.jobId.split('__') as [string, string]) : [typeof p.job === 'string' ? p.job : 'unknown', r.jobId];
    return {
      id: r.id,
      queue: r.queue,
      job,
      business_id: businessId,
      payload: p,
      error: r.error ?? null,
      attempts: r.attempts ?? null,
      failed_at: r.failedAt.toISOString(),
      resolved_at: typeof p.resolved_at === 'string' ? p.resolved_at : null,
      retried_at: typeof p.retried_at === 'string' ? p.retried_at : null,
      retried_by: typeof p.retried_by === 'string' ? p.retried_by : null,
    };
  }

  /** GET /admin/billing/dead-letters – mục job hoá đơn trong ops.jobs_deadletter */
  async deadLetters(q: { job?: string; include_resolved: boolean; cursor?: string; limit: number }) {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const jobs = q.job ? [q.job] : [JOB_NAMES.INVOICE_ISSUE, JOB_NAMES.INVOICE_CANCEL];
    const rows = await this.dbs.db
      .select()
      .from(opsJobsDeadletter)
      .where(
        and(
          sql`(${sql.join(
            jobs.map((j) => sql`starts_with(${opsJobsDeadletter.jobId}, ${`${j}__`})`),
            sql` or `,
          )})`,
          q.include_resolved ? undefined : sql`${opsJobsDeadletter.payload}->>'resolved_at' is null`,
          c ? sql`(${opsJobsDeadletter.failedAt}, ${opsJobsDeadletter.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(opsJobsDeadletter.failedAt), desc(opsJobsDeadletter.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: page.map((r) => this.toDeadLetter(r)), next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.failedAt.toISOString(), id: last.id }) : null };
  }

  /** POST /admin/billing/dead-letters/{id}/retry – đặt lại số lần thử, chạy lại job (inline ≤ 10 s → kết quả) */
  async retryDeadLetter(id: string, actor: { id: string; roles: string[] }, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<{ dead_letter: DeadLetter; outcome: InvoiceIssueOutcome | null; mode: 'inline' | 'queued' }> {
    const [dl] = await this.dbs.db.select().from(opsJobsDeadletter).where(eq(opsJobsDeadletter.id, id)).limit(1);
    if (!dl) throw new NotFound('dead_letter', id);
    const view = this.toDeadLetter(dl);
    if (view.job !== JOB_NAMES.INVOICE_ISSUE && view.job !== JOB_NAMES.INVOICE_CANCEL) throw new Conflict('Dead-letter entry is not an invoice job', { reason: 'unsupported_job', job: view.job });
    if (view.resolved_at) throw new Conflict('Dead-letter entry already resolved', { reason: 'already_resolved' });
    const orderId = view.business_id;
    const now = this.now();
    const inv = await this.byOrder(orderId);
    if (!inv) throw new NotFound('invoice', orderId);
    if (view.job === JOB_NAMES.INVOICE_ISSUE) {
      if (inv.status !== 'failed' && inv.status !== 'error') throw new Conflict('Invoice is not in a failed state', { reason: 'invoice_not_failed', status: inv.status });
      await this.dbs.db.update(billingInvoices).set({ status: 'pending', raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ attempts: 0, next_retry_at: null, issuing_until: null })}::jsonb`, updatedAt: now }).where(eq(billingInvoices.id, inv.id));
    } else {
      if (inv.status !== 'cancel_pending') throw new Conflict('Invoice is not awaiting cancellation', { reason: 'invoice_not_cancel_pending', status: inv.status });
      await this.dbs.db.update(billingInvoices).set({ raw: sql`coalesce(${billingInvoices.raw}, '{}'::jsonb) || ${JSON.stringify({ cancel_attempts: 0, cancel_next_retry_at: null, cancelling_until: null })}::jsonb`, updatedAt: now }).where(eq(billingInvoices.id, inv.id));
    }
    await this.dbs.db.update(opsJobsDeadletter).set({ payload: sql`coalesce(${opsJobsDeadletter.payload}, '{}'::jsonb) || ${JSON.stringify({ retried_at: now.toISOString(), retried_by: actor.id })}::jsonb` }).where(eq(opsJobsDeadletter.id, id));
    await this.audit.log({ action: 'invoice.dead_letter_retry', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'order', entityId: orderId, after: { dead_letter_id: id, job: view.job }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    const d = await this.jobs.dispatch('maintenance', view.job, `${orderId}-r${Date.now()}`, { order_id: orderId });
    let outcome: InvoiceIssueOutcome | null = null;
    if (d.done) {
      let timer: NodeJS.Timeout | undefined;
      outcome = ((await Promise.race([d.done.catch(() => null), new Promise((r) => (timer = setTimeout(() => r(null), 10_000)))]).finally(() => clearTimeout(timer))) as InvoiceIssueOutcome | null) ?? null;
    }
    const [fresh] = await this.dbs.db.select().from(opsJobsDeadletter).where(eq(opsJobsDeadletter.id, id)).limit(1);
    return { dead_letter: this.toDeadLetter(fresh!), outcome, mode: d.mode };
  }

  /** Provider đang dùng (kiểm tra cấu hình) */
  provider(): EInvoiceProvider {
    return this.registry.active();
  }
}
