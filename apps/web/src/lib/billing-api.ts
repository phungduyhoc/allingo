import { unwrap } from '@allingo/api-client';
import { ledgerEntrySchema, orderSchema, payResultSchema, paymentProvidersSchema, promotionRedeemResultSchema, promotionValidateResultSchema, subscriptionSchema, type BuyerInfo, type LedgerEntry, type Order, type PayResult, type PaymentProviders, type PromotionRedeemResult, type PromotionValidateResult, type Subscription } from '@allingo/schemas/api/billing';
import { creditBalanceSchema, planSchema } from '@allingo/schemas/api/core';
import type { z } from 'zod';
import { getApi } from './api';
import type { Plan } from './billing';
import type { Page } from './types';
import { pageOf, parseOr } from './zod-parse';

/**
 * Lời gọi API Billing (S7/S8) cho người học: gói/giá, cổng thanh toán, khuyến mãi, đơn hàng + thanh toán, subscription,
 * sổ credit. Hàm thuần dùng trong hook TanStack Query; validate bằng Zod của @allingo/schemas.
 */

export type CreditBalance = z.infer<typeof creditBalanceSchema>;

export const billingKeys = {
  plans: (program?: string) => ['plans', program ?? 'all'] as const,
  providers: ['payments', 'providers'] as const,
  order: (id: string) => ['orders', id] as const,
  myOrders: ['me', 'orders'] as const,
  ledger: ['me', 'credits', 'ledger'] as const,
  credits: ['me', 'credits'] as const,
  subscriptions: ['me', 'subscriptions'] as const,
};

export async function getPlans(program?: string): Promise<Plan[]> {
  const data = unwrap(await getApi().GET('/plans', { params: { query: (program ? { program } : {}) as never } }));
  return ((data ?? []) as unknown[]).map((p) => parseOr(planSchema, p));
}

export async function getPaymentProviders(): Promise<PaymentProviders> {
  return parseOr(paymentProvidersSchema, unwrap(await getApi().GET('/payments/providers')));
}

export async function validatePromotion(body: { code: string; price_id?: string; plan_id?: string; program?: string }): Promise<PromotionValidateResult> {
  return parseOr(promotionValidateResultSchema, unwrap(await getApi().POST('/promotions/validate', { body: body as never })));
}

export async function redeemPromotion(body: { code: string; program?: string }): Promise<PromotionRedeemResult> {
  return parseOr(promotionRedeemResultSchema, unwrap(await getApi().POST('/promotions/redeem', { body: body as never })));
}

export interface OrderCreateBody {
  price_id: string;
  promotion_code?: string;
  buyer_info?: BuyerInfo;
}

/** POST /orders – 201 đơn mới, 200 khi gửi lại cùng Idempotency-Key + cùng body (trả đơn cũ) */
export async function createOrder(body: OrderCreateBody, idempotencyKey: string): Promise<{ order: Order; created: boolean }> {
  const res = await getApi().POST('/orders', { params: { header: { 'Idempotency-Key': idempotencyKey } }, body: body as never });
  const order = parseOr(orderSchema, unwrap(res));
  return { order, created: res.response.status === 201 };
}

export async function getOrder(orderId: string): Promise<Order> {
  return parseOr(orderSchema, unwrap(await getApi().GET('/orders/{orderId}', { params: { path: { orderId } } })));
}

export async function payOrder(orderId: string, body: { provider: string; return_url?: string; locale?: 'vi' | 'en' }): Promise<PayResult> {
  return parseOr(payResultSchema, unwrap(await getApi().POST('/orders/{orderId}/pay', { params: { path: { orderId } }, body: body as never })));
}

export async function listMyOrders(cursor?: string | null, limit = 10): Promise<Page<Order>> {
  const query = { limit, ...(cursor ? { cursor } : {}) };
  return pageOf(orderSchema, unwrap(await getApi().GET('/me/orders', { params: { query } as never })));
}

export async function listLedger(cursor?: string | null, limit = 20): Promise<Page<LedgerEntry>> {
  const query = { limit, ...(cursor ? { cursor } : {}) };
  return pageOf(ledgerEntrySchema, unwrap(await getApi().GET('/me/credits/ledger', { params: { query } as never })));
}

export async function getCredits(): Promise<CreditBalance> {
  return parseOr(creditBalanceSchema, unwrap(await getApi().GET('/me/credits')));
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const data = unwrap(await getApi().GET('/me/subscriptions'));
  const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] } | undefined)?.data ?? []);
  return (arr).map((s) => parseOr(subscriptionSchema, s));
}

export async function cancelSubscription(subscriptionId: string): Promise<Subscription> {
  return parseOr(subscriptionSchema, unwrap(await getApi().POST('/me/subscriptions/{subscriptionId}/cancel', { params: { path: { subscriptionId } } })));
}
