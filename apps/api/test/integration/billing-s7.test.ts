import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { loadEnv } from '../../src/config/env.js';
import {
  BillingJobsService,
  CreditService,
  FeatureGateService,
  OrdersService,
  PaymentProviderRegistry,
  PaymentsService,
  ReconciliationService,
  SubscriptionsService,
  encodeMerchantRef,
  momoRaw,
  signMockWebhook,
  vnpaySign,
  type HttpClient,
  type MockWebhookPayload,
} from '../../src/modules/billing/index.js';
import { hmacHex } from '../../src/modules/billing/payments/crypto.js';
import { MOMO_IPN_FIELDS } from '../../src/modules/billing/payments/momo.provider.js';
import { bootTestApp, client } from './setup.js';

/**
 * Sprint 7 – billing end-to-end trên PG/Redis cục bộ: plans/promotions/orders/pay, webhook-first (idempotent, đồng thời,
 * sai chữ ký, đến trước /pay, sai số tiền), 3 cổng với credential GIẢ + HTTP giả lập (không gọi sandbox thật), job
 * order.expire / payment.reconcile / subscription.expire / credit.*, hoàn tiền admin, gating plan × feature, đối soát.
 */
const V = JSON.parse(readFileSync(new URL('../fixtures/payments/vectors.json', import.meta.url), 'utf8')) as { vnpay: Record<string, string>; momo: Record<string, string>; zalopay: Record<string, string> };
const MOCK_SECRET = 'test-mock-secret-s7';
const PASSWORD = 'Allingo@2026';
const uniq = () => Math.random().toString(36).slice(2, 10);
type Api = ReturnType<typeof client>;
const { billingPayments, billingCreditLedger, billingSubscriptions, opsAuditLogs, opsOutbox, opsNotifications } = schema;

describe('S7 billing (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let admin: Api;
  const prices: Record<string, string> = {};
  const planIds: Record<string, string> = {};
  let fullSetId = '';
  const httpLog: Array<{ url: string; body?: string }> = [];
  const httpQueue: Array<(url: string, body?: string) => Record<string, unknown> | null> = [];

  const raw = (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url: `/v1${url}`, payload: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

  const newUser = async () => {
    const api = client(app);
    const r = await api.call('POST', '/auth/register', { email: `s7-${uniq()}@example.com`, password: 'Password123!', display_name: 'S7', accept_terms: true });
    expect(r.status).toBe(201);
    return { api, id: r.body.user.id as string };
  };
  const createOrder = async (api: Api, plan: string, extra: Record<string, unknown> = {}, key = crypto.randomUUID()) => api.call('POST', '/orders', { price_id: prices[plan], ...extra }, { 'idempotency-key': key });
  const order = async (api: Api, plan: string, extra: Record<string, unknown> = {}) => {
    const r = await createOrder(api, plan, extra);
    expect(r.status).toBe(201);
    return r.body as { id: string; total: number; status: string };
  };
  const payMock = async (api: Api, orderId: string) => {
    const r = await api.call('POST', `/orders/${orderId}/pay`, { provider: 'mock' });
    expect(r.status).toBe(200);
    return new URL(r.body.redirect_url as string).searchParams.get('ref')!;
  };
  const mockPayload = (ref: string, amount: number, over: Partial<MockWebhookPayload> = {}): MockWebhookPayload => ({ ref, txn_id: `T${uniq()}${uniq()}`.toUpperCase(), amount, currency: 'VND', status: 'paid', ...over });
  const mockHook = (p: MockWebhookPayload, sig = signMockWebhook(MOCK_SECRET, p)) => raw('POST', '/webhooks/payments/mock', p, { 'x-mock-signature': sig });
  const buy = async (api: Api, plan: string) => {
    const o = await order(api, plan);
    const ref = await payMock(api, o.id);
    const r = await mockHook(mockPayload(ref, o.total));
    expect(r.json()).toMatchObject({ outcome: 'ok' });
    return o;
  };
  const ledgerOf = (userId: string) => dbs.db.select().from(billingCreditLedger).where(eq(billingCreditLedger.userId, userId)).orderBy(billingCreditLedger.id);
  const ents = async (api: Api) => (await api.call('GET', '/me/entitlements?program=toeic')).body as { is_pro: boolean; plan_kind: string; features: string[]; credits: number };
  const startFull = (api: Api) => api.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: fullSetId }, { 'idempotency-key': crypto.randomUUID() });

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    process.env.PAYMENT_PROVIDERS = 'mock,vnpay,momo,zalopay';
    process.env.PAYMENT_MOCK_SECRET = MOCK_SECRET;
    process.env.VNPAY_TMN_CODE = V.vnpay.tmn_code;
    process.env.VNPAY_HASH_SECRET = V.vnpay.hash_secret;
    process.env.MOMO_PARTNER_CODE = V.momo.partner_code;
    process.env.MOMO_ACCESS_KEY = V.momo.access_key;
    process.env.MOMO_SECRET_KEY = V.momo.secret_key;
    process.env.ZALOPAY_APP_ID = V.zalopay.app_id;
    process.env.ZALOPAY_KEY1 = V.zalopay.key1;
    process.env.ZALOPAY_KEY2 = V.zalopay.key2;
    app = await bootTestApp();
    dbs = app.get(DbService);
    const fake: HttpClient = async (url, init) => {
      httpLog.push({ url, body: init.body });
      const h = httpQueue.shift();
      const json = h ? h(url, init.body) : null;
      return { status: 200, text: async () => JSON.stringify(json ?? {}) };
    };
    app.get(PaymentProviderRegistry).setHttpClient(fake);
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    expect((await admin.call('PUT', '/admin/flags/ff.billing.checkout', { enabled: true, rules: {} })).status).toBe(200);
    const plans = await admin.call('GET', '/plans?program=toeic');
    for (const p of plans.body as Array<{ code: string; id: string; price: { id: string } | null }>) {
      planIds[p.code] = p.id;
      if (p.price) prices[p.code] = p.price.id;
    }
    const sets = await admin.call('GET', '/programs/toeic/test-sets?kind=full');
    fullSetId = sets.body.data.find((t: { code: string }) => t.code === 'toeic-reading-full-01').id;
  });

  afterAll(async () => {
    for (const k of ['PAYMENT_PROVIDERS', 'PAYMENT_MOCK_SECRET', 'VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET', 'MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY', 'ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2']) delete process.env[k];
    await app?.close();
  });

  // ------------------------------------------------------------------ catalog & checkout
  describe('plans · providers · promotions', () => {
    it('GET /plans?program=toeic: gói TOEIC + combo + credit pack + Free, mỗi gói có giá có price.id; không có gói IELTS', async () => {
      const r = await client(app).call('GET', '/plans?program=toeic');
      expect(r.status).toBe(200);
      const codes = (r.body as Array<{ code: string }>).map((p) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['free', 'toeic_pro_monthly', 'toeic_pro_yearly', 'toeic_pro_lifetime', 'combo_all_yearly', 'credits_1000']));
      expect(codes).not.toContain('ielts_pro_monthly');
      const monthly = (r.body as Array<{ code: string; price: { id: string; amount: number; currency: string } }>).find((p) => p.code === 'toeic_pro_monthly')!;
      expect(monthly.price).toMatchObject({ amount: 199_000, currency: 'VND' });
      expect(monthly.price.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('GET /payments/providers: chỉ cổng đủ credential; registry thiếu credential → không liệt kê, /pay 503', async () => {
      const r = await client(app).call('GET', '/payments/providers');
      expect(r.body.checkout_enabled).toBe(true);
      expect((r.body.providers as Array<{ code: string }>).map((p) => p.code)).toEqual(['vnpay', 'momo', 'zalopay', 'mock']);
      const reg = new PaymentProviderRegistry({ ...loadEnv(), PAYMENT_PROVIDERS: 'vnpay,momo,zalopay', VNPAY_TMN_CODE: undefined, MOMO_SECRET_KEY: undefined });
      expect(reg.listAvailable().map((p) => p.code)).toEqual(['zalopay']);
      expect(() => reg.require('vnpay')).toThrow(/disabled/i);
      const { api } = await newUser();
      const o = await order(api, 'toeic_pro_monthly');
      const p = await api.call('POST', `/orders/${o.id}/pay`, { provider: 'payos' });
      expect(p.status).toBe(503);
      expect(p.body.error.code).toBe('feature_disabled');
    });

    it('POST /promotions/validate: WELCOME10 hợp lệ; EXPIRED2025 hết hạn; TOEIC50K không áp dụng gói IELTS; mã lạ not_found', async () => {
      const { api } = await newUser();
      const ok = await api.call('POST', '/promotions/validate', { code: 'welcome10', price_id: prices.toeic_pro_monthly });
      expect(ok.body).toMatchObject({ valid: true, code: 'WELCOME10', discount: 19_900, total: 179_100, currency: 'VND', reason: null });
      expect((await api.call('POST', '/promotions/validate', { code: 'EXPIRED2025', plan_id: planIds.toeic_pro_monthly })).body).toMatchObject({ valid: false, reason: 'expired', total: 199_000 });
      const ielts = (await client(app).call('GET', '/plans?program=ielts')).body.find((p: { code: string }) => p.code === 'ielts_pro_monthly');
      expect((await api.call('POST', '/promotions/validate', { code: 'TOEIC50K', plan_id: ielts.id })).body).toMatchObject({ valid: false, reason: 'plan_not_eligible' });
      expect((await api.call('POST', '/promotions/validate', { code: 'NOPE', plan_id: planIds.toeic_pro_monthly })).body).toMatchObject({ valid: false, reason: 'not_found' });
    });
  });

  describe('orders', () => {
    it('Idempotency-Key bắt buộc; cùng khoá → cùng đơn (201 rồi 200); cùng khoá khác giá → 409; khách → 403', async () => {
      const { api } = await newUser();
      expect((await api.call('POST', '/orders', { price_id: prices.toeic_pro_monthly })).status).toBe(400);
      const key = crypto.randomUUID();
      const a = await createOrder(api, 'toeic_pro_monthly', {}, key);
      const b = await createOrder(api, 'toeic_pro_monthly', {}, key);
      expect([a.status, b.status]).toEqual([201, 200]);
      expect(b.body.id).toBe(a.body.id);
      const c = await createOrder(api, 'toeic_pro_yearly', {}, key);
      expect(c.status).toBe(409);
      expect(c.body.error.details.reason).toBe('idempotency_key_reused');
      const guest = client(app);
      expect((await guest.call('POST', '/auth/guest', {})).status).toBeLessThan(300);
      const g = await createOrder(guest, 'toeic_pro_monthly');
      expect(g.status).toBe(403);
      expect(g.body.error.details.reason).toBe('guest_account');
    });

    it('giá tính ở server (mã giảm áp dụng), đơn pending hết hạn sau 30 phút; mã không hợp lệ → 400 details.promotion; GET đơn của người khác → 404', async () => {
      const { api } = await newUser();
      const o = await createOrder(api, 'toeic_pro_monthly', { promotion_code: 'WELCOME10', amount: 1 });
      expect(o.status).toBe(201);
      expect(o.body).toMatchObject({ subtotal: 199_000, discount: 19_900, total: 179_100, promotion_code: 'WELCOME10', status: 'pending', payable: true, currency: 'VND' });
      expect(new Date(o.body.expires_at).getTime() - new Date(o.body.created_at).getTime()).toBe(30 * 60_000);
      const bad = await createOrder(api, 'toeic_pro_monthly', { promotion_code: 'EXPIRED2025' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.promotion).toEqual({ code: 'EXPIRED2025', reason: 'expired' });
      const other = await newUser();
      expect((await other.api.call('GET', `/orders/${o.body.id}`)).status).toBe(404);
    });

    it('ff.billing.checkout tắt → POST /orders 503 feature_disabled; bật lại hoạt động', async () => {
      const { api } = await newUser();
      expect((await admin.call('PUT', '/admin/flags/ff.billing.checkout', { enabled: false })).status).toBe(200);
      try {
        const r = await createOrder(api, 'toeic_pro_monthly');
        expect(r.status).toBe(503);
        expect(r.body.error.code).toBe('feature_disabled');
      } finally {
        await admin.call('PUT', '/admin/flags/ff.billing.checkout', { enabled: true });
      }
      expect((await createOrder(api, 'toeic_pro_monthly')).status).toBe(201);
    });
  });

  // ------------------------------------------------------------------ webhook-first
  describe('webhook-first', () => {
    it('mua Pro TOEIC tháng (mock): webhook → paid, quyền mở, credit tháng cộng, ledger 2 dòng grant balance_after đúng, outbox order.paid, audit, thông báo', async () => {
      const { api, id } = await newUser();
      expect((await ents(api)).is_pro).toBe(false);
      const o = await order(api, 'toeic_pro_monthly');
      const ref = await payMock(api, o.id);
      const started = Date.now();
      const r = await mockHook(mockPayload(ref, 199_000));
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, outcome: 'ok' });
      const e = await ents(api);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(e).toMatchObject({ is_pro: true, plan_kind: 'monthly', credits: 5300 });
      expect(e.features).toEqual(expect.arrayContaining(['full_test', 'ai_diagnose', 'grade_writing']));
      const ledger = await ledgerOf(id);
      expect(ledger.map((l) => [l.reason, l.delta, l.balanceAfter])).toEqual([
        ['subscription_grant', 300, 300],
        ['subscription_grant', 5000, 5300],
      ]);
      expect(ledger[1]).toMatchObject({ refType: 'subscription', note: 'period=0' });
      const got = await api.call('GET', `/orders/${o.id}`);
      expect(got.body).toMatchObject({ status: 'paid', payable: false });
      expect(got.body.payments).toHaveLength(1);
      expect(got.body.payments[0]).toMatchObject({ provider: 'mock', status: 'success' });
      const out = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.aggregateId, o.id), eq(opsOutbox.eventType, 'order.paid')));
      expect(out).toHaveLength(1);
      expect(out[0]!.payload).toMatchObject({ order_id: o.id, user_id: id, plan_code: 'toeic_pro_monthly', credits_granted: 5000, provider: 'mock', late: false });
      const audit = await dbs.db.select().from(opsAuditLogs).where(and(eq(opsAuditLogs.entityId, o.id), eq(opsAuditLogs.action, 'order.paid')));
      expect(audit).toHaveLength(1);
      await vi.waitFor(async () => {
        // S8: NotificationService ghi một hàng mỗi kênh – in-app đúng một
        const n = await dbs.db.select().from(opsNotifications).where(and(eq(opsNotifications.userId, id), eq(opsNotifications.templateCode, 'billing.order_paid'), eq(opsNotifications.channel, 'inapp')));
        expect(n).toHaveLength(1);
      });
      const inbox = await api.call('GET', '/me/notifications');
      expect(inbox.body.data[0]).toMatchObject({ template_code: 'billing.order_paid', channel: 'inapp', status: 'sent' });
      const subs = await api.call('GET', '/me/subscriptions');
      expect(subs.body).toHaveLength(1);
      expect(subs.body[0]).toMatchObject({ status: 'active', program: 'toeic', is_current: true, upcoming: false, days_left: 30, cancel_at_period_end: false, source_order_id: o.id });
    });

    it('gửi lại cùng webhook 3 lần → 1 payment, cấp 1 lần (duplicate); return URL chỉ hiển thị (302 về web)', async () => {
      const { api, id } = await newUser();
      const o = await order(api, 'credits_1000');
      const ref = await payMock(api, o.id);
      const p = mockPayload(ref, 49_000);
      const outcomes = [];
      for (let i = 0; i < 3; i++) outcomes.push((await mockHook(p)).json().outcome);
      expect(outcomes).toEqual(['ok', 'duplicate', 'duplicate']);
      const pays = await dbs.db.select().from(billingPayments).where(eq(billingPayments.orderId, o.id));
      expect(pays.filter((x) => x.providerTxnId === p.txn_id)).toHaveLength(1);
      expect((await ledgerOf(id)).filter((l) => l.reason === 'purchase')).toHaveLength(1);
      const ret = await raw('GET', `/payments/return/mock?ref=${ref}`);
      expect(ret.statusCode).toBe(302);
      const loc = new URL(ret.headers.location as string);
      expect(loc.origin + loc.pathname).toBe('http://localhost:3000/checkout/result');
      expect(Object.fromEntries(loc.searchParams)).toMatchObject({ order_id: o.id, status: 'paid', provider: 'mock' });
      const json = await raw('GET', `/payments/return/mock?ref=${ref}`, undefined, { accept: 'application/json' });
      expect(json.json()).toMatchObject({ order_id: o.id, status: 'paid', signature_valid: true });
    });

    it('2 webhook trùng ĐỒNG THỜI (Promise.all) → chỉ cấp 1 lần; 2 giao dịch khác nhau cho cùng đơn → lần 2 already_confirmed, không cấp lại', async () => {
      const { api, id } = await newUser();
      const o = await order(api, 'toeic_pro_monthly');
      const ref = await payMock(api, o.id);
      const p = mockPayload(ref, 199_000);
      const res = await Promise.all([mockHook(p), mockHook(p), mockHook(p)]);
      expect(res.map((r) => r.json().outcome).sort()).toEqual(['duplicate', 'duplicate', 'ok']);
      const grants = (await ledgerOf(id)).filter((l) => l.refType === 'subscription');
      expect(grants).toHaveLength(1);
      const subs = await dbs.db.select().from(billingSubscriptions).where(eq(billingSubscriptions.userId, id));
      expect(subs).toHaveLength(1);
      const [a, b] = await Promise.all([mockHook(mockPayload(ref, 199_000)), mockHook(mockPayload(ref, 199_000))]);
      expect([a.json().outcome, b.json().outcome]).toEqual(['already_confirmed', 'already_confirmed']);
      expect((await ledgerOf(id)).filter((l) => l.refType === 'subscription')).toHaveLength(1);
      const dup = await dbs.db.select().from(opsAuditLogs).where(and(eq(opsAuditLogs.entityId, o.id), eq(opsAuditLogs.action, 'payment.duplicate_order_payment')));
      expect(dup).toHaveLength(2);
    });

    it('sai chữ ký → 400 + audit payment.webhook_rejected, đơn vẫn pending; sai số tiền → amount_mismatch, không cấp quyền', async () => {
      const { api } = await newUser();
      const o = await order(api, 'toeic_pro_monthly');
      const ref = await payMock(api, o.id);
      const before = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(opsAuditLogs).where(eq(opsAuditLogs.action, 'payment.webhook_rejected'));
      const bad = await mockHook(mockPayload(ref, 199_000), 'deadbeef');
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ outcome: 'invalid_signature' });
      const after = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(opsAuditLogs).where(eq(opsAuditLogs.action, 'payment.webhook_rejected'));
      expect(after[0]!.n).toBe(before[0]!.n + 1);
      const mismatch = await mockHook(mockPayload(ref, 1_000));
      expect(mismatch.json().outcome).toBe('amount_mismatch');
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('pending');
      expect((await ents(api)).is_pro).toBe(false);
      const pays = await dbs.db.select().from(billingPayments).where(eq(billingPayments.orderId, o.id));
      expect(pays.find((p) => (p.rawCallback as { reason?: string }).reason === 'amount_mismatch')?.status).toBe('failed');
    });

    it('webhook đến TRƯỚC /pay (không có lần thanh toán initiated) → vẫn paid đúng đơn; webhook failed → đơn failed, /pay lại được', async () => {
      const { api } = await newUser();
      const o = await order(api, 'credits_1000');
      const r = await mockHook(mockPayload(encodeMerchantRef(o.id), 49_000));
      expect(r.json().outcome).toBe('ok');
      const got = await api.call('GET', `/orders/${o.id}`);
      expect(got.body.status).toBe('paid');
      expect(got.body.payments).toHaveLength(1);
      const o2 = await order(api, 'credits_1000');
      const ref2 = await payMock(api, o2.id);
      expect((await mockHook(mockPayload(ref2, 49_000, { status: 'failed' }))).json().outcome).toBe('ok');
      expect((await api.call('GET', `/orders/${o2.id}`)).body).toMatchObject({ status: 'failed', payable: true });
      const ref3 = await payMock(api, o2.id);
      expect(ref3).not.toBe(ref2);
      expect((await api.call('GET', `/orders/${o2.id}`)).body.status).toBe('pending');
    });

    it('trang thanh toán giả (form urlencoded) → webhook ký như cổng → 303 về return URL', async () => {
      const { api } = await newUser();
      const o = await order(api, 'credits_1000');
      const ref = await payMock(api, o.id);
      const page = await raw('GET', `/payments/mock/checkout?ref=${ref}`);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.body).toContain(ref);
      const submit = await raw('POST', '/payments/mock/checkout', `ref=${ref}&outcome=paid`, { 'content-type': 'application/x-www-form-urlencoded' });
      expect(submit.statusCode).toBe(303);
      expect(submit.headers.location).toContain(`/v1/payments/return/mock?ref=${ref}`);
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('paid');
    });
  });

  // ------------------------------------------------------------------ 3 cổng (credential giả, HTTP giả lập)
  describe('VNPay · MoMo · ZaloPay (vector tự tạo, không sandbox thật)', () => {
    it('VNPay: /pay → URL ký đúng; IPN GET ký đúng → RspCode 00, paid; gửi lại → 02; sửa tham số → HTTP 400 RspCode 97; return URL', async () => {
      const { api } = await newUser();
      const o = await order(api, 'toeic_pro_monthly');
      const pay = await api.call('POST', `/orders/${o.id}/pay`, { provider: 'vnpay', return_url: 'http://localhost:3000/vi/checkout/result' });
      expect(pay.body).toMatchObject({ provider: 'vnpay', method: 'redirect' });
      const q = Object.fromEntries(new URL(pay.body.redirect_url).searchParams);
      expect(q.vnp_Amount).toBe('19900000');
      expect(q.vnp_ReturnUrl).toBe('http://localhost:4000/v1/payments/return/vnpay');
      expect(vnpaySign(V.vnpay.hash_secret!, q)).toBe(q.vnp_SecureHash);
      const ipn: Record<string, string> = { vnp_Amount: q.vnp_Amount!, vnp_BankCode: 'NCB', vnp_BankTranNo: 'VNP1', vnp_CardType: 'ATM', vnp_OrderInfo: q.vnp_OrderInfo!, vnp_PayDate: '20261102101800', vnp_ResponseCode: '00', vnp_TmnCode: 'ALLINGO1', vnp_TransactionNo: String(Date.now()).slice(-9), vnp_TransactionStatus: '00', vnp_TxnRef: q.vnp_TxnRef! };
      ipn.vnp_SecureHash = vnpaySign(V.vnpay.hash_secret!, ipn);
      const qs = new URLSearchParams(ipn).toString();
      const r1 = await raw('GET', `/webhooks/payments/vnpay?${qs}`);
      expect([r1.statusCode, r1.json()]).toEqual([200, { RspCode: '00', Message: 'Confirm Success' }]);
      expect((await raw('GET', `/webhooks/payments/vnpay?${qs}`)).json().RspCode).toBe('02');
      const tampered = await raw('GET', `/webhooks/payments/vnpay?${qs.replace('vnp_Amount=19900000', 'vnp_Amount=100')}`);
      expect([tampered.statusCode, tampered.json().RspCode]).toEqual([400, '97']);
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('paid');
      const ret = await raw('GET', `/payments/return/vnpay?${qs}`);
      expect(ret.statusCode).toBe(302);
      expect(ret.headers.location).toContain('http://localhost:3000/vi/checkout/result?order_id=');
      expect(ret.headers.location).toContain('status=paid');
      // return_url ngoài origin web → 400 (chống open redirect)
      const o2 = await order(api, 'credits_1000');
      expect((await api.call('POST', `/orders/${o2.id}/pay`, { provider: 'vnpay', return_url: 'https://evil.example/x' })).status).toBe(400);
    });

    it('MoMo: create ký đúng (HTTP giả lập) → payUrl/deeplink; IPN ký đúng → 204, paid; sai chữ ký → 400', async () => {
      const { api } = await newUser();
      const o = await order(api, 'credits_1000');
      httpQueue.push(() => ({ resultCode: 0, payUrl: 'https://test-payment.momo.vn/v2/gateway/pay?t=abc', deeplink: 'momo://app?t=abc', qrCodeUrl: '000201' }));
      const pay = await api.call('POST', `/orders/${o.id}/pay`, { provider: 'momo' });
      expect(pay.status).toBe(200);
      expect(pay.body).toMatchObject({ provider: 'momo', redirect_url: 'https://test-payment.momo.vn/v2/gateway/pay?t=abc', deeplink: 'momo://app?t=abc', qr_code: '000201' });
      const sent = JSON.parse(httpLog.at(-1)!.body!) as Record<string, unknown>;
      expect(httpLog.at(-1)!.url).toBe('https://test-payment.momo.vn/v2/gateway/api/create');
      expect(sent).toMatchObject({ partnerCode: 'ALLINGOTEST', amount: 49_000, ipnUrl: 'http://localhost:4000/v1/webhooks/payments/momo', requestType: 'captureWallet' });
      const ipn: Record<string, unknown> = { partnerCode: 'ALLINGOTEST', orderId: sent.orderId, requestId: sent.requestId, amount: 49000, orderInfo: sent.orderInfo, orderType: 'momo_wallet', transId: Date.now(), resultCode: 0, message: 'Successful.', payType: 'qr', responseTime: Date.now(), extraData: '' };
      ipn.signature = hmacHex('sha256', V.momo.secret_key!, momoRaw(MOMO_IPN_FIELDS, { ...ipn, accessKey: V.momo.access_key }));
      const bad = await raw('POST', '/webhooks/payments/momo', { ...ipn, amount: 1000 });
      expect(bad.statusCode).toBe(400);
      const ok = await raw('POST', '/webhooks/payments/momo', ipn);
      expect(ok.statusCode).toBe(204);
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('paid');
      // cổng từ chối khi tạo → 502 payment_failed, lần thanh toán đánh dấu failed
      const o2 = await order(api, 'credits_1000');
      httpQueue.push(() => ({ resultCode: 22, message: 'amount out of range' }));
      const fail = await api.call('POST', `/orders/${o2.id}/pay`, { provider: 'momo' });
      expect([fail.status, fail.body.error.code, fail.body.error.details.provider_code]).toEqual([502, 'payment_failed', '22']);
    });

    it('ZaloPay: create mac key1 (HTTP giả lập); callback mac key2 → return_code 1, paid; gửi lại → 2; mac sai → 400 -1', async () => {
      const { api } = await newUser();
      const o = await order(api, 'credits_1000');
      httpQueue.push(() => ({ return_code: 1, return_message: 'ok', order_url: 'https://qcgateway.zalopay.vn/openinapp?order=xyz', qr_code: '000201zp' }));
      const pay = await api.call('POST', `/orders/${o.id}/pay`, { provider: 'zalopay' });
      expect(pay.body).toMatchObject({ provider: 'zalopay', redirect_url: 'https://qcgateway.zalopay.vn/openinapp?order=xyz', qr_code: '000201zp' });
      const form = new URLSearchParams(httpLog.at(-1)!.body);
      const appTransId = form.get('app_trans_id')!;
      expect(appTransId).toMatch(/^\d{6}_[0-9a-z]{31}$/);
      expect(form.get('mac')).toBe(hmacHex('sha256', V.zalopay.key1!, [form.get('app_id'), appTransId, form.get('app_user'), form.get('amount'), form.get('app_time'), form.get('embed_data'), form.get('item')].join('|')));
      const data = JSON.stringify({ app_id: 2554, app_trans_id: appTransId, app_time: Number(form.get('app_time')), app_user: form.get('app_user'), amount: 49000, embed_data: form.get('embed_data'), item: '[]', zp_trans_id: Date.now(), server_time: Date.now(), channel: 38, merchant_user_id: '', user_fee_amount: 0, discount_amount: 0 });
      const cb = { data, mac: hmacHex('sha256', V.zalopay.key2!, data), type: 1 };
      expect((await raw('POST', '/webhooks/payments/zalopay', { ...cb, mac: 'bad' })).statusCode).toBe(400);
      const r1 = await raw('POST', '/webhooks/payments/zalopay', cb);
      expect(r1.json()).toEqual({ return_code: 1, return_message: 'success' });
      expect((await raw('POST', '/webhooks/payments/zalopay', cb)).json().return_code).toBe(2);
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('paid');
    });
  });

  // ------------------------------------------------------------------ jobs
  describe('jobs', () => {
    it('order.expire: pending 31 phút → expired, /pay 409; webhook đến muộn (tiền đã trừ) vẫn cấp quyền, late = true', async () => {
      const { api, id } = await newUser();
      const o = await order(api, 'credits_1000');
      const ref = await payMock(api, o.id);
      const orders = app.get(OrdersService);
      await orders.expireDue(new Date(Date.now() + 29 * 60_000));
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('pending');
      await orders.expireDue(new Date(Date.now() + 31 * 60_000));
      expect((await api.call('GET', `/orders/${o.id}`)).body).toMatchObject({ status: 'expired', payable: false });
      const p = await api.call('POST', `/orders/${o.id}/pay`, { provider: 'mock' });
      expect([p.status, p.body.error.details.reason]).toEqual([409, 'order_not_payable']);
      expect((await mockHook(mockPayload(ref, 49_000))).json().outcome).toBe('ok');
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('paid');
      const [ev] = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.aggregateId, o.id), eq(opsOutbox.eventType, 'order.paid')));
      expect(ev!.payload).toMatchObject({ late: true });
      expect((await ledgerOf(id)).some((l) => l.reason === 'purchase')).toBe(true);
    });

    it('payment.reconcile: đã trả ở cổng nhưng mất webhook → job hỏi queryStatus (pending > 15′) và cấp quyền; chạy lại không cấp thêm', async () => {
      const { api, id } = await newUser();
      const o = await order(api, 'toeic_pro_monthly');
      const ref = await payMock(api, o.id);
      app.get(PaymentProviderRegistry).mock().simulate(ref, 'paid'); // người dùng trả xong, IPN bị mất
      const payments = app.get(PaymentsService);
      expect((await payments.reconcilePending()).paid).toBe(0); // chưa quá 15 phút
      await dbs.db.update(billingPayments).set({ createdAt: new Date(Date.now() - 20 * 60_000) }).where(eq(billingPayments.orderId, o.id));
      const r = await admin.call('POST', '/admin/billing/jobs/payment.reconcile');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ job: 'payment.reconcile', status: 'completed' });
      expect(r.body.result.paid).toBeGreaterThanOrEqual(1);
      expect((await api.call('GET', `/orders/${o.id}`)).body.status).toBe('paid');
      expect((await ents(api)).is_pro).toBe(true);
      await payments.reconcilePending();
      expect((await ledgerOf(id)).filter((l) => l.refType === 'subscription')).toHaveLength(1);
      const [ev] = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.aggregateId, o.id), eq(opsOutbox.eventType, 'order.paid')));
      expect(ev!.payload).toMatchObject({ source: 'reconcile' });
    });

    it('mua lại cùng gói = gia hạn nối tiếp; huỷ giữ quyền tới hết kỳ; subscription.expire hạ Free + thông báo; nhắc 3/1 ngày một lần mỗi mốc', async () => {
      const { api, id } = await newUser();
      await buy(api, 'toeic_pro_monthly');
      await buy(api, 'toeic_pro_monthly');
      const subs = (await api.call('GET', '/me/subscriptions')).body as Array<{ id: string; current_period_start: string; current_period_end: string; upcoming: boolean; is_current: boolean }>;
      expect(subs).toHaveLength(2);
      const [next, cur] = subs; // sắp xếp start giảm dần
      expect(cur!.is_current).toBe(true);
      expect(next!.upcoming).toBe(true);
      expect(next!.current_period_start).toBe(cur!.current_period_end);
      expect((await ledgerOf(id)).filter((l) => l.refType === 'subscription')).toHaveLength(1); // kỳ nối tiếp chưa bắt đầu → chưa cấp credit
      // Huỷ kỳ hiện tại → giữ quyền; kỳ nối tiếp vẫn còn → không nhắc
      const c = await api.call('POST', `/me/subscriptions/${cur!.id}/cancel`);
      expect(c.body).toMatchObject({ cancel_at_period_end: true, status: 'active' });
      expect((await api.call('POST', `/me/subscriptions/${cur!.id}/cancel`)).status).toBe(200);
      expect((await ents(api)).is_pro).toBe(true);
      const svc = app.get(SubscriptionsService);
      // Huỷ cả kỳ nối tiếp + đưa cả hai về sát hạn → nhắc 3 ngày đúng một lần, rồi 1 ngày
      await api.call('POST', `/me/subscriptions/${next!.id}/cancel`);
      const now = Date.now();
      await dbs.db.update(billingSubscriptions).set({ currentPeriodStart: new Date(now - 40 * 86_400_000), currentPeriodEnd: new Date(now - 10 * 86_400_000) }).where(eq(billingSubscriptions.id, cur!.id));
      await dbs.db.update(billingSubscriptions).set({ currentPeriodStart: new Date(now - 10 * 86_400_000), currentPeriodEnd: new Date(now + 2.5 * 86_400_000) }).where(eq(billingSubscriptions.id, next!.id));
      await svc.remindDue();
      await svc.remindDue();
      await svc.remindDue(new Date(now + 2 * 86_400_000));
      await vi.waitFor(async () => {
        const n = await dbs.db.select().from(opsNotifications).where(and(eq(opsNotifications.userId, id), eq(opsNotifications.templateCode, 'billing.subscription_expiring'), eq(opsNotifications.channel, 'inapp')));
        expect(n.map((x) => (x.payload as { days_before: number }).days_before).sort()).toEqual([1, 3]);
      });
      // Hết kỳ: job hạ Free (status cancelled vì đã huỷ) + thông báo hết hạn
      await dbs.db.update(billingSubscriptions).set({ currentPeriodEnd: new Date(now - 1000) }).where(eq(billingSubscriptions.id, next!.id));
      await dbs.db.update(schema.billingEntitlements).set({ validTo: new Date(now - 1000) }).where(inArray(schema.billingEntitlements.sourceId, [cur!.id, next!.id]));
      const r = await svc.expireDue();
      expect(r.expired).toBeGreaterThanOrEqual(2);
      const after = (await api.call('GET', '/me/subscriptions')).body as Array<{ status: string }>;
      expect(after.map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
      expect((await ents(api)).is_pro).toBe(false);
      await vi.waitFor(async () => {
        const n = await dbs.db.select().from(opsNotifications).where(and(eq(opsNotifications.userId, id), eq(opsNotifications.templateCode, 'billing.subscription_expired')));
        expect(n.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('credit.grant_monthly: Pro năm cấp kỳ đến hạn, idempotent theo (subscription, kỳ), tối đa 12 kỳ; huỷ → ngừng cấp; lifetime cấp once', async () => {
      const { api, id } = await newUser();
      await buy(api, 'toeic_pro_yearly');
      const svc = app.get(SubscriptionsService);
      const grants = async () => (await ledgerOf(id)).filter((l) => l.refType === 'subscription');
      expect(await grants()).toHaveLength(1);
      await svc.grantMonthlyDue(new Date(Date.now() + 31 * 86_400_000));
      await svc.grantMonthlyDue(new Date(Date.now() + 31 * 86_400_000));
      expect((await grants()).map((g) => g.note)).toEqual(['period=0', 'period=1']);
      await svc.grantMonthlyDue(new Date(Date.now() + 400 * 86_400_000));
      expect(await grants()).toHaveLength(12);
      expect((await ents(api)).plan_kind).toBe('yearly');
      const u2 = await newUser();
      await buy(u2.api, 'toeic_pro_yearly');
      const [sub] = (await u2.api.call('GET', '/me/subscriptions')).body as Array<{ id: string }>;
      await u2.api.call('POST', `/me/subscriptions/${sub!.id}/cancel`);
      await svc.grantMonthlyDue(new Date(Date.now() + 61 * 86_400_000));
      expect((await ledgerOf(u2.id)).filter((l) => l.refType === 'subscription')).toHaveLength(1);
      const u3 = await newUser();
      await buy(u3.api, 'toeic_pro_lifetime');
      expect(await ents(u3.api)).toMatchObject({ is_pro: true, plan_kind: 'lifetime', credits: 70_300 });
      expect((await u3.api.call('GET', '/me/subscriptions')).body[0]).toMatchObject({ status: 'lifetime', current_period_end: null });
      const lt = (await u3.api.call('GET', '/me/subscriptions')).body[0];
      expect((await u3.api.call('POST', `/me/subscriptions/${lt.id}/cancel`)).status).toBe(409);
    });

    it('credit.expire: gói credit 12 tháng, đã tiêu 200 → hết hạn 800 (FIFO theo hạn), chạy lại không ghi thêm; ledger cursor', async () => {
      const { api, id } = await newUser();
      const o = await buy(api, 'credits_1000');
      const credits = app.get(CreditService);
      await dbs.db.transaction((tx) => credits.charge(tx, id, 200, { refType: 'test', note: 'consume' }));
      expect(await credits.balance(id)).toBe(1100);
      const [lot] = (await ledgerOf(id)).filter((l) => l.reason === 'purchase');
      expect(lot!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);
      const later = new Date(lot!.expiresAt!.getTime() + 86_400_000);
      expect((await credits.expireDue(later)).expired).toBeGreaterThanOrEqual(800);
      await credits.expireDue(later);
      const expired = (await ledgerOf(id)).filter((l) => l.reason === 'expire');
      expect(expired.map((e) => [e.delta, e.refId])).toEqual([[-800, o.id]]);
      expect(await credits.balance(id)).toBe(300);
      const p1 = await api.call('GET', '/me/credits/ledger?limit=2');
      expect(p1.body.data.map((x: { reason: string }) => x.reason)).toEqual(['expire', 'consume']);
      const p2 = await api.call('GET', `/me/credits/ledger?limit=2&cursor=${p1.body.next_cursor}`);
      expect(p2.body.data.map((x: { reason: string }) => x.reason)).toEqual(['purchase', 'subscription_grant']);
      expect(p2.body.next_cursor).toBeNull();
    });
  });

  // ------------------------------------------------------------------ admin
  describe('admin: hoàn tiền & đối soát', () => {
    it('hoàn tiền thủ công: refunded, thu hồi entitlement + credit (ledger refund âm), audit; lần 2 → 409; learner → 403', async () => {
      const { api, id } = await newUser();
      const o = await buy(api, 'toeic_pro_monthly');
      expect((await api.call('POST', `/admin/orders/${o.id}/refund`, { reason: 'test' })).status).toBe(403);
      const r = await admin.call('POST', `/admin/orders/${o.id}/refund`, { reason: 'khách yêu cầu' });
      expect(r.status).toBe(200);
      expect(r.body.order.status).toBe('refunded');
      expect(r.body.revoked).toMatchObject({ subscriptions: 1, credits_revoked: 5000, credits_shortfall: 0 });
      expect(r.body.provider_refund.mode).toBe('manual');
      expect(await ents(api)).toMatchObject({ is_pro: false, credits: 300 });
      expect((await ledgerOf(id)).at(-1)).toMatchObject({ reason: 'refund', delta: -5000, balanceAfter: 300 });
      expect((await admin.call('POST', `/admin/orders/${o.id}/refund`, { reason: 'again' })).status).toBe(409);
      expect(await dbs.db.select().from(opsAuditLogs).where(and(eq(opsAuditLogs.entityId, o.id), eq(opsAuditLogs.action, 'order.refund')))).toHaveLength(1);
      const pay = await dbs.db.select().from(billingPayments).where(eq(billingPayments.orderId, o.id));
      expect(pay[0]!.status).toBe('refunded');
      // Gói credit đã tiêu một phần: thu hồi phần còn lại, không làm số dư âm
      const u2 = await newUser();
      const o2 = await buy(u2.api, 'credits_1000');
      // tiêu 400: FIFO theo hạn → tiêu từ gói (có hạn) trước → gói còn 600
      await dbs.db.transaction((tx) => app.get(CreditService).charge(tx, u2.id, 400, { refType: 'test' }));
      const r2 = await admin.call('POST', `/admin/orders/${o2.id}/refund`, { reason: 'partial' });
      expect(r2.body.revoked).toMatchObject({ credits_revoked: 600, credits_shortfall: 400 });
      expect(await app.get(CreditService).balance(u2.id)).toBe(300);
    });

    it('đối soát: 20 giao dịch khớp sao kê CSV → matched; thêm 1 lệch số tiền → mismatched đúng 1 dòng; CSV báo cáo; queryStatus; GET danh sách/đơn/summary', async () => {
      const { api } = await newUser();
      const ordersMade: Array<{ id: string; txn: string; ref: string }> = [];
      for (let i = 0; i < 20; i++) {
        const o = await order(api, 'credits_1000');
        const ref = await payMock(api, o.id);
        const sim = app.get(PaymentProviderRegistry).mock().simulate(ref, 'paid');
        const r = await mockHook(sim.payload, sim.signature);
        expect(r.json().outcome).toBe('ok');
        ordersMade.push({ id: o.id, txn: sim.payload.txn_id, ref });
      }
      // ngày riêng cho lần chạy này (tránh lẫn giao dịch mock của test khác trong DB test dùng lại)
      const d = new Date(Date.UTC(2000, 0, 1) + Math.floor(Math.random() * 8000) * 86_400_000).toISOString().slice(0, 10);
      await dbs.db.update(billingPayments).set({ confirmedAt: new Date(`${d}T10:00:00+07:00`) }).where(inArray(billingPayments.orderId, ordersMade.map((o) => o.id)));
      const csv = (rows: typeof ordersMade, tweak?: (i: number) => number) => ['provider_txn_id,merchant_ref,amount,currency,status,paid_at', ...rows.map((o, i) => `${o.txn},${o.ref},${tweak ? tweak(i) : 49000},VND,success,${d}T10:00:00+07:00`)].join('\n');
      const ok = await admin.call('POST', '/admin/billing/reconciliations', { provider: 'mock', for_date: d, source: 'csv', csv: csv(ordersMade) });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ status: 'matched', mismatch_count: 0, expected_total: 980_000, actual_total: 980_000, system_count: 20, statement_count: 20, matched_count: 20, source: 'csv' });
      const bad = await admin.call('POST', '/admin/billing/reconciliations', { provider: 'mock', for_date: d, source: 'csv', csv: csv(ordersMade, (i) => (i === 7 ? 48_000 : 49_000)) });
      expect(bad.body).toMatchObject({ status: 'mismatched', mismatch_count: 1, id: ok.body.id });
      expect(bad.body.mismatches[0]).toMatchObject({ type: 'amount_mismatch', provider_txn_id: ordersMade[7]!.txn, system_amount: 49_000, statement_amount: 48_000, order_id: ordersMade[7]!.id });
      const report = await admin.call('GET', `/admin/billing/reconciliations/${bad.body.id}?format=csv`);
      expect(report.headers['content-type']).toContain('text/csv');
      expect(report.raw.split('\n')[1]).toContain(`amount_mismatch,${ordersMade[7]!.txn}`);
      const detail = await admin.call('GET', `/admin/billing/reconciliations/${bad.body.id}`);
      expect(detail.body).toMatchObject({ source: 'csv', matched_count: 19 });
      const q = await app.get(ReconciliationService).run({ provider: 'mock', for_date: d, source: 'query' }, null);
      expect(q).toMatchObject({ status: 'matched', matched_count: 20 });
      const list = await admin.call('GET', '/admin/billing/reconciliations?provider=mock&limit=5');
      expect(list.body.some((r: { id: string }) => r.id === ok.body.id)).toBe(true);
      const orders = await admin.call('GET', `/admin/billing/orders?status=paid&provider=mock&limit=3`);
      expect(orders.body.data).toHaveLength(3);
      expect(orders.body.data[0].payments[0]).toHaveProperty('provider_txn_id');
      expect(orders.body.next_cursor).not.toBeNull();
      const summary = await admin.call('GET', `/admin/billing/summary?from=${d}&to=${d}`);
      expect(summary.body.by_day).toEqual([{ day: d, provider: 'mock', paid: 20, revenue: 980_000 }]);
      expect((await api.call('GET', '/admin/billing/summary')).status).toBe(403);
      const mine = await api.call('GET', '/me/orders?limit=5');
      expect(mine.body.data).toHaveLength(5);
      expect(mine.body.next_cursor).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------ gating toàn hệ thống
  describe('gating plan × feature', () => {
    it('Free: đề full lần 3 trong tháng → 429 quota_exceeded đúng envelope; chẩn đoán AI → 403 upgrade', async () => {
      const { api, id } = await newUser();
      expect((await startFull(api)).status).toBe(201);
      expect((await startFull(api)).status).toBe(201);
      const third = await startFull(api);
      expect(third.status).toBe(429);
      expect(third.body.error).toMatchObject({ code: 'quota_exceeded', details: { feature: 'full_test', upgrade: true, quota: { feature: 'full_test', period: 'month', limit: 2, used: 2, remaining: 0 } } });
      expect(third.body.error.trace_id).toBeTruthy();
      await expect(app.get(FeatureGateService).check(id, 'toeic', 'ai_diagnose')).rejects.toMatchObject({ code: 'forbidden', details: { feature: 'ai_diagnose', gate: 'ai_diagnose', upgrade: true } });
    });

    it('Pro tháng: đề full không giới hạn (5 lần); hoàn tiền (hết quyền) → về Free, lần sau bị giới hạn', async () => {
      const { api } = await newUser();
      const o = await buy(api, 'toeic_pro_monthly');
      for (let i = 0; i < 5; i++) expect((await startFull(api)).status).toBe(201);
      await admin.call('POST', `/admin/orders/${o.id}/refund`, { reason: 'downgrade test' });
      expect((await ents(api)).plan_kind).toBe('free');
      // Free: quota tháng full_test đã dùng (5 lượt tính trên gói Pro không tính vào Free) → còn 2
      expect((await startFull(api)).status).toBe(201);
      expect((await startFull(api)).status).toBe(201);
      expect((await startFull(api)).status).toBe(429);
    });

    it('ma trận (FeatureGateService, DB thật): Free / Pro tháng / Pro năm / trọn đời / hết hạn × ai_diagnose, grade_writing, full_test, notes', async () => {
      const gate = app.get(FeatureGateService);
      const free = await newUser();
      const monthly = await newUser();
      await buy(monthly.api, 'toeic_pro_monthly');
      const yearly = await newUser();
      await buy(yearly.api, 'toeic_pro_yearly');
      const lifetime = await newUser();
      await buy(lifetime.api, 'toeic_pro_lifetime');
      const expired = await newUser();
      await buy(expired.api, 'toeic_pro_monthly');
      const now = Date.now();
      await dbs.db.update(billingSubscriptions).set({ currentPeriodStart: new Date(now - 31 * 86_400_000), currentPeriodEnd: new Date(now - 60_000) }).where(eq(billingSubscriptions.userId, expired.id));
      await dbs.db.update(schema.billingEntitlements).set({ validFrom: new Date(now - 31 * 86_400_000), validTo: new Date(now - 60_000) }).where(eq(schema.billingEntitlements.userId, expired.id));
      await app.get(SubscriptionsService).expireDue();
      const matrix: Record<string, Record<string, string>> = {};
      for (const [label, u] of Object.entries({ free, monthly, yearly, lifetime, expired })) {
        const ctx = await gate.context(u.id, 'toeic');
        matrix[label] = { plan: ctx.planKind };
        for (const g of ['ai_diagnose', 'grade_writing', 'full_test', 'notes'] as const) matrix[label][g] = gate.locked(ctx, g) ? 'locked' : 'open';
      }
      expect(matrix).toEqual({
        free: { plan: 'free', ai_diagnose: 'locked', grade_writing: 'locked', full_test: 'open', notes: 'open' },
        monthly: { plan: 'monthly', ai_diagnose: 'open', grade_writing: 'open', full_test: 'open', notes: 'open' },
        yearly: { plan: 'yearly', ai_diagnose: 'open', grade_writing: 'open', full_test: 'open', notes: 'open' },
        lifetime: { plan: 'lifetime', ai_diagnose: 'open', grade_writing: 'open', full_test: 'open', notes: 'open' },
        expired: { plan: 'free', ai_diagnose: 'locked', grade_writing: 'locked', full_test: 'open', notes: 'open' },
      });
      // quota explain theo gói: Free 10/ngày, Pro 300/ngày
      const t = await gate.consume(yearly.id, 'toeic', 'ai_explain');
      expect(t.quota).toMatchObject({ limit: 300 });
      await t.release();
      const tf = await gate.consume(free.id, 'toeic', 'ai_explain');
      expect(tf.quota).toMatchObject({ limit: 10, used: 1 });
      await tf.release();
      await tf.release(); // hoàn 2 lần vẫn chỉ 1
      expect((await gate.consume(free.id, 'toeic', 'ai_explain')).quota).toMatchObject({ used: 1 });
    });
  });

  it('bộ lập lịch billing: tick chạy mọi job đến hạn một lần (khoá Redis theo nhịp), trong chu kỳ không chạy lại; reconcile sau 01:30 VN', async () => {
    const jobs = app.get(BillingJobsService);
    const spy = vi.spyOn(jobs, 'run').mockResolvedValue({});
    try {
      // thời điểm ngẫu nhiên (năm 2031+) để khoá Redis của lần chạy test trước không ảnh hưởng
      const base = Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000;
      const at = new Date(base + 19 * 3600_000); // 02:00 giờ VN
      const ran = await jobs.tick(at);
      // S8: + credit.grant_free_monthly (1 giờ), invoice.retry (1 phút)
      expect(ran.sort()).toEqual(['billing.reconcile', 'credit.expire', 'credit.grant_free_monthly', 'credit.grant_monthly', 'invoice.retry', 'order.expire', 'payment.reconcile', 'subscription.expire']);
      expect(await jobs.tick(new Date(at.getTime() + 10_000))).toEqual([]);
      expect((await jobs.tick(new Date(at.getTime() + 61_000))).sort()).toEqual(['invoice.retry', 'order.expire']);
      // ngày hôm sau 01:00 VN: chưa tới giờ đối soát
      const nextDay = new Date(base + 86_400_000 + 18 * 3600_000);
      expect(await jobs.tick(nextDay)).not.toContain('billing.reconcile');
    } finally {
      spy.mockRestore();
    }
  });
});
