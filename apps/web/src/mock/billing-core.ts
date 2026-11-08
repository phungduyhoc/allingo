import { MIN_PAYABLE_VND, type Order, type PromotionRejectReason, type Subscription } from '@allingo/schemas/api/billing';
import type { Plan } from '@/lib/billing';
import { MOCK_REALTIME_EVENT, type MockRealtimeDetail } from '@/lib/realtime';
import { MOCK_PLANS, MOCK_PROMOTIONS, type MockPromotion } from './billing-fixtures';
import type { MockLedgerRecord, MockNotificationRecord, MockOrderRecord, MockState, MockSubscriptionRecord, MockUserRecord } from './state';

/**
 * Lõi nghiệp vụ billing giả lập (S7/S8) dùng chung cho route billing/growth/admin của mock: realtime, ledger credit, thông báo
 * in-app (title/body null → web dịch theo template_code), subscription hiện hành, DTO Order/Subscription, đánh giá mã
 * khuyến mãi (thứ tự lý do như `evaluatePromotion` của API). Chỉ dev/E2E – không phải logic thật.
 */

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const DAY = 86_400_000;

/** Phát sự kiện "Socket.IO" cho phiên đang mở của người dùng (mock: CustomEvent trên window, trễ như mạng) */
export function emitTo(state: MockState, userId: string, event: string, data: unknown): void {
  if (typeof window === 'undefined' || state.sessionUserId !== userId) return;
  window.setTimeout(() => window.dispatchEvent(new CustomEvent<MockRealtimeDetail>(MOCK_REALTIME_EVENT, { detail: { event, data } })), 60);
}

export const balanceOf = (state: MockState, userId: string) => state.credits[userId] ?? 0;

export function addLedger(state: MockState, userId: string, entry: { delta: number; reason: string; ref?: MockLedgerRecord['ref']; note?: string | null; expires_at?: string | null }): MockLedgerRecord {
  const balance = balanceOf(state, userId) + entry.delta;
  state.credits[userId] = balance;
  const rec: MockLedgerRecord = {
    id: (state.ledger.at(-1)?.id ?? 1000) + 1,
    user_id: userId,
    delta: entry.delta,
    balance_after: balance,
    reason: entry.reason,
    ref: entry.ref ?? null,
    expires_at: entry.expires_at ?? null,
    note: entry.note ?? null,
    created_at: nowIso(),
  };
  state.ledger.push(rec);
  emitTo(state, userId, 'credits.changed', { balance });
  return rec;
}

export function notificationDto(n: MockNotificationRecord) {
  return {
    id: n.id,
    channel: 'inapp',
    template_code: n.template_code,
    payload: n.payload,
    status: 'sent',
    scheduled_at: n.created_at,
    sent_at: n.created_at,
    read_at: n.read_at,
    category: n.category,
    // Mock không dựng sẵn nội dung → web dịch theo template_code + payload (đường dự phòng của API khi thiếu bản dịch)
    title: null,
    body: null,
    url: n.url,
  };
}

/** Tạo thông báo in-app + phát `notification.new` (như NotificationService.send kênh inapp) */
export function notify(state: MockState, userId: string, template: string, data: Record<string, unknown>, opts: { category: string; url?: string | null }): MockNotificationRecord {
  const user = state.users[userId];
  const n: MockNotificationRecord = {
    id: uuid(),
    user_id: userId,
    template_code: template,
    category: opts.category,
    payload: { data, category: opts.category, locale: user?.ui_locale ?? 'vi', url: opts.url ?? null, transactional: opts.category === 'billing' },
    url: opts.url ?? null,
    created_at: nowIso(),
    read_at: null,
  };
  state.notifications[n.id] = n;
  emitTo(state, userId, 'notification.new', notificationDto(n));
  return n;
}

export const planById = (id: string): Plan | undefined => MOCK_PLANS.find((p) => p.id === id);
export const planByPrice = (priceId: string): Plan | undefined => MOCK_PLANS.find((p) => p.price?.id === priceId);
export const planByCode = (code: string): Plan | undefined => MOCK_PLANS.find((p) => p.code === code);

export function allPromotions(state: MockState): MockPromotion[] {
  const byId = new Map(MOCK_PROMOTIONS.map((p) => [p.id, p]));
  for (const p of Object.values(state.promotions)) byId.set(p.id, p);
  return [...byId.values()];
}

export const promotionByCode = (state: MockState, code: string) => allPromotions(state).find((p) => p.code === code.trim().toUpperCase());

// ----------------------------------------------------------------------------- Subscription

export function isCurrent(s: MockSubscriptionRecord, now = Date.now()): boolean {
  if (s.status === 'expired') return false;
  if (Date.parse(s.current_period_start) > now) return false;
  return !s.current_period_end || Date.parse(s.current_period_end) > now;
}

/** Hết kỳ → expired (job subscription.expire chạy "lười" khi đọc); cập nhật gói của người dùng + thông báo */
export function sweepSubscriptions(state: MockState, userId: string): void {
  const now = Date.now();
  let changed = false;
  for (const s of Object.values(state.subscriptions)) {
    if (s.user_id !== userId || s.status === 'expired' || !s.current_period_end) continue;
    if (Date.parse(s.current_period_end) <= now) {
      const wasTrial = s.status === 'trialing';
      s.status = 'expired';
      changed = true;
      const plan = planById(s.plan_id);
      notify(state, userId, wasTrial ? 'billing.trial_ended' : 'billing.subscription_expired', { plan_name: plan?.name ?? null, plan_code: plan?.code }, { category: 'billing', url: '/pricing' });
    }
  }
  if (changed) recomputeUserPlan(state, userId);
}

export function currentSubs(state: MockState, userId: string): MockSubscriptionRecord[] {
  return Object.values(state.subscriptions).filter((s) => s.user_id === userId && isCurrent(s));
}

/** Gói hiện hành → `u.plan` (quota Pro/Free của mock) + `u.plan_kind` (GET /me/entitlements) */
export function recomputeUserPlan(state: MockState, userId: string): void {
  const u = state.users[userId];
  if (!u) return;
  const cur = currentSubs(state, userId);
  const kinds = cur.map((s) => planById(s.plan_id)?.kind).filter(Boolean) as string[];
  const best = ['lifetime', 'combo', 'yearly', 'monthly'].find((k) => kinds.includes(k)) ?? null;
  const before = u.plan_kind ?? 'free';
  u.plan = best ? 'monthly' : 'free';
  u.plan_kind = best ?? 'free';
  if (before !== u.plan_kind) emitTo(state, userId, 'entitlements.changed', {});
}

export function subscriptionDto(s: MockSubscriptionRecord, all: MockSubscriptionRecord[]): Subscription {
  const plan = planById(s.plan_id)!;
  const now = Date.now();
  const current = isCurrent(s, now);
  const upcoming = s.status !== 'expired' && Date.parse(s.current_period_start) > now;
  void all;
  return {
    id: s.id,
    plan: planSummary(plan),
    program: s.program,
    status: s.status,
    current_period_start: s.current_period_start,
    current_period_end: s.current_period_end,
    cancel_at_period_end: s.cancel_at_period_end,
    is_current: current,
    upcoming,
    days_left: s.current_period_end ? Math.max(0, Math.ceil((Date.parse(s.current_period_end) - now) / DAY)) : null,
    source_order_id: s.source_order_id,
  };
}

export function planSummary(plan: Plan) {
  return { id: plan.id, code: plan.code, kind: plan.kind, programs: plan.programs, name: plan.name, credits_included: plan.credits_included, credits_period: plan.credits_period, duration_days: plan.duration_days };
}

// ----------------------------------------------------------------------------- Đơn hàng

export function orderPayable(o: MockOrderRecord, now = Date.now()): boolean {
  return (o.status === 'pending' || o.status === 'failed' || o.status === 'cancelled') && Date.parse(o.expires_at) > now;
}

/** Đơn chờ quá hạn → expired + nhả lượt mã (job order.expire chạy lười) */
export function sweepOrders(state: MockState): number {
  const now = Date.now();
  let n = 0;
  for (const o of Object.values(state.orders)) {
    if ((o.status === 'pending' || o.status === 'failed' || o.status === 'cancelled') && Date.parse(o.expires_at) <= now) {
      o.status = 'expired';
      n++;
      for (const r of Object.values(state.redemptions)) if (r.order_id === o.id && r.status === 'reserved') r.status = 'released';
    }
  }
  return n;
}

export function orderDto(state: MockState, o: MockOrderRecord, opts: { admin?: boolean } = {}): Order & { user_id?: string } {
  const plan = planById(o.plan_id)!;
  const promo = o.promotion_id ? allPromotions(state).find((p) => p.id === o.promotion_id) : undefined;
  const payments = Object.values(state.payments)
    .filter((p) => p.order_id === o.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      amount: p.amount,
      created_at: p.created_at,
      confirmed_at: p.confirmed_at,
      ...(opts.admin ? { provider_txn_id: p.provider_txn_id, merchant_ref: p.ref } : {}),
    }));
  const inv = o.invoice;
  const pdfExp = new Date(Date.now() + 10 * 60_000).toISOString();
  return {
    id: o.id,
    plan: planSummary(plan),
    price_id: o.price_id,
    quantity: 1,
    currency: 'VND',
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    promotion_code: o.promotion_code,
    status: o.status,
    payments,
    invoice: inv
      ? {
          status: inv.status as NonNullable<Order['invoice']>['status'],
          provider: 'mock',
          series: inv.series,
          invoice_no: inv.invoice_no,
          lookup_code: inv.lookup_code,
          lookup_url: inv.lookup_code ? `https://einvoice.mock.allingo.dev/lookup?code=${inv.lookup_code}` : null,
          // PDF mẫu tĩnh (mock) – API thật trả URL ký 10 phút của bucket invoices
          pdf_url: inv.status === 'issued' || inv.status === 'cancelled' ? `/mock/invoice-sample.pdf?order=${o.id}&exp=${Math.floor(Date.parse(pdfExp) / 1000)}` : null,
          pdf_expires_at: inv.status === 'issued' || inv.status === 'cancelled' ? pdfExp : null,
          issued_at: inv.issued_at,
          cancelled_at: inv.cancelled_at,
          buyer_type: o.buyer_info?.type ?? null,
        }
      : null,
    created_at: o.created_at,
    paid_at: o.paid_at,
    expires_at: o.expires_at,
    payable: orderPayable(o),
    promotion: promo ? { id: promo.id, code: promo.code, kind: promo.kind, value: promo.value, bonus_credits: o.bonus_credits } : null,
    buyer_info: o.buyer_info,
    ...(opts.admin ? { user_id: o.user_id } : {}),
  };
}

// ----------------------------------------------------------------------------- Khuyến mãi

export interface PromoEval {
  promo: MockPromotion | undefined;
  reason: PromotionRejectReason | null;
  discount: number;
  total: number;
  subtotal: number;
}

/** Thứ tự lý do cố định như API: tồn tại → bật → thời gian → khách → loại đổi trực tiếp → gói → chương trình → người mới → lượt → tối thiểu */
export function evaluatePromo(state: MockState, user: MockUserRecord | null, code: string, ctx: { plan?: Plan; program?: string; mode: 'order' | 'redeem' | 'validate' }): PromoEval {
  const promo = promotionByCode(state, code);
  const subtotal = ctx.plan?.price?.amount ?? 0;
  const out = (reason: PromotionRejectReason | null, discount = 0): PromoEval => ({ promo, reason, discount, total: Math.max(0, subtotal - discount), subtotal });
  if (!promo) return out('not_found');
  if (!promo.is_active) return out('inactive');
  const now = Date.now();
  if (Date.parse(promo.valid_from) > now) return out('not_started');
  if (Date.parse(promo.valid_to) <= now) return out('expired');
  if (!user || user.is_guest) return out('guest_account');
  const redeemOnly = promo.kind === 'trial_days' || (promo.kind === 'credit_bonus' && !!promo.conditions.standalone);
  if (redeemOnly && ctx.mode !== 'redeem') {
    // validate không có gói cho mã đổi trực tiếp → hợp lệ để đổi; có gói/đặt đơn → requires_redeem
    if (ctx.mode === 'validate' && !ctx.plan) return redeemChecks(state, user, promo, out);
    return out('requires_redeem');
  }
  if (!redeemOnly && ctx.mode === 'redeem') return out('requires_order');
  if (redeemOnly) return redeemChecks(state, user, promo, out);
  if (!ctx.plan) return out('plan_required');
  const c = promo.conditions;
  if ((promo.plan_codes.length && !promo.plan_codes.includes(ctx.plan.code)) || (c.plan_kinds?.length && !c.plan_kinds.includes(ctx.plan.kind as never))) return out('plan_not_eligible');
  if (c.program_codes?.length && !ctx.plan.programs.some((p) => c.program_codes!.includes(p as never))) return out('program_not_eligible');
  if (c.new_users_only) {
    const paid = Object.values(state.orders).some((o) => o.user_id === user.id && (o.status === 'paid' || o.status === 'refunded'));
    const ageDays = (now - Date.parse(user.created_at)) / DAY;
    if (paid || ageDays > (c.new_user_max_days ?? 30)) return out('new_users_only');
  }
  const used = Object.values(state.redemptions).filter((r) => r.promotion_id === promo.id && r.status !== 'released');
  if (promo.max_uses !== null && used.length >= promo.max_uses) return out('max_uses_reached');
  if (used.filter((r) => r.user_id === user.id && r.status === 'redeemed').length >= promo.per_user_limit) return out('per_user_limit_reached');
  if (c.min_subtotal && subtotal < c.min_subtotal) return out('min_subtotal_not_met');
  const discount = promo.kind === 'percent' ? Math.round((subtotal * promo.value) / 100) : promo.kind === 'fixed' ? Math.min(subtotal, promo.value) : 0;
  if (subtotal - discount < MIN_PAYABLE_VND && discount > 0) return out('below_minimum');
  return out(null, discount);
}

function redeemChecks(state: MockState, user: MockUserRecord, promo: MockPromotion, out: (r: PromotionRejectReason | null) => PromoEval): PromoEval {
  const mine = Object.values(state.redemptions).filter((r) => r.promotion_id === promo.id && r.user_id === user.id && r.status === 'redeemed');
  if (promo.kind === 'trial_days') {
    if (mine.length) return out('trial_already_used');
    if (currentSubs(state, user.id).length) return out('already_pro');
  } else if (mine.length >= promo.per_user_limit) return out('per_user_limit_reached');
  return out(null);
}

// ----------------------------------------------------------------------------- Hoá đơn điện tử (mock: phát hành ngay)

let failNextInvoice = false;
export function setFailNextInvoice(v: boolean): void {
  failNextInvoice = v;
}

export function issueInvoice(state: MockState, o: MockOrderRecord): void {
  const now = nowIso();
  o.invoice ??= { status: 'pending', series: null, invoice_no: null, lookup_code: null, issued_at: null, cancelled_at: null, attempts: 0, last_error: null, created_at: now, updated_at: now };
  const inv = o.invoice;
  inv.attempts += 1;
  inv.updated_at = now;
  if (failNextInvoice) {
    failNextInvoice = false;
    inv.status = 'failed';
    inv.last_error = 'provider_error: mock einvoice unavailable';
    const id = uuid();
    state.deadLetters[id] = { id, queue: 'maintenance', job: 'invoice.issue', business_id: o.id, payload: { order_id: o.id }, error: inv.last_error, attempts: 6, failed_at: now, resolved_at: null, retried_at: null, retried_by: null };
    return;
  }
  state.invoiceSeq += 1;
  inv.status = 'issued';
  inv.series = '1C26MAL';
  inv.invoice_no = String(state.invoiceSeq).padStart(8, '0');
  inv.lookup_code = uuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  inv.issued_at = now;
  inv.last_error = null;
  const plan = planById(o.plan_id);
  notify(state, o.user_id, 'billing.invoice_issued', { order_id: o.id, total: o.total, series: inv.series, invoice_no: inv.invoice_no, lookup_code: inv.lookup_code, plan_name: plan?.name ?? null, buyer_type: o.buyer_info?.type ?? 'personal' }, { category: 'billing', url: `/account/orders/${o.id}` });
}
