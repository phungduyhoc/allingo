import { BILLING_JOBS, adminCreditAdjustInputSchema, buyerInfoSchema, promotionCreateInputSchema, promotionPatchInputSchema, refundInputSchema, type ReconciliationMismatch, type ReconciliationRun } from '@allingo/schemas/api/billing';
import { MOCK_PLANS, type MockPromotion } from './billing-fixtures';
import {
  addLedger,
  allPromotions,
  balanceOf,
  currentSubs,
  emitTo,
  evaluatePromo,
  issueInvoice,
  notify,
  orderDto,
  orderPayable,
  planById,
  planByPrice,
  recomputeUserPlan,
  setFailNextInvoice,
  subscriptionDto,
  sweepOrders,
  sweepSubscriptions,
} from './billing-core';
import type { MockOrderRecord, MockPaymentRecord, MockState, MockSubscriptionRecord, MockUserRecord } from './state';

/**
 * Route giả lập Billing S7/S8 (NEXT_PUBLIC_API_MOCK=1): gói/cổng, khuyến mãi (validate/redeem), đơn hàng + Idempotency-Key,
 * thanh toán qua cổng giả `/[locale]/mock-gateway` (paid | failed | cancelled | paid-drop), xác nhận "webhook" trong một bước
 * (đơn → paid → subscription/credit/khuyến mãi → hoá đơn → thông báo → realtime), subscription + huỷ, sổ credit, billing admin.
 */

export type MockHandler = (ctx: { url: URL; params: Record<string, string>; body: unknown; method: string; locale: string; headers: Headers }) => Promise<Response> | Response;
export interface MockRouteDef {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: MockHandler;
}

export interface BillingDeps {
  state: MockState;
  persist: () => void;
  route: (method: string, path: string, handler: MockHandler) => MockRouteDef;
  json: (status: number, body: unknown, headers?: Record<string, string>) => Response;
  error: (status: number, code: string, message: string, details?: Record<string, unknown>) => Response;
  uuid: () => string;
  nowIso: () => string;
  requireUser: () => MockUserRecord | Response;
  currentUser: () => MockUserRecord | null;
  /** S8: referral → upgraded khi người được giới thiệu thanh toán */
  onOrderPaid: (userId: string) => void;
}

const DAY = 86_400_000;
const ORDER_EXPIRE_MS = 30 * 60_000;
const enc = (n: number) => btoa(String(n));
const dec = (c: string | null) => {
  if (!c) return 0;
  try {
    const n = Number(atob(c));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};
/** Trang cursor theo offset (đủ cho mock) */
function paginate<T>(rows: T[], url: URL, def = 20): { data: T[]; next_cursor: string | null } {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? def) || def));
  const start = dec(url.searchParams.get('cursor'));
  const data = rows.slice(start, start + limit);
  return { data, next_cursor: start + limit < rows.length ? enc(start + limit) : null };
}
const hash = (v: unknown) => JSON.stringify(v);
const vnDate = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
const isAdmin = (u: MockUserRecord) => u.roles.some((r) => r === 'admin' || r === 'superadmin');

export function billingRoutes(d: BillingDeps): MockRouteDef[] {
  const { state, persist, route, json, error, uuid, nowIso } = d;
  const checkoutEnabled = () => state.flags['ff.billing.checkout']?.enabled !== false;
  const requireAdmin = (): MockUserRecord | Response => {
    const u = d.requireUser();
    if (u instanceof Response) return u;
    return isAdmin(u) ? u : error(403, 'forbidden', 'Admin only');
  };

  /** "Webhook" thành công: một bước như transaction của API (idempotent – đơn đã paid thì bỏ qua) */
  const confirmPayment = (p: MockPaymentRecord): void => {
    const o = state.orders[p.order_id];
    if (!o || p.status === 'success') return;
    const now = nowIso();
    p.status = 'success';
    p.confirmed_at = now;
    p.provider_txn_id = `MOCK${uuid().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    p.simulated = null;
    if (o.status === 'paid') return; // trả lần 2: ghi nhận, không cấp lại
    o.status = 'paid';
    o.paid_at = now;
    const plan = planById(o.plan_id)!;
    let credits = 0;
    if (plan.kind === 'credit_pack') {
      credits = plan.credits_included;
      addLedger(state, o.user_id, { delta: credits, reason: 'purchase', ref: { type: 'order', id: o.id }, expires_at: new Date(Date.now() + 365 * DAY).toISOString() });
    } else {
      // Gia hạn = mua lại: kỳ mới nối tiếp cuối kỳ hiện tại cùng chương trình
      const program = plan.kind === 'combo' ? null : (plan.programs[0] ?? null);
      const prev = currentSubs(state, o.user_id)
        .filter((s) => s.program === program && s.current_period_end && s.status !== 'trialing')
        .sort((a, b) => (b.current_period_end ?? '').localeCompare(a.current_period_end ?? ''))[0];
      const start = prev?.current_period_end && Date.parse(prev.current_period_end) > Date.now() ? prev.current_period_end : now;
      const sub: MockSubscriptionRecord = {
        id: uuid(),
        user_id: o.user_id,
        plan_id: plan.id,
        program,
        status: plan.kind === 'lifetime' ? 'lifetime' : 'active',
        current_period_start: start,
        current_period_end: plan.duration_days ? new Date(Date.parse(start) + plan.duration_days * DAY).toISOString() : null,
        cancel_at_period_end: false,
        source_order_id: o.id,
        created_at: now,
      };
      // Dùng thử đang chạy kết thúc khi mua thật
      for (const s of currentSubs(state, o.user_id)) if (s.status === 'trialing') s.status = 'expired';
      state.subscriptions[sub.id] = sub;
      if (plan.credits_included) {
        credits = plan.credits_included;
        addLedger(state, o.user_id, { delta: credits, reason: 'subscription_grant', ref: { type: 'subscription', id: sub.id }, note: 'period=0' });
      }
      recomputeUserPlan(state, o.user_id);
    }
    for (const r of Object.values(state.redemptions)) {
      if (r.order_id !== o.id || r.status !== 'reserved') continue;
      r.status = 'redeemed';
      if (o.bonus_credits) addLedger(state, o.user_id, { delta: o.bonus_credits, reason: 'promo', ref: { type: 'promotion', id: o.id }, expires_at: new Date(Date.now() + 365 * DAY).toISOString() });
    }
    notify(state, o.user_id, 'billing.order_paid', { order_id: o.id, total: o.total, plan_name: plan.name, plan_code: plan.code, credits_granted: credits, bonus_credits: o.bonus_credits }, { category: 'billing', url: `/account/orders/${o.id}` });
    issueInvoice(state, o);
    d.onOrderPaid(o.user_id);
    emitTo(state, o.user_id, 'order.updated', { order_id: o.id, status: 'paid', paid_at: now });
    emitTo(state, o.user_id, 'entitlements.changed', {});
  };

  const reconcile = () => {
    let checked = 0;
    let paid = 0;
    for (const p of Object.values(state.payments)) {
      if (p.status !== 'initiated') continue;
      checked++;
      // Mock bỏ ngưỡng 15 phút của API (PAYMENT_RECONCILE_AFTER_MINUTES) để E2E không phải chờ
      if (p.simulated === 'paid') {
        confirmPayment(p);
        paid++;
      }
    }
    return { checked, paid, failed: 0, errors: 0 };
  };

  const runJob = (job: string): Record<string, unknown> => {
    if (job === 'payment.reconcile') return reconcile();
    if (job === 'order.expire') return { expired: sweepOrders(state) };
    if (job === 'subscription.expire') {
      for (const id of Object.keys(state.users)) sweepSubscriptions(state, id);
      return { ok: true };
    }
    if (job === 'invoice.retry') {
      let issued = 0;
      for (const o of Object.values(state.orders)) {
        if (o.status === 'paid' && (!o.invoice || o.invoice.status === 'pending' || o.invoice.status === 'error')) {
          issueInvoice(state, o);
          issued++;
        }
      }
      return { issued };
    }
    return { ok: true, job };
  };

  // Hook dev/E2E: chạy job như admin (`window.__ALLINGO_MOCK__.runJob('payment.reconcile')`), làm lỗi lần phát hành hoá đơn kế tiếp
  // (`request(method, path, body)` – gọi "máy chủ" giả như page.request với API thật – gắn trong mock-fetch)
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __ALLINGO_MOCK__?: Record<string, unknown> };
    w.__ALLINGO_MOCK__ = {
      ...(w.__ALLINGO_MOCK__ ?? {}),
      runJob: (job: string) => {
        const r = runJob(job);
        persist();
        return r;
      },
      failNextInvoice: () => setFailNextInvoice(true),
    };
  }

  const subsOf = (userId: string) => {
    sweepSubscriptions(state, userId);
    const all = Object.values(state.subscriptions).filter((s) => s.user_id === userId);
    return all.sort((a, b) => b.current_period_start.localeCompare(a.current_period_start)).map((s) => subscriptionDto(s, all));
  };

  return [
    // --------------------------------------------------------------------- gói & cổng (công khai)
    route('GET', '/plans', ({ url }) => {
      const program = url.searchParams.get('program');
      return json(200, MOCK_PLANS.filter((p) => !program || p.kind === 'free' || p.kind === 'credit_pack' || p.programs.includes(program)));
    }),
    route('GET', '/payments/providers', () => json(200, { checkout_enabled: checkoutEnabled(), providers: checkoutEnabled() ? [{ code: 'mock', methods: ['redirect'], sandbox: true }] : [] })),

    // --------------------------------------------------------------------- khuyến mãi
    route('POST', '/promotions/validate', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const b = (body ?? {}) as { code?: string; price_id?: string; plan_id?: string; program?: string };
      if (!b.code?.trim()) return error(400, 'validation_failed', 'code is required', { issues: [{ path: 'code', message: 'Required', code: 'invalid_type' }] });
      const plan = b.price_id ? planByPrice(b.price_id) : b.plan_id ? planById(b.plan_id) : undefined;
      const ev = evaluatePromo(state, u, b.code, { plan, program: b.program, mode: 'validate' });
      const p = ev.promo;
      const redeem = !!p && (p.kind === 'trial_days' || (p.kind === 'credit_bonus' && !!p.conditions.standalone));
      return json(200, {
        valid: ev.reason === null,
        code: b.code.trim().toUpperCase(),
        reason: ev.reason,
        kind: p?.kind ?? null,
        value: p?.value ?? null,
        subtotal: ev.subtotal,
        discount: ev.reason === null ? ev.discount : 0,
        total: ev.reason === null ? ev.total : ev.subtotal,
        currency: 'VND',
        promotion_id: p?.id ?? null,
        name: p?.name ?? null,
        applies_to: p ? (redeem ? 'redeem' : 'order') : null,
        bonus_credits: ev.reason === null && p?.kind === 'credit_bonus' && !redeem ? p.value : 0,
        trial_days: p?.kind === 'trial_days' ? p.value : null,
        stackable: false,
      });
    }),
    route('POST', '/promotions/redeem', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const b = (body ?? {}) as { code?: string; program?: string };
      const ev = evaluatePromo(state, u, b.code ?? '', { program: b.program, mode: 'redeem' });
      if (ev.reason) return error(400, 'validation_failed', `promotion not redeemable: ${ev.reason}`, { promotion: { code: b.code, reason: ev.reason }, issues: [{ path: 'code', message: ev.reason, code: 'promotion_invalid' }] });
      const p = ev.promo!;
      const now = nowIso();
      const rid = uuid();
      state.redemptions[rid] = { id: rid, promotion_id: p.id, user_id: u.id, order_id: null, status: 'redeemed', discount: 0, credits: p.kind === 'credit_bonus' ? p.value : 0, created_at: now };
      let subscription = null;
      let trialEnds: string | null = null;
      if (p.kind === 'trial_days') {
        const program = b.program ?? u.active_program ?? 'toeic';
        const plan = MOCK_PLANS.find((x) => x.code === (p.conditions.trial_plan_code ?? `${program}_pro_monthly`)) ?? MOCK_PLANS.find((x) => x.code === 'toeic_pro_monthly')!;
        trialEnds = new Date(Date.now() + p.value * DAY).toISOString();
        const sub: MockSubscriptionRecord = { id: uuid(), user_id: u.id, plan_id: plan.id, program, status: 'trialing', current_period_start: now, current_period_end: trialEnds, cancel_at_period_end: false, source_order_id: null, created_at: now };
        state.subscriptions[sub.id] = sub;
        recomputeUserPlan(state, u.id);
        subscription = subscriptionDto(sub, [sub]);
        notify(state, u.id, 'billing.trial_started', { plan_name: plan.name, plan_code: plan.code, trial_days: p.value, period_end: trialEnds }, { category: 'billing', url: '/pricing' });
      } else {
        addLedger(state, u.id, { delta: p.value, reason: 'promo', ref: { type: 'promotion', id: p.id }, expires_at: new Date(Date.now() + (p.conditions.credit_valid_days ?? 365) * DAY).toISOString() });
      }
      persist();
      return json(200, { code: p.code, kind: p.kind, redemption_id: rid, credits_granted: p.kind === 'credit_bonus' ? p.value : 0, balance: balanceOf(state, u.id), subscription, trial_ends_at: trialEnds });
    }),

    // --------------------------------------------------------------------- đơn hàng
    route('POST', '/orders', ({ body, headers }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const key = headers.get('idempotency-key');
      if (!key) return error(400, 'validation_failed', 'Idempotency-Key header is required', { issues: [{ path: 'Idempotency-Key', message: 'Required', code: 'invalid_type' }] });
      if (u.is_guest) return error(403, 'forbidden', 'Guest accounts cannot purchase – register first', { reason: 'guest_account' });
      if (!checkoutEnabled()) return error(503, 'feature_disabled', 'Checkout is disabled', { flag: 'ff.billing.checkout' });
      sweepOrders(state);
      const b = (body ?? {}) as { price_id?: string; promotion_code?: string; buyer_info?: unknown };
      const prior = Object.values(state.orders).find((o) => o.user_id === u.id && o.idempotency_key === key);
      if (prior) {
        if (prior.body_hash !== hash(b)) return error(409, 'conflict', 'Idempotency-Key reused with a different body', { reason: 'idempotency_key_reused' });
        return json(200, orderDto(state, prior));
      }
      const plan = b.price_id ? planByPrice(b.price_id) : undefined;
      if (!plan?.price) return error(400, 'validation_failed', 'Unknown price', { issues: [{ path: 'price_id', message: 'Unknown price', code: 'invalid_value' }] });
      let buyer: MockOrderRecord['buyer_info'] = null;
      if (b.buyer_info !== undefined) {
        const parsed = buyerInfoSchema.safeParse(b.buyer_info);
        if (!parsed.success) return error(400, 'validation_failed', 'Validation failed', { issues: parsed.error.issues.map((i) => ({ path: ['buyer_info', ...i.path].join('.'), message: i.message, code: i.code })) });
        const v = parsed.data;
        buyer = { type: v.type, name: v.name ?? null, email: v.email ?? null, tax_code: v.tax_code ?? null, company: v.company ?? null, address: v.address ?? null };
      }
      let discount = 0;
      let promotionId: string | null = null;
      let bonus = 0;
      if (b.promotion_code) {
        const ev = evaluatePromo(state, u, b.promotion_code, { plan, mode: 'order' });
        if (ev.reason) return error(400, 'validation_failed', `promotion not applicable: ${ev.reason}`, { promotion: { code: b.promotion_code, reason: ev.reason } });
        discount = ev.discount;
        promotionId = ev.promo!.id;
        bonus = ev.promo!.kind === 'credit_bonus' ? ev.promo!.value : 0;
        // Đơn chờ cũ của chính người dùng cùng mã bị thay thế (nhả lượt)
        for (const r of Object.values(state.redemptions)) if (r.user_id === u.id && r.promotion_id === promotionId && r.status === 'reserved') r.status = 'released';
      }
      const now = nowIso();
      const o: MockOrderRecord = {
        id: uuid(),
        user_id: u.id,
        plan_id: plan.id,
        price_id: plan.price.id,
        subtotal: plan.price.amount,
        discount,
        total: plan.price.amount - discount,
        promotion_code: b.promotion_code ? b.promotion_code.trim().toUpperCase() : null,
        promotion_id: promotionId,
        bonus_credits: bonus,
        status: 'pending',
        buyer_info: buyer,
        idempotency_key: key,
        body_hash: hash(b),
        created_at: now,
        paid_at: null,
        expires_at: new Date(Date.now() + ORDER_EXPIRE_MS).toISOString(),
        invoice: null,
      };
      state.orders[o.id] = o;
      if (promotionId) {
        const rid = uuid();
        state.redemptions[rid] = { id: rid, promotion_id: promotionId, user_id: u.id, order_id: o.id, status: 'reserved', discount, credits: bonus, created_at: now };
      }
      persist();
      return json(201, orderDto(state, o));
    }),
    route('GET', '/orders/{orderId}', ({ params }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      sweepOrders(state);
      const o = state.orders[params.orderId!];
      if (!o || o.user_id !== u.id) return error(404, 'not_found', 'Order not found');
      return json(200, orderDto(state, o));
    }),
    route('GET', '/me/orders', ({ url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      sweepOrders(state);
      const rows = Object.values(state.orders)
        .filter((o) => o.user_id === u.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((o) => orderDto(state, o));
      return json(200, paginate(rows, url, 10));
    }),
    route('POST', '/orders/{orderId}/pay', ({ params, body, locale }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      sweepOrders(state);
      const o = state.orders[params.orderId!];
      if (!o || o.user_id !== u.id) return error(404, 'not_found', 'Order not found');
      const b = (body ?? {}) as { provider?: string; return_url?: string; locale?: string };
      if (b.provider !== 'mock') return error(503, 'feature_disabled', 'Feature is disabled', { flag: `payments.${b.provider ?? 'unknown'}` });
      if (!checkoutEnabled()) return error(503, 'feature_disabled', 'Checkout is disabled', { flag: 'ff.billing.checkout' });
      const origin = window.location.origin;
      const returnUrl = b.return_url ?? `${origin}/${locale}/checkout/result`;
      if (!returnUrl.startsWith(origin)) return error(400, 'validation_failed', 'Validation failed', { issues: [{ path: 'return_url', message: 'return_url must belong to the Allingo web origin', code: 'return_url_not_allowed' }] });
      if (!orderPayable(o)) return error(409, 'conflict', 'Order is not payable', { reason: 'order_not_payable', status: o.status });
      o.status = 'pending';
      const ref = `${uuid().replace(/-/g, '')}`.slice(0, 31);
      const p: MockPaymentRecord = { id: uuid(), order_id: o.id, user_id: u.id, provider: 'mock', ref, amount: o.total, status: 'initiated', provider_txn_id: null, simulated: null, return_url: returnUrl, created_at: nowIso(), confirmed_at: null };
      state.payments[p.id] = p;
      persist();
      const lang = b.locale === 'en' ? 'en' : locale === 'en' ? 'en' : 'vi';
      return json(200, { payment_id: p.id, order_id: o.id, provider: 'mock', method: 'redirect', redirect_url: `${origin}/${lang}/mock-gateway?ref=${ref}`, qr_code: null, deeplink: null, expires_at: o.expires_at });
    }),
    // Cổng giả: nút paid | failed | cancelled | paid + drop_webhook → 303 về return_url (web chỉ hiển thị)
    route('POST', '/payments/mock/checkout', ({ body }) => {
      const b = (body ?? {}) as { ref?: string; outcome?: string; drop_webhook?: string };
      const p = Object.values(state.payments).find((x) => x.ref === b.ref);
      if (!p) return error(404, 'not_found', 'Payment not found');
      const o = state.orders[p.order_id]!;
      const outcome = b.outcome === 'failed' || b.outcome === 'cancelled' ? b.outcome : 'paid';
      if (outcome === 'paid') {
        if (b.drop_webhook === '1') p.simulated = 'paid';
        else confirmPayment(p);
      } else {
        p.status = 'failed';
        if (o.status === 'pending') o.status = outcome;
        emitTo(state, o.user_id, 'order.updated', { order_id: o.id, status: o.status, paid_at: null });
      }
      persist();
      const sep = p.return_url.includes('?') ? '&' : '?';
      return json(200, { redirect_url: `${p.return_url}${sep}order_id=${o.id}&status=${o.status}&provider=mock`, outcome: b.drop_webhook === '1' ? 'dropped' : 'ok' });
    }),

    // --------------------------------------------------------------------- subscription & credit
    route('GET', '/me/subscriptions', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const out = subsOf(u.id);
      persist();
      return json(200, out);
    }),
    route('POST', '/me/subscriptions/{subscriptionId}/cancel', ({ params }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const s = state.subscriptions[params.subscriptionId!];
      if (!s || s.user_id !== u.id) return error(404, 'not_found', 'Subscription not found');
      if (s.status === 'lifetime' || !s.current_period_end) return error(409, 'conflict', 'Lifetime plans cannot be cancelled', { reason: 'lifetime' });
      if (s.status === 'expired' || Date.parse(s.current_period_end) <= Date.now()) return error(409, 'conflict', 'Subscription already ended', { reason: 'not_active' });
      s.cancel_at_period_end = true;
      persist();
      return json(200, subscriptionDto(s, [s]));
    }),
    route('GET', '/me/credits', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const soon = state.ledger.filter((l) => l.user_id === u.id && l.delta > 0 && l.expires_at && Date.parse(l.expires_at) - Date.now() < 30 * DAY).map((l) => ({ amount: l.delta, expires_at: l.expires_at! }));
      return json(200, { balance: balanceOf(state, u.id), expiring_soon: soon, costs: { explain_mcq: 1, tutor_chat: 2, diagnose_rl: 10, segment_translate: 0 } });
    }),
    route('GET', '/me/credits/ledger', ({ url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const rows = state.ledger.filter((l) => l.user_id === u.id).sort((a, b) => b.id - a.id).map(({ user_id: _u, ...rest }) => rest);
      return json(200, paginate(rows, url));
    }),

    // --------------------------------------------------------------------- billing admin
    route('GET', '/admin/billing/summary', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const inRange = (iso: string) => (!from || vnDate(iso) >= from) && (!to || vnDate(iso) <= to);
      const orders = Object.values(state.orders).filter((o) => inRange(o.created_at));
      const byStatus: Record<string, number> = {};
      for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      const byDay = new Map<string, { day: string; provider: string; paid: number; revenue: number }>();
      for (const o of orders.filter((x) => x.status === 'paid' && x.paid_at)) {
        const k = `${vnDate(o.paid_at!)}|mock`;
        const row = byDay.get(k) ?? { day: vnDate(o.paid_at!), provider: 'mock', paid: 0, revenue: 0 };
        row.paid++;
        row.revenue += o.total;
        byDay.set(k, row);
      }
      const stuck = Object.values(state.orders).filter((o) => o.status === 'pending' && Date.now() - Date.parse(o.created_at) > 15 * 60_000).length;
      return json(200, { from: from ?? new Date(Date.now() - 30 * DAY).toISOString(), to: to ?? nowIso(), by_day: [...byDay.values()].sort((x, y) => y.day.localeCompare(x.day)), orders_by_status: byStatus, stuck_pending: stuck, revenue_total: [...byDay.values()].reduce((s, r) => s + r.revenue, 0) });
    }),
    route('GET', '/admin/billing/orders', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      sweepOrders(state);
      const q = url.searchParams;
      const rows = Object.values(state.orders)
        .filter((o) => (!q.get('status') || o.status === q.get('status')) && (!q.get('user_id') || o.user_id === q.get('user_id')) && (!q.get('provider') || Object.values(state.payments).some((p) => p.order_id === o.id && p.provider === q.get('provider'))))
        .filter((o) => (!q.get('from') || vnDate(o.created_at) >= q.get('from')!) && (!q.get('to') || vnDate(o.created_at) <= q.get('to')!))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((o) => orderDto(state, o, { admin: true }));
      return json(200, paginate(rows, url));
    }),
    route('GET', '/admin/billing/payments', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const q = url.searchParams;
      const rows = Object.values(state.payments)
        .filter((p) => (!q.get('status') || p.status === q.get('status')) && (!q.get('provider') || p.provider === q.get('provider')) && (!q.get('order_id') || p.order_id === q.get('order_id')) && (!q.get('user_id') || p.user_id === q.get('user_id')))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((p) => ({ id: p.id, order_id: p.order_id, user_id: p.user_id, provider: p.provider, provider_txn_id: p.provider_txn_id, merchant_ref: p.ref, amount: p.amount, currency: 'VND', status: p.status, signature_valid: p.status === 'success' ? true : null, created_at: p.created_at, confirmed_at: p.confirmed_at, flags: p.simulated ? ['webhook_dropped'] : [] }));
      return json(200, paginate(rows, url));
    }),
    route('GET', '/admin/billing/invoices', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const q = url.searchParams;
      const rows = Object.values(state.orders)
        .filter((o) => o.invoice && (!q.get('status') || o.invoice.status === q.get('status')) && (!q.get('order_id') || o.id === q.get('order_id')) && (!q.get('user_id') || o.user_id === q.get('user_id')))
        .sort((x, y) => (y.invoice!.created_at ?? '').localeCompare(x.invoice!.created_at ?? ''))
        .map((o) => ({ id: `${o.id.slice(0, 24)}aaaaaaaaaaaa`, order_id: o.id, user_id: o.user_id, order_status: o.status, total: o.total, status: o.invoice!.status, provider: 'mock', series: o.invoice!.series, invoice_no: o.invoice!.invoice_no, lookup_code: o.invoice!.lookup_code, buyer_type: o.buyer_info?.type ?? 'personal', attempts: o.invoice!.attempts, last_error: o.invoice!.last_error, next_retry_at: null, issued_at: o.invoice!.issued_at, cancelled_at: o.invoice!.cancelled_at, created_at: o.invoice!.created_at, updated_at: o.invoice!.updated_at }));
      return json(200, paginate(rows, url));
    }),
    route('GET', '/admin/billing/invoices/reconciliation', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const month = url.searchParams.get('month') ?? vnDate(nowIso()).slice(0, 7);
      const inMonth = Object.values(state.orders).filter((o) => o.paid_at && vnDate(o.paid_at).startsWith(month));
      const paid = inMonth.filter((o) => o.status === 'paid' || o.status === 'refunded');
      const refunded = inMonth.filter((o) => o.status === 'refunded');
      const issued = inMonth.filter((o) => o.invoice?.status === 'issued');
      const missing = inMonth.filter((o) => o.status === 'paid' && o.invoice?.status !== 'issued').map((o) => ({ order_id: o.id, invoice_status: o.invoice?.status ?? null }));
      const unexpected = refunded.filter((o) => o.invoice?.status === 'issued').map((o) => ({ order_id: o.id, invoice_status: 'issued', order_status: o.status }));
      return json(200, { month, from: `${month}-01T00:00:00+07:00`, to: `${month}-28T00:00:00+07:00`, orders_paid: paid.length, orders_refunded: refunded.length, expected_invoices: paid.length - refunded.length, invoices_issued: issued.length, invoices_cancelled: inMonth.filter((o) => o.invoice?.status === 'cancelled').length, invoices_pending: inMonth.filter((o) => o.invoice?.status === 'pending').length, invoices_failed: inMonth.filter((o) => o.invoice?.status === 'failed').length, matched: missing.length === 0 && unexpected.length === 0, missing, unexpected });
    }),
    route('GET', '/admin/billing/subscriptions', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const q = url.searchParams;
      const within = Number(q.get('expiring_within_days') ?? 0);
      const rows = Object.values(state.subscriptions)
        .filter((s) => (!q.get('status') || s.status === q.get('status')) && (!q.get('user_id') || s.user_id === q.get('user_id')) && (!q.get('program') || s.program === q.get('program')) && (!q.get('plan_code') || planById(s.plan_id)?.code === q.get('plan_code')))
        .filter((s) => !within || (!!s.current_period_end && Date.parse(s.current_period_end) - Date.now() <= within * DAY && Date.parse(s.current_period_end) > Date.now()))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((s) => ({ ...subscriptionDto(s, [s]), user_id: s.user_id, created_at: s.created_at }));
      return json(200, paginate(rows, url));
    }),
    route('POST', '/admin/orders/{orderId}/refund', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const o = state.orders[params.orderId!];
      if (!o) return error(404, 'not_found', 'Order not found');
      const parsed = refundInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Validation failed', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
      if (o.status !== 'paid') return error(409, 'conflict', 'Only paid orders can be refunded', { reason: 'order_not_paid' });
      o.status = 'refunded';
      for (const p of Object.values(state.payments)) if (p.order_id === o.id && p.status === 'success') p.status = 'refunded';
      const now = nowIso();
      for (const s of Object.values(state.subscriptions)) {
        if (s.source_order_id !== o.id) continue;
        s.status = 'expired';
        s.current_period_end = now;
      }
      let revoked = 0;
      let shortfall = 0;
      if (parsed.data.revoke_credits) {
        const granted = state.ledger.filter((l) => l.user_id === o.user_id && l.delta > 0 && (l.ref?.id === o.id || (l.ref?.type === 'subscription' && state.subscriptions[l.ref.id ?? '']?.source_order_id === o.id))).reduce((s, l) => s + l.delta, 0);
        revoked = Math.min(granted, balanceOf(state, o.user_id));
        shortfall = granted - revoked;
        if (revoked > 0) addLedger(state, o.user_id, { delta: -revoked, reason: 'refund', ref: { type: 'order', id: o.id }, note: shortfall ? `shortfall=${shortfall}` : parsed.data.reason });
      }
      if (o.invoice?.status === 'issued') {
        o.invoice.status = 'cancelled';
        o.invoice.cancelled_at = now;
        o.invoice.updated_at = now;
      }
      recomputeUserPlan(state, o.user_id);
      emitTo(state, o.user_id, 'order.updated', { order_id: o.id, status: 'refunded', paid_at: o.paid_at });
      persist();
      return json(200, { order: orderDto(state, o), revoked: { credits: revoked, credits_shortfall: shortfall }, provider_refund: { status: 'manual' } });
    }),
    route('POST', '/admin/users/{userId}/credits', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const target = state.users[params.userId!];
      if (!target) return error(404, 'not_found', 'User not found');
      const parsed = adminCreditAdjustInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Validation failed', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
      if (balanceOf(state, target.id) + parsed.data.delta < 0) return error(409, 'conflict', 'Insufficient balance', { reason: 'insufficient_balance', balance: balanceOf(state, target.id) });
      const rec = addLedger(state, target.id, { delta: parsed.data.delta, reason: 'admin_adjust', ref: { type: 'admin', id: a.id }, note: parsed.data.note, expires_at: parsed.data.expires_at ?? null });
      persist();
      return json(200, { user_id: target.id, delta: rec.delta, balance_after: rec.balance_after, ledger_id: rec.id, reason: 'admin_adjust', note: parsed.data.note, actor_id: a.id });
    }),
    route('GET', '/admin/users/{userId}/credits/ledger', ({ params, url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const rows = state.ledger.filter((l) => l.user_id === params.userId).sort((x, y) => y.id - x.id).map(({ user_id: _u, ...rest }) => rest);
      return json(200, paginate(rows, url));
    }),
    route('GET', '/admin/billing/dead-letters', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const job = url.searchParams.get('job');
      const all = url.searchParams.get('include_resolved') === 'true';
      const rows = Object.values(state.deadLetters)
        .filter((x) => (!job || x.job === job) && (all || !x.resolved_at))
        .sort((x, y) => y.failed_at.localeCompare(x.failed_at));
      return json(200, paginate(rows, url));
    }),
    route('POST', '/admin/billing/dead-letters/{deadLetterId}/retry', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const dl = state.deadLetters[params.deadLetterId!];
      if (!dl) return error(404, 'not_found', 'Dead letter not found');
      if (dl.resolved_at) return error(409, 'conflict', 'Already resolved', { reason: 'already_resolved' });
      const o = state.orders[dl.business_id];
      dl.retried_at = nowIso();
      dl.retried_by = a.id;
      if (o) {
        if (o.invoice) o.invoice.status = 'pending';
        issueInvoice(state, o);
        if (o.invoice?.status === 'issued') dl.resolved_at = nowIso();
      }
      persist();
      return json(200, { id: dl.id, status: dl.resolved_at ? 'resolved' : 'queued', invoice_status: o?.invoice?.status ?? null });
    }),
    route('GET', '/admin/billing/reconciliations', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const provider = url.searchParams.get('provider');
      return json(200, Object.values(state.reconciliations).filter((r) => !provider || r.provider === provider).sort((x, y) => y.run_at.localeCompare(x.run_at)));
    }),
    route('POST', '/admin/billing/reconciliations', ({ body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const b = (body ?? {}) as { provider?: string; for_date?: string; source?: 'csv' | 'query'; csv?: string };
      const provider = b.provider ?? 'mock';
      const forDate = b.for_date ?? vnDate(new Date(Date.now() - DAY).toISOString());
      const system = Object.values(state.payments).filter((p) => p.provider === provider && p.status === 'success' && p.confirmed_at && vnDate(p.confirmed_at) === forDate);
      const mismatches: ReconciliationMismatch[] = [];
      let statementCount = 0;
      let matched = 0;
      let actual = 0;
      if ((b.source ?? 'csv') === 'csv') {
        const lines = (b.csv ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const header = (lines.shift() ?? '').split(/[,;]/).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
        const col = (names: string[]) => header.findIndex((h) => names.includes(h));
        const iTxn = col(['provider_txn_id', 'txn_id', 'vnp_transactionno', 'transid', 'zp_trans_id']);
        const iRef = col(['merchant_ref', 'vnp_txnref', 'orderid', 'app_trans_id']);
        const iAmt = col(['amount', 'so_tien', 'vnp_amount_vnd']);
        const iSt = col(['status', 'trang_thai']);
        const seen = new Set<string>();
        for (const line of lines) {
          const cells = line.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
          const txn = iTxn >= 0 ? (cells[iTxn] ?? null) : null;
          const ref = iRef >= 0 ? (cells[iRef] ?? '').replace(/^\d{6}_/, '') || null : null;
          const amount = iAmt >= 0 ? Number(cells[iAmt]) : NaN;
          const st = (iSt >= 0 ? (cells[iSt] ?? '') : 'success').toLowerCase();
          const ok = ['success', 'paid', '00', 'thành công'].includes(st);
          statementCount++;
          if (ok && Number.isFinite(amount)) actual += amount;
          const sys = system.find((p) => (txn && p.provider_txn_id === txn) || (ref && p.ref === ref));
          if (!sys) {
            if (ok) mismatches.push({ type: 'missing_in_system', provider_txn_id: txn, merchant_ref: ref, order_id: null, system_amount: null, statement_amount: Number.isFinite(amount) ? amount : null, system_status: null, statement_status: st });
            continue;
          }
          seen.add(sys.id);
          if (Number.isFinite(amount) && amount !== sys.amount) mismatches.push({ type: 'amount_mismatch', provider_txn_id: sys.provider_txn_id, merchant_ref: sys.ref, order_id: sys.order_id, system_amount: sys.amount, statement_amount: amount, system_status: sys.status, statement_status: st });
          else if (!ok) mismatches.push({ type: 'status_mismatch', provider_txn_id: sys.provider_txn_id, merchant_ref: sys.ref, order_id: sys.order_id, system_amount: sys.amount, statement_amount: amount, system_status: sys.status, statement_status: st });
          else matched++;
        }
        for (const p of system) if (!seen.has(p.id)) mismatches.push({ type: 'missing_in_statement', provider_txn_id: p.provider_txn_id, merchant_ref: p.ref, order_id: p.order_id, system_amount: p.amount, statement_amount: null, system_status: p.status, statement_status: null });
      } else {
        matched = system.length;
        actual = system.reduce((s, p) => s + p.amount, 0);
      }
      const run: ReconciliationRun = {
        id: uuid(),
        provider,
        for_date: forDate,
        status: mismatches.length ? 'mismatched' : 'matched',
        expected_total: system.reduce((s, p) => s + p.amount, 0),
        actual_total: actual,
        mismatches,
        mismatch_count: mismatches.length,
        run_at: nowIso(),
        source: b.source ?? 'csv',
        system_count: system.length,
        statement_count: (b.source ?? 'csv') === 'csv' ? statementCount : null,
        matched_count: matched,
      };
      // Chạy lại cùng cổng × ngày ghi đè (UNIQUE như API)
      for (const [k, r] of Object.entries(state.reconciliations)) if (r.provider === provider && r.for_date === forDate) delete state.reconciliations[k];
      state.reconciliations[run.id] = run;
      persist();
      return json(201, run);
    }),
    route('GET', '/admin/billing/reconciliations/{runId}', ({ params, url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const run = state.reconciliations[params.runId!];
      if (!run) return error(404, 'not_found', 'Run not found');
      if (url.searchParams.get('format') === 'csv') {
        const head = 'type,provider_txn_id,merchant_ref,order_id,system_amount,statement_amount,system_status,statement_status';
        const rows = run.mismatches.map((m) => [m.type, m.provider_txn_id, m.merchant_ref, m.order_id, m.system_amount, m.statement_amount, m.system_status, m.statement_status].map((v) => (v === null ? '' : String(v))).join(','));
        return new Response([head, ...rows].join('\n'), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
      }
      return json(200, run);
    }),
    route('GET', '/admin/promotions', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const q = url.searchParams;
      const rows = allPromotions(state)
        .filter((p) => (!q.get('active') || String(p.is_active) === q.get('active')) && (!q.get('kind') || p.kind === q.get('kind')) && (!q.get('q') || p.code.includes((q.get('q') ?? '').toUpperCase())))
        .sort((x, y) => y.created_at.localeCompare(x.created_at) || x.code.localeCompare(y.code))
        .map(promoAdminDto);
      return json(200, paginate(rows, url));
    }),
    route('GET', '/admin/promotions/{promotionId}', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const p = allPromotions(state).find((x) => x.id === params.promotionId);
      return p ? json(200, promoAdminDto(p)) : error(404, 'not_found', 'Promotion not found');
    }),
    route('POST', '/admin/promotions', ({ body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const parsed = promotionCreateInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Validation failed', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
      if (allPromotions(state).some((p) => p.code === parsed.data.code)) return error(409, 'conflict', 'Code already exists', { reason: 'code_taken' });
      const now = nowIso();
      const v = parsed.data;
      const p: MockPromotion = { id: uuid(), code: v.code, kind: v.kind, value: v.value, name: v.name ?? null, plan_codes: v.plan_codes ?? [], conditions: v.conditions, valid_from: v.valid_from, valid_to: v.valid_to, max_uses: v.max_uses ?? null, per_user_limit: v.per_user_limit, is_active: v.is_active, created_at: now, updated_at: now };
      state.promotions[p.id] = p;
      persist();
      return json(201, promoAdminDto(p));
    }),
    route('PATCH', '/admin/promotions/{promotionId}', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const cur = allPromotions(state).find((x) => x.id === params.promotionId);
      if (!cur) return error(404, 'not_found', 'Promotion not found');
      const parsed = promotionPatchInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Validation failed', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
      const v = parsed.data;
      const next: MockPromotion = {
        ...cur,
        ...(v.kind ? { kind: v.kind } : {}),
        ...(v.value !== undefined ? { value: v.value } : {}),
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.plan_codes ? { plan_codes: v.plan_codes } : {}),
        ...(v.valid_from ? { valid_from: v.valid_from } : {}),
        ...(v.valid_to ? { valid_to: v.valid_to } : {}),
        ...(v.max_uses !== undefined ? { max_uses: v.max_uses } : {}),
        ...(v.per_user_limit !== undefined ? { per_user_limit: v.per_user_limit } : {}),
        ...(v.is_active !== undefined ? { is_active: v.is_active } : {}),
        ...(v.conditions ? { conditions: v.conditions } : {}),
        updated_at: nowIso(),
      };
      state.promotions[next.id] = next;
      persist();
      return json(200, promoAdminDto(next));
    }),
    route('POST', '/admin/billing/jobs/{job}', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      if (!(BILLING_JOBS as readonly string[]).includes(params.job!)) return error(400, 'validation_failed', 'Unknown job', { issues: [{ path: 'job', message: 'Unknown job', code: 'invalid_value' }] });
      const result = runJob(params.job!);
      persist();
      return json(200, { job: params.job, job_id: `manual-${Date.now()}`, mode: 'inline', status: 'completed', result });
    }),
    route('PUT', '/admin/flags/{key}', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const b = (body ?? {}) as { enabled?: boolean };
      state.flags[params.key!] = { enabled: b.enabled !== false };
      persist();
      return json(200, { key: params.key, enabled: b.enabled !== false, rules: {} });
    }),
  ];

  function promoAdminDto(p: MockPromotion) {
    const reds = Object.values(state.redemptions).filter((r) => r.promotion_id === p.id);
    const redeemed = reds.filter((r) => r.status === 'redeemed');
    return {
      id: p.id,
      code: p.code,
      kind: p.kind,
      value: p.value,
      name: p.name,
      plan_ids: p.plan_codes.map((c) => MOCK_PLANS.find((x) => x.code === c)?.id).filter(Boolean),
      plan_codes: p.plan_codes,
      conditions: p.conditions,
      valid_from: p.valid_from,
      valid_to: p.valid_to,
      max_uses: p.max_uses,
      used_count: redeemed.length,
      per_user_limit: p.per_user_limit,
      is_active: p.is_active,
      stackable: false,
      stats: { reserved: reds.filter((r) => r.status === 'reserved').length, redeemed: redeemed.length, released: reds.filter((r) => r.status === 'released').length, discount_total: redeemed.reduce((s, r) => s + r.discount, 0), credits_total: redeemed.reduce((s, r) => s + r.credits, 0) },
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }
}
