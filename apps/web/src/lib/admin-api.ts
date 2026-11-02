import { unwrap } from '@allingo/api-client';
import {
  adminCreditAdjustResultSchema,
  adminInvoiceSchema,
  adminPaymentSchema,
  deadLetterSchema,
  invoiceReconciliationSchema,
  ledgerEntrySchema,
  orderSchema,
  promotionAdminSchema,
  reconciliationRunSchema,
  type AdminInvoice,
  type BillingJob,
  type DeadLetter,
  type InvoiceReconciliation,
  type LedgerEntry,
  type Order,
  type PromotionAdmin,
  type PromotionCreateInput,
  type PromotionPatchInput,
  type ReconciliationRun,
  type ReconciliationRunInput,
  type Subscription,
} from '@allingo/schemas';
import type { z } from 'zod';
import { getApi, getApiFetch } from './api';
import { env } from '@/env';
import type { Page } from './types';
import { pageOf, parseOr } from './zod-parse';

/**
 * Lời gọi API Billing admin (S7/S8) – chỉ vai trò admin/superadmin; web ẩn menu + chặn route phía client nhưng SERVER quyết định
 * (403 khi không đủ quyền). Mọi bộ lọc là query string; phân trang cursor.
 */

export type AdminOrder = Order & { user_id: string; payments: (Order['payments'][number] & { provider_txn_id?: string | null; merchant_ref?: string | null })[] };
export type AdminPayment = z.infer<typeof adminPaymentSchema>;
export type AdminSubscription = Subscription & { user_id: string; created_at?: string };
export type CreditAdjustResult = z.infer<typeof adminCreditAdjustResultSchema>;

export interface BillingSummary {
  from: string;
  to: string;
  by_day: { day: string; provider: string; paid: number; revenue: number }[];
  orders_by_status: Record<string, number>;
  stuck_pending: number;
  revenue_total: number;
}

export const adminKeys = {
  all: ['admin', 'billing'] as const,
  summary: (q: object) => ['admin', 'billing', 'summary', q] as const,
  list: (kind: string, q: object) => ['admin', 'billing', kind, q] as const,
  userLedger: (userId: string) => ['admin', 'billing', 'user-ledger', userId] as const,
  invoiceRecon: (month: string) => ['admin', 'billing', 'invoice-recon', month] as const,
  promotions: (q: object) => ['admin', 'billing', 'promotions', q] as const,
};

type Query = Record<string, string | number | boolean | undefined | null>;
const rawPage = <T>(data: unknown): Page<T> => {
  const d = (data ?? {}) as { data?: T[]; next_cursor?: string | null };
  return { data: d.data ?? [], next_cursor: d.next_cursor ?? null };
};
const clean = (q: Query) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export async function getBillingSummary(q: { from?: string; to?: string } = {}): Promise<BillingSummary> {
  return unwrap(await getApi().GET('/admin/billing/summary', { params: { query: clean(q) as never } })) as unknown as BillingSummary;
}

export async function listAdminOrders(q: Query): Promise<Page<AdminOrder>> {
  // Không validate Zod: schema Order (strict) bỏ mất `user_id`, `payments[].provider_txn_id/merchant_ref` của bản admin
  return rawPage<AdminOrder>(unwrap(await getApi().GET('/admin/billing/orders', { params: { query: clean(q) as never } })));
}

export async function listAdminPayments(q: Query): Promise<Page<AdminPayment>> {
  return pageOf(adminPaymentSchema, unwrap(await getApi().GET('/admin/billing/payments', { params: { query: clean(q) as never } })));
}

export async function listAdminInvoices(q: Query): Promise<Page<AdminInvoice>> {
  return pageOf(adminInvoiceSchema, unwrap(await getApi().GET('/admin/billing/invoices', { params: { query: clean(q) as never } })));
}

export async function listAdminSubscriptions(q: Query): Promise<Page<AdminSubscription>> {
  return rawPage<AdminSubscription>(unwrap(await getApi().GET('/admin/billing/subscriptions', { params: { query: clean(q) as never } })));
}

export async function refundOrder(orderId: string, body: { reason: string; revoke_credits: boolean }): Promise<{ order: Order; revoked?: Record<string, unknown> }> {
  const d = unwrap(await getApi().POST('/admin/orders/{orderId}/refund', { params: { path: { orderId } }, body: body as never })) as { order?: unknown; revoked?: Record<string, unknown> };
  return { order: parseOr(orderSchema, d.order), revoked: d.revoked };
}

export async function adjustUserCredits(userId: string, body: { delta: number; note: string; expires_at?: string }): Promise<CreditAdjustResult> {
  return parseOr(adminCreditAdjustResultSchema, unwrap(await getApi().POST('/admin/users/{userId}/credits', { params: { path: { userId } }, body: body as never })));
}

export async function listUserLedger(userId: string, cursor?: string | null): Promise<Page<LedgerEntry>> {
  const query = { limit: 20, ...(cursor ? { cursor } : {}) };
  return pageOf(ledgerEntrySchema, unwrap(await getApi().GET('/admin/users/{userId}/credits/ledger', { params: { path: { userId }, query } as never })));
}

export async function listReconciliations(q: { provider?: string } = {}): Promise<ReconciliationRun[]> {
  const d = unwrap(await getApi().GET('/admin/billing/reconciliations', { params: { query: clean({ ...q, limit: 30 }) as never } }));
  const arr = Array.isArray(d) ? d : ((d as { data?: unknown[] } | undefined)?.data ?? []);
  return (arr).map((r) => parseOr(reconciliationRunSchema, r));
}

export async function createReconciliation(body: ReconciliationRunInput): Promise<ReconciliationRun> {
  return parseOr(reconciliationRunSchema, unwrap(await getApi().POST('/admin/billing/reconciliations', { body: body as never })));
}

/** Tải báo cáo lệch dạng CSV (fetch có cookie → Blob; chạy được cả với mock) */
export async function downloadReconciliationCsv(runId: string): Promise<Blob> {
  const res = await getApiFetch()(`${env.apiUrl}/admin/billing/reconciliations/${encodeURIComponent(runId)}?format=csv`, { credentials: 'include', headers: { Accept: 'text/csv' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export async function getInvoiceReconciliation(month: string): Promise<InvoiceReconciliation> {
  return parseOr(invoiceReconciliationSchema, unwrap(await getApi().GET('/admin/billing/invoices/reconciliation', { params: { query: { month } as never } })));
}

export async function listDeadLetters(q: { job?: string; include_resolved?: boolean; cursor?: string | null }): Promise<Page<DeadLetter>> {
  return pageOf(deadLetterSchema, unwrap(await getApi().GET('/admin/billing/dead-letters', { params: { query: clean(q as Query) as never } })));
}

export async function retryDeadLetter(deadLetterId: string): Promise<Record<string, unknown>> {
  return (unwrap(await getApi().POST('/admin/billing/dead-letters/{deadLetterId}/retry', { params: { path: { deadLetterId } } })) ?? {});
}

export async function listPromotions(q: Query): Promise<Page<PromotionAdmin>> {
  return pageOf(promotionAdminSchema, unwrap(await getApi().GET('/admin/promotions', { params: { query: clean(q) as never } })));
}

export async function getPromotion(promotionId: string): Promise<PromotionAdmin> {
  return parseOr(promotionAdminSchema, unwrap(await getApi().GET('/admin/promotions/{promotionId}', { params: { path: { promotionId } } })));
}

export async function createPromotion(body: PromotionCreateInput): Promise<PromotionAdmin> {
  return parseOr(promotionAdminSchema, unwrap(await getApi().POST('/admin/promotions', { body: body as never })));
}

export async function patchPromotion(promotionId: string, body: PromotionPatchInput): Promise<PromotionAdmin> {
  return parseOr(promotionAdminSchema, unwrap(await getApi().PATCH('/admin/promotions/{promotionId}', { params: { path: { promotionId } }, body: body as never })));
}

export interface JobRunResult {
  job: string;
  job_id?: string;
  mode?: string;
  /** completed | queued */
  status: string;
  result?: unknown;
}

export async function runBillingJob(job: BillingJob): Promise<JobRunResult> {
  return unwrap(await getApi().POST('/admin/billing/jobs/{job}', { params: { path: { job } } as never })) as unknown as JobRunResult;
}

export async function setFlag(key: string, body: { enabled: boolean; rules?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  return (unwrap(await getApi().PUT('/admin/flags/{key}', { params: { path: { key } }, body: body as never })) ?? {});
}
