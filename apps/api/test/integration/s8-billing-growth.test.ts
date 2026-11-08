import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { MailerService } from '../../src/shared/notify/mailer.service.js';
import { CreditService, FreeCreditsService, InvoiceProviderRegistry, InvoicesService, SubscriptionsService, freeMonthlyRefId, isStructurallyValidPdf, signMockWebhook, type MockWebhookPayload } from '../../src/modules/billing/index.js';
import { NotificationService, PUSH_SENDER, ReferralService, type MemoryPushSender } from '../../src/modules/growth/index.js';
import { vnMonth } from '../../src/modules/billing/payments/crypto.js';
import { bootTestApp, client } from './setup.js';

/**
 * Sprint 8 – hoá đơn điện tử (mock provider, retry/dead-letter, huỷ khi hoàn tiền, đối chiếu tháng), khuyến mãi đầy đủ + trial,
 * referral qua outbox (joined → started → upgraded, thưởng hai chiều, chống lạm dụng, trần tháng), NotificationService đa kênh
 * (tuỳ chọn theo loại, giờ yên lặng, tần suất, in-app đọc/đọc tất cả, huỷ đăng ký ký HMAC), billing admin, Free credit tháng.
 */
const MOCK_SECRET = 'test-mock-secret-s8';
const PASSWORD = 'Allingo@2026';
const uniq = () => Math.random().toString(36).slice(2, 10);
const { billingCreditLedger, billingInvoices, billingSubscriptions, billingPromotionRedemptions, iamReferrals, opsAuditLogs, opsNotifications, opsOutbox } = schema;
type Api = ReturnType<typeof client>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- body kiểm tra động trong test (như setup.ts)
type Bearer = { token: string; id: string; email: string; call: (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any; headers: Record<string, unknown> }> };

describe('S8 hoá đơn · khuyến mãi · referral · thông báo (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let admin: Api;
  let adminId = '';
  let mailer: MailerService;
  const prices: Record<string, string> = {};
  let part5SetId = '';

  const inject = (opts: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; body?: unknown; headers?: Record<string, string>; ip?: string }) =>
    app.getHttpAdapter().getInstance().inject({ method: opts.method, url: opts.url, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body), headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) }, remoteAddress: opts.ip ?? '127.0.0.1' });

  /** Đăng ký qua HTTP với IP/fingerprint riêng (chống lạm dụng referral dựa trên chúng) → client Bearer */
  const register = async (o: { ip?: string; fp?: string; ref?: string; marketing?: boolean } = {}): Promise<Bearer> => {
    const email = `s8-${uniq()}@example.com`;
    const res = await inject({ method: 'POST', url: '/v1/auth/register', ip: o.ip ?? `10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`, headers: o.fp ? { 'x-device-fingerprint': o.fp } : {}, body: { email, password: 'Hoc-vien#S12-xK9q', display_name: 'Học viên S8', accept_terms: true, referral_code: o.ref, marketing_opt_in: o.marketing } });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ access_token: string; user: { id: string } }>();
    const call: Bearer['call'] = async (method, url, b, headers = {}) => {
      const r = await inject({ method, url: `/v1${url}`, body: b, headers: { authorization: `Bearer ${body.access_token}`, ...headers } });
      let json: unknown = null;
      try {
        json = r.json();
      } catch {
        json = r.body;
      }
      return { status: r.statusCode, body: json, headers: r.headers };
    };
    return { token: body.access_token, id: body.user.id, email, call };
  };
  /** Đánh dấu email đã xác minh (định danh OTP email) – điều kiện thưởng referral */
  const verify = (u: Bearer) => dbs.db.insert(schema.iamAuthIdentities).values({ userId: u.id, provider: 'email', providerUid: u.email, email: u.email }).onConflictDoNothing();
  const order = async (u: Bearer, plan: string, extra: Record<string, unknown> = {}) => u.call('POST', '/orders', { price_id: prices[plan], ...extra }, { 'idempotency-key': crypto.randomUUID() });
  const pay = async (u: Bearer, o: { id: string; total: number }) => {
    const p = await u.call('POST', `/orders/${o.id}/pay`, { provider: 'mock' });
    expect(p.status).toBe(200);
    const ref = new URL(p.body.redirect_url as string).searchParams.get('ref')!;
    const payload: MockWebhookPayload = { ref, txn_id: `T${uniq()}${uniq()}`.toUpperCase(), amount: o.total, currency: 'VND', status: 'paid' };
    const r = await inject({ method: 'POST', url: '/v1/webhooks/payments/mock', body: payload, headers: { 'x-mock-signature': signMockWebhook(MOCK_SECRET, payload) } });
    expect(r.json()).toMatchObject({ outcome: 'ok' });
  };
  const buy = async (u: Bearer, plan: string, extra: Record<string, unknown> = {}) => {
    const r = await order(u, plan, extra);
    expect(r.status).toBe(201);
    await pay(u, r.body);
    return r.body as { id: string; total: number; discount: number };
  };
  const invoiceOf = async (orderId: string) => (await dbs.db.select().from(billingInvoices).where(eq(billingInvoices.orderId, orderId)).limit(1))[0];
  const waitInvoice = (u: Bearer, orderId: string, status: string) =>
    vi.waitFor(
      async () => {
        const o = await u.call('GET', `/orders/${orderId}`);
        expect(o.body.invoice?.status).toBe(status);
        return o.body;
      },
      { timeout: 15_000, interval: 100 },
    );
  const doAttempt = async (u: Bearer) => {
    const a = await u.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: part5SetId }, { 'idempotency-key': crypto.randomUUID() });
    expect(a.status).toBe(201);
    const answers = a.body.questions.map((q: { question_id: string }) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 9000 }));
    expect((await u.call('PUT', `/attempts/${a.body.id}/answers`, { answers })).status).toBe(204);
    expect((await u.call('POST', `/attempts/${a.body.id}/submit`)).status).toBe(200);
  };
  const ledger = (userId: string) => dbs.db.select().from(billingCreditLedger).where(eq(billingCreditLedger.userId, userId)).orderBy(billingCreditLedger.id);
  const inapp = (userId: string, template: string) => dbs.db.select().from(opsNotifications).where(and(eq(opsNotifications.userId, userId), eq(opsNotifications.templateCode, template), eq(opsNotifications.channel, 'inapp')));
  /** Thời điểm theo giờ VN của HÔM NAY (giờ VN) */
  const vnToday = (hhmm: string, addDays = 0) => {
    const d = new Date(Date.now() + 7 * 3600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
    return new Date(`${d}T${hhmm}:00+07:00`);
  };

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    process.env.PAYMENT_PROVIDERS = 'mock';
    process.env.PAYMENT_MOCK_SECRET = MOCK_SECRET;
    process.env.PUSH_SENDER = 'memory';
    process.env.EINVOICE_PROVIDER = 'mock';
    app = await bootTestApp();
    dbs = app.get(DbService);
    mailer = app.get(MailerService);
    admin = client(app);
    const login = await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD });
    expect(login.status).toBe(200);
    adminId = login.body.user.id;
    expect((await admin.call('PUT', '/admin/flags/ff.billing.checkout', { enabled: true, rules: {} })).status).toBe(200);
    expect((await admin.call('PUT', '/admin/flags/ff.growth.referral', { enabled: true, rules: { config: { rewards: { started: { referrer: 200, referee: 200 }, upgraded: { referrer: 500, referee: 500 } }, monthly_cap: 20, abuse_window_hours: 24, require_verified_email: true } } })).status).toBe(200);
    for (const p of (await admin.call('GET', '/plans?program=toeic')).body as Array<{ code: string; price: { id: string } | null }>) if (p.price) prices[p.code] = p.price.id;
    const sets = await dbs.db.select({ id: schema.catalogTestSets.id }).from(schema.catalogTestSets).where(eq(schema.catalogTestSets.code, 'toeic-mini-part5-01'));
    part5SetId = sets[0]!.id;
  });

  afterAll(async () => {
    for (const k of ['PAYMENT_PROVIDERS', 'PAYMENT_MOCK_SECRET', 'PUSH_SENDER', 'EINVOICE_PROVIDER']) delete process.env[k];
    app.get(InvoiceProviderRegistry).mock().failAlways(false);
    await app?.close();
  });

  // ------------------------------------------------------------------ hoá đơn điện tử
  describe('hoá đơn điện tử', () => {
    let paidOrderId = '';

    it('mua gói (doanh nghiệp, MST hợp lệ) → < 60 s có hoá đơn số/ký hiệu/mã tra cứu, PDF tải được từ GET /orders/{id}, email kèm PDF; MST sai → 400', async () => {
      const u = await register();
      const bad = await order(u, 'toeic_pro_monthly', { buyer_info: { type: 'business', tax_code: '0100109107', company: 'Cty Sai', address: 'HN' } });
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body.error.details)).toContain('buyer_info.tax_code');
      const buyerEmail = `ketoan-${uniq()}@cty.example`;
      const started = Date.now();
      const o = await buy(u, 'toeic_pro_monthly', { buyer_info: { tax_code: '0100000003', company: 'Công ty TNHH Học Thử', address: '1 Tràng Tiền, Hà Nội', email: buyerEmail } });
      paidOrderId = o.id;
      const body = await waitInvoice(u, o.id, 'issued');
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(body.invoice).toMatchObject({ provider: 'mock', series: '1C26MAL', buyer_type: 'business', cancelled_at: null });
      expect(body.invoice.invoice_no).toMatch(/^\d{8}$/);
      expect(body.invoice.lookup_code).toMatch(/^[0-9A-F]{12}$/);
      expect(body.buyer_info).toMatchObject({ type: 'business', tax_code: '0100000003' });
      const pdfUrl = new URL(body.invoice.pdf_url as string);
      const pdf = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: `${pdfUrl.pathname}${pdfUrl.search}` });
      expect(pdf.statusCode).toBe(200);
      expect(isStructurallyValidPdf(pdf.rawPayload)).toBe(true);
      expect(pdf.rawPayload.toString('latin1')).toContain('MST: 0100000003');
      // URL ký bị sửa → không tải được
      expect((await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: `${pdfUrl.pathname}${pdfUrl.search.replace(/sig=[^&]+/, 'sig=x')}` })).statusCode).toBeGreaterThanOrEqual(400);
      await vi.waitFor(() => {
        const mail = mailer.allTo(buyerEmail).find((m) => m.subject.includes(body.invoice.invoice_no));
        expect(mail?.attachments?.[0]).toMatchObject({ contentType: 'application/pdf' });
        expect(mail!.text).toContain(body.invoice.lookup_code);
        expect(mail!.headers?.['List-Unsubscribe']).toBeUndefined(); // email giao dịch
      });
      const out = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.eventType, 'invoice.issued'), sql`${opsOutbox.payload}->>'order_id' = ${o.id}`));
      expect(out).toHaveLength(1);
      expect(JSON.stringify(out[0]!.payload)).not.toContain(buyerEmail);
      await vi.waitFor(async () => expect(await inapp(u.id, 'billing.invoice_issued')).toHaveLength(1));
      // Biên lai thanh toán (in-app + email tài khoản)
      await vi.waitFor(async () => expect(await inapp(u.id, 'billing.order_paid')).toHaveLength(1));
      expect(mailer.allTo(u.email).some((m) => m.subject.startsWith('Thanh toán thành công'))).toBe(true);
    });

    it('nhà cung cấp lỗi → error + backoff (job invoice.retry) → hết 6 lần → failed + dead-letter + thông báo admin; admin thử lại → issued, dead-letter resolved', async () => {
      const mock = app.get(InvoiceProviderRegistry).mock();
      const svc = app.get(InvoicesService);
      mock.failAlways(true);
      const u = await register();
      const o = await buy(u, 'credits_1000');
      await vi.waitFor(async () => expect((await invoiceOf(o.id))?.status).toBe('error'), { timeout: 10_000 });
      const first = await invoiceOf(o.id);
      const raw1 = first!.raw as { attempts: number; next_retry_at: string; last_error_code: string };
      expect(raw1).toMatchObject({ attempts: 1, last_error_code: 'mock_unavailable' });
      expect(new Date(raw1.next_retry_at).getTime() - Date.now()).toBeGreaterThan(30_000); // backoff 1 phút
      // invoice.retry trước hạn: không chạy; sau hạn: chạy lần 2
      await svc.retryDue(new Date());
      expect(((await invoiceOf(o.id))!.raw as { attempts: number }).attempts).toBe(1);
      await svc.retryDue(new Date(Date.now() + 2 * 60_000));
      await vi.waitFor(async () => expect(((await invoiceOf(o.id))!.raw as { attempts: number }).attempts).toBe(2), { timeout: 10_000 });
      for (let i = 3; i <= 6; i++) await svc.issue(o.id);
      const failed = await invoiceOf(o.id);
      expect(failed).toMatchObject({ status: 'failed' });
      expect((failed!.raw as { attempts: number }).attempts).toBe(6);
      const dl = await admin.call('GET', '/admin/billing/dead-letters?job=invoice.issue');
      const entry = (dl.body.data as Array<{ id: string; business_id: string; attempts: number; resolved_at: string | null }>).find((d) => d.business_id === o.id)!;
      expect(entry).toMatchObject({ attempts: 6, resolved_at: null });
      await vi.waitFor(async () => expect(await inapp(adminId, 'admin.invoice_failed').then((r) => r.filter((n) => (n.payload as { order_id?: string }).order_id === o.id))).toHaveLength(1));
      expect((await admin.call('GET', `/admin/billing/invoices?order_id=${o.id}`)).body.data[0]).toMatchObject({ status: 'failed', attempts: 6, last_error: 'mock_unavailable' });
      mock.failAlways(false);
      const retry = await admin.call('POST', `/admin/billing/dead-letters/${entry.id}/retry`);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ mode: 'inline', outcome: { status: 'issued' } });
      expect(retry.body.dead_letter.retried_by).toBe(adminId);
      expect((await admin.call('POST', `/admin/billing/dead-letters/${entry.id}/retry`)).status).toBe(409);
      expect(((await admin.call('GET', '/admin/billing/dead-letters?job=invoice.issue')).body.data as Array<{ business_id: string }>).some((d) => d.business_id === o.id)).toBe(false);
      const audit = await dbs.db.select().from(opsAuditLogs).where(and(eq(opsAuditLogs.entityId, o.id), eq(opsAuditLogs.action, 'invoice.dead_letter_retry')));
      expect(audit[0]!.actorUserId).toBe(adminId);
      // learner không xem được dead-letter
      expect((await u.call('GET', '/admin/billing/dead-letters')).status).toBe(403);
    });

    it('hoàn tiền → hoá đơn huỷ (cancel_pending → cancelled); đối chiếu tháng: hoá đơn hiệu lực = paid − refunded', async () => {
      const u = await register();
      const o = await buy(u, 'toeic_pro_monthly');
      await waitInvoice(u, o.id, 'issued');
      expect((await admin.call('POST', `/admin/orders/${o.id}/refund`, { reason: 'Khách yêu cầu hoàn tiền' })).status).toBe(200);
      const body = await waitInvoice(u, o.id, 'cancelled');
      expect(body.invoice.cancelled_at).not.toBeNull();
      const out = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.eventType, 'invoice.cancelled'), sql`${opsOutbox.payload}->>'order_id' = ${o.id}`));
      expect(out).toHaveLength(1);
      const month = vnMonth(new Date());
      const rec = await admin.call('GET', `/admin/billing/invoices/reconciliation?month=${month}`);
      expect(rec.status).toBe(200);
      expect(rec.body.expected_invoices).toBe(rec.body.orders_paid - rec.body.orders_refunded);
      expect(rec.body.orders_refunded).toBeGreaterThanOrEqual(1);
      expect((rec.body.missing as Array<{ order_id: string }>).some((m) => m.order_id === paidOrderId || m.order_id === o.id)).toBe(false);
      expect((rec.body.unexpected as Array<{ order_id: string }>).some((m) => m.order_id === o.id)).toBe(false);
      expect((await admin.call('GET', '/admin/billing/invoices/reconciliation?month=2026-13')).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------ khuyến mãi
  describe('khuyến mãi & dùng thử', () => {
    it('WELCOME20: user mới −20 %, đơn thứ hai cùng mã thay thế đơn cũ (nhả lượt), thanh toán → redeemed + outbox promotion.redeemed; dùng lần 2 bị từ chối; tài khoản cũ → new_users_only', async () => {
      const u = await register();
      const v = await u.call('POST', '/promotions/validate', { code: 'welcome20', price_id: prices.toeic_pro_monthly });
      expect(v.body).toMatchObject({ valid: true, code: 'WELCOME20', kind: 'percent', discount: 39_800, total: 159_200, applies_to: 'order', stackable: false });
      const o1 = await order(u, 'toeic_pro_monthly', { promotion_code: 'WELCOME20' });
      expect(o1.body).toMatchObject({ discount: 39_800, total: 159_200, promotion: { code: 'WELCOME20', kind: 'percent', value: 20 } });
      const o2 = await order(u, 'toeic_pro_yearly', { promotion_code: 'WELCOME20' });
      expect(o2.status).toBe(201);
      expect((await u.call('GET', `/orders/${o1.body.id}`)).body.status).toBe('expired');
      const reds = await dbs.db.select().from(billingPromotionRedemptions).where(eq(billingPromotionRedemptions.userId, u.id)).orderBy(billingPromotionRedemptions.createdAt);
      expect(reds.map((r) => r.status)).toEqual(['released', 'reserved']);
      await pay(u, o2.body);
      const [red] = await dbs.db.select().from(billingPromotionRedemptions).where(eq(billingPromotionRedemptions.orderId, o2.body.id));
      expect(red).toMatchObject({ status: 'redeemed', kind: 'percent' });
      const ev = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.eventType, 'promotion.redeemed'), sql`${opsOutbox.payload}->>'order_id' = ${o2.body.id}`));
      expect(ev[0]!.payload).toMatchObject({ code: 'WELCOME20', user_id: u.id, discount: 298_000 });
      const again = await order(u, 'toeic_pro_monthly', { promotion_code: 'WELCOME20' });
      expect(again.status).toBe(400);
      expect(again.body.error.details.promotion).toMatchObject({ code: 'WELCOME20', reason: 'new_users_only' });
      const old = await register();
      await dbs.db.update(schema.iamUsers).set({ createdAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(schema.iamUsers.id, old.id));
      expect((await old.call('POST', '/promotions/validate', { code: 'WELCOME20', price_id: prices.toeic_pro_monthly })).body).toMatchObject({ valid: false, reason: 'new_users_only' });
    });

    it('dùng thử Pro 7 ngày: trialing + quyền Pro, không credit; một lần/người; sắp hết → billing.trial_ending; hết → expired, hạ Free + billing.trial_ended', async () => {
      const u = await register();
      expect((await u.call('POST', '/promotions/validate', { code: 'PRO7DAY', program: 'toeic' })).body).toMatchObject({ valid: true, kind: 'trial_days', trial_days: 7, applies_to: 'redeem' });
      expect((await order(u, 'toeic_pro_monthly', { promotion_code: 'PRO7DAY' })).body.error.details.promotion.reason).toBe('requires_redeem');
      const r = await u.call('POST', '/promotions/redeem', { code: 'PRO7DAY', program: 'toeic' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ kind: 'trial_days', credits_granted: 0, balance: 300, subscription: { status: 'trialing', program: 'toeic', is_current: true } });
      expect(new Date(r.body.trial_ends_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
      const ents = (await u.call('GET', '/me/entitlements?program=toeic')).body;
      expect(ents).toMatchObject({ is_pro: true, credits: 300 });
      expect(ents.features).toContain('ai_diagnose');
      await vi.waitFor(async () => expect(await inapp(u.id, 'billing.trial_started')).toHaveLength(1));
      const twice = await u.call('POST', '/promotions/redeem', { code: 'PRO7DAY', program: 'ielts' });
      expect(twice.status).toBe(400);
      expect(twice.body.error.details.promotion.reason).toBe('trial_already_used');
      const subId = r.body.subscription.id as string;
      const svc = app.get(SubscriptionsService);
      await dbs.db.update(billingSubscriptions).set({ currentPeriodEnd: new Date(Date.now() + 12 * 3600_000) }).where(eq(billingSubscriptions.id, subId));
      await svc.remindDue();
      await vi.waitFor(async () => expect(await inapp(u.id, 'billing.trial_ending')).toHaveLength(1));
      await dbs.db.update(billingSubscriptions).set({ currentPeriodEnd: new Date(Date.now() - 1000) }).where(eq(billingSubscriptions.id, subId));
      await dbs.db.update(schema.billingEntitlements).set({ validTo: new Date(Date.now() - 1000) }).where(eq(schema.billingEntitlements.sourceId, subId));
      await svc.expireDue();
      const subs = (await u.call('GET', '/me/subscriptions')).body as Array<{ id: string; status: string }>;
      expect(subs.find((s) => s.id === subId)!.status).toBe('expired');
      expect((await u.call('GET', '/me/entitlements?program=toeic')).body.is_pro).toBe(false);
      await vi.waitFor(async () => expect(await inapp(u.id, 'billing.trial_ended')).toHaveLength(1));
      expect((await u.call('POST', '/promotions/redeem', { code: 'PRO7DAY', program: 'toeic' })).body.error.details.promotion.reason).toBe('trial_already_used');
    });

    it('credit_bonus: GIFT200 đổi trực tiếp (+200 ledger promo có hạn), lần 2 từ chối; BONUS500 cộng khi thanh toán gói năm; mã giảm giá ở redeem → requires_order', async () => {
      const u = await register();
      const g = await u.call('POST', '/promotions/redeem', { code: 'GIFT200' });
      expect(g.body).toMatchObject({ kind: 'credit_bonus', credits_granted: 200, balance: 500 });
      const promoRow = (await ledger(u.id)).find((l) => l.reason === 'promo')!;
      expect(promoRow).toMatchObject({ delta: 200, refType: 'promotion', note: 'code=GIFT200' });
      expect(promoRow.expiresAt).not.toBeNull();
      expect((await u.call('POST', '/promotions/redeem', { code: 'GIFT200' })).body.error.details.promotion.reason).toBe('per_user_limit_reached');
      expect((await u.call('POST', '/promotions/redeem', { code: 'WELCOME10' })).body.error.details.promotion.reason).toBe('requires_order');
      expect((await u.call('POST', '/promotions/validate', { code: 'WELCOME10' })).body).toMatchObject({ valid: false, reason: 'plan_required' });
      expect((await order(u, 'toeic_pro_monthly', { promotion_code: 'BONUS500' })).body.error.details.promotion.reason).toBe('plan_not_eligible');
      const o = await buy(u, 'toeic_pro_yearly', { promotion_code: 'BONUS500' });
      expect(o.discount).toBe(0);
      const bonus = (await ledger(u.id)).filter((l) => l.reason === 'promo' && l.refId === o.id);
      expect(bonus.map((l) => l.delta)).toEqual([500]);
      expect((await u.call('GET', `/orders/${o.id}`)).body.promotion).toMatchObject({ code: 'BONUS500', kind: 'credit_bonus', bonus_credits: 500 });
    });

    it('admin CRUD khuyến mãi (mã chuẩn hoá, plan_codes, thống kê, audit); max_uses 2 với 3 đơn đồng thời → đúng 2 giữ lượt; tắt mã → inactive; learner 403; trùng mã 409', async () => {
      const code = `LIM${uniq().toUpperCase().slice(0, 5)}`;
      const created = await admin.call('POST', '/admin/promotions', { code: code.toLowerCase(), kind: 'amount', value: 20_000, plan_codes: ['toeic_pro_monthly'], valid_from: new Date(Date.now() - 60_000).toISOString(), valid_to: new Date(Date.now() + 86_400_000).toISOString(), max_uses: 2, per_user_limit: 1, conditions: { program_codes: ['toeic'] }, name: { vi: 'Giới hạn 2', en: 'Limit 2' } });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code, kind: 'fixed', value: 20_000, plan_codes: ['toeic_pro_monthly'], max_uses: 2, stackable: false, stats: { reserved: 0, redeemed: 0 } });
      expect((await admin.call('POST', '/admin/promotions', { code, kind: 'percent', value: 10, valid_from: new Date().toISOString(), valid_to: new Date(Date.now() + 1000).toISOString() })).status).toBe(409);
      expect((await admin.call('POST', '/admin/promotions', { code: 'BAD1', kind: 'percent', value: 150, valid_from: new Date().toISOString(), valid_to: new Date(Date.now() + 1000).toISOString() })).status).toBe(400);
      const users = await Promise.all([register(), register(), register()]);
      const results = await Promise.all(users.map((u) => order(u, 'toeic_pro_monthly', { promotion_code: code })));
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 400]);
      expect(results.find((r) => r.status === 400)!.body.error.details.promotion.reason).toBe('max_uses_reached');
      const got = await admin.call('GET', `/admin/promotions/${created.body.id}`);
      expect(got.body.stats).toMatchObject({ reserved: 2 });
      const listed = await admin.call('GET', `/admin/promotions?q=${code.slice(0, 6)}`);
      expect((listed.body.data as Array<{ id: string }>).some((p) => p.id === created.body.id)).toBe(true);
      const patched = await admin.call('PATCH', `/admin/promotions/${created.body.id}`, { is_active: false });
      expect(patched.body.is_active).toBe(false);
      expect((await users[0].call('POST', '/promotions/validate', { code, price_id: prices.toeic_pro_monthly })).body.reason).toBe('inactive');
      const audit = await dbs.db.select().from(opsAuditLogs).where(and(eq(opsAuditLogs.entityId, created.body.id), eq(opsAuditLogs.actorUserId, adminId)));
      expect(audit.map((a) => a.action).sort()).toEqual(['promotion.create', 'promotion.update']);
      expect((await users[0].call('GET', '/admin/promotions')).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------ referral
  describe('referral', () => {
    it('A giới thiệu B: joined → started (bài đầu) → upgraded (mua Pro); A và B nhận 200 + 500 credit (ledger referral); /me/referral, /referrals/{code}, /r/{code}', async () => {
      const a = await register({ ip: '10.10.0.1', fp: `fp-A-${uniq()}` });
      await verify(a);
      const me = await a.call('GET', '/me/referral');
      expect(me.status).toBe(200);
      const code = me.body.code as string;
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      expect(me.body.link).toContain(`/v1/r/${code}?utm_source=referral`);
      expect(me.body.landing_url).toContain(`ref=${code}`);
      expect(me.body).toMatchObject({ enabled: true, joined: 0, credits_earned: 0, config: { monthly_cap: 20 } });
      expect((await a.call('GET', '/me/referral')).body.code).toBe(code); // ổn định
      const b = await register({ ip: '10.10.1.2', fp: `fp-B-${uniq()}`, ref: code.toLowerCase() });
      await verify(b);
      const svc = app.get(ReferralService);
      await vi.waitFor(async () => expect((await svc.forReferee(b.id))?.status).toBe('joined'));
      expect((await svc.forReferee(b.id))!.blockedReason).toBeNull();
      await doAttempt(b);
      await vi.waitFor(async () => expect((await svc.forReferee(b.id))?.creditedJoinAt).not.toBeNull());
      expect((await svc.forReferee(b.id))!.status).toBe('started');
      await buy(b, 'toeic_pro_monthly');
      await vi.waitFor(async () => expect((await svc.forReferee(b.id))?.creditedUpgradeAt).not.toBeNull());
      const refRows = async (u: Bearer) => (await ledger(u.id)).filter((l) => l.reason === 'referral').map((l) => [l.delta, l.note]);
      expect(await refRows(a)).toEqual([
        [200, 'started:referrer'],
        [500, 'upgraded:referrer'],
      ]);
      expect(await refRows(b)).toEqual([
        [200, 'started:referee'],
        [500, 'upgraded:referee'],
      ]);
      const after = (await a.call('GET', '/me/referral')).body;
      expect(after).toMatchObject({ joined: 1, started: 1, upgraded: 1, credits_earned: 700, rewards: { this_month: 2 } });
      expect(after.recent[0]).toMatchObject({ status: 'upgraded', display_name: 'Họ***', rewarded: { started: true, upgraded: true }, blocked_reason: null });
      await vi.waitFor(async () => expect((await inapp(a.id, 'growth.referral_rewarded')).length).toBe(2));
      const landing = await inject({ method: 'GET', url: `/v1/referrals/${code}` });
      expect(landing.json()).toMatchObject({ code, valid: true, referrer_name: 'Họ***', reward: { referee_started: 200 } });
      const html = await inject({ method: 'GET', url: `/v1/r/${code}?utm_source=zalo&utm_medium=share` });
      expect(html.statusCode).toBe(200);
      expect(html.headers['content-type']).toContain('text/html');
      expect(html.body).toContain('og:title');
      expect(html.body).toContain(`ref=${code}`);
      expect(html.body).toContain('utm_source=zalo');
      expect((await inject({ method: 'GET', url: '/v1/referrals/ZZZZZZZZ' })).json()).toMatchObject({ valid: false, referrer_name: null });
    });

    it('chống lạm dụng: cùng fingerprint → duplicate_device; cùng thiết bị người giới thiệu → self_referral; chưa xác minh → bỏ qua rồi cấp bù khi đã xác minh; tự giới thiệu mình không tạo referral', async () => {
      const fpA = `fp-A2-${uniq()}`;
      const a = await register({ ip: '10.20.0.1', fp: fpA });
      await verify(a);
      const code = (await a.call('GET', '/me/referral')).body.code as string;
      const svc = app.get(ReferralService);
      const shared = `fp-shared-${uniq()}`;
      const b1 = await register({ ip: '10.20.1.1', fp: shared, ref: code });
      const b2 = await register({ ip: '10.20.1.2', fp: shared, ref: code });
      const self = await register({ ip: '10.20.1.3', fp: fpA, ref: code });
      await vi.waitFor(async () => expect((await svc.forReferee(self.id))).not.toBeNull());
      expect((await svc.forReferee(b1.id))!.blockedReason).toBeNull();
      expect((await svc.forReferee(b2.id))!.blockedReason).toBe('duplicate_device');
      expect((await svc.forReferee(self.id))!.blockedReason).toBe('self_referral');
      for (const u of [b2, self]) {
        await verify(u);
        await doAttempt(u);
      }
      await new Promise((r) => setTimeout(r, 300));
      expect((await ledger(a.id)).filter((l) => l.reason === 'referral')).toHaveLength(0);
      // b1 chưa xác minh: started bị bỏ qua (email_unverified) → xác minh → mua Pro: cấp bù started + upgraded
      await doAttempt(b1);
      await vi.waitFor(async () => expect(((await svc.forReferee(b1.id))!.metadata as { skipped?: Record<string, string> }).skipped?.started).toBe('email_unverified'));
      expect((await ledger(b1.id)).filter((l) => l.reason === 'referral')).toHaveLength(0);
      await verify(b1);
      await buy(b1, 'toeic_pro_monthly');
      await vi.waitFor(async () => expect((await ledger(b1.id)).filter((l) => l.reason === 'referral').map((l) => l.note)).toEqual(['started:referee', 'upgraded:referee']));
      expect((await a.call('GET', '/me/referral')).body.rewards.skipped).toBeGreaterThanOrEqual(2);
      // tự dùng mã của mình (đăng ký tài khoản khác không phải là A) đã kiểm; mã của chính A cho A → không áp dụng (A đã có tài khoản)
      expect(await svc.onRegistered({ user_id: a.id, referral_code: code })).toMatchObject({ referral_id: null });
      // khách không có mã giới thiệu
      const guest = client(app);
      await guest.call('POST', '/auth/guest');
      expect((await guest.call('GET', '/me/referral')).status).toBe(403);
    });

    it('trần thưởng tháng (cấu hình monthly_cap = 2): người thứ 3 trong tháng không được thưởng (cả hai bên)', async () => {
      expect((await admin.call('PUT', '/admin/flags/ff.growth.referral', { enabled: true, rules: { config: { monthly_cap: 2 } } })).status).toBe(200);
      try {
        const a = await register({ ip: '10.30.0.1', fp: `fp-A3-${uniq()}` });
        await verify(a);
        const code = (await a.call('GET', '/me/referral')).body.code as string;
        const svc = app.get(ReferralService);
        const refs: Bearer[] = [];
        for (let i = 0; i < 3; i++) {
          const b = await register({ ip: `10.30.${i + 1}.9`, fp: `fp-cap-${i}-${uniq()}`, ref: code });
          await verify(b);
          refs.push(b);
        }
        for (const b of refs) {
          await vi.waitFor(async () => expect(await svc.forReferee(b.id)).not.toBeNull());
          await doAttempt(b);
          await vi.waitFor(async () => expect((await svc.forReferee(b.id))!.status).toBe('started'));
          await new Promise((r) => setTimeout(r, 100));
        }
        await vi.waitFor(async () => expect((await ledger(a.id)).filter((l) => l.reason === 'referral')).toHaveLength(2));
        const third = await svc.forReferee(refs[2]!.id);
        expect((third!.metadata as { skipped?: Record<string, string> }).skipped?.started).toBe('monthly_cap');
        expect((await ledger(refs[2]!.id)).filter((l) => l.reason === 'referral')).toHaveLength(0);
      } finally {
        await admin.call('PUT', '/admin/flags/ff.growth.referral', { enabled: true, rules: { config: { monthly_cap: 20 } } });
      }
    });
  });

  // ------------------------------------------------------------------ thông báo
  describe('NotificationService đa kênh', () => {
    it('email marketing (tóm tắt tuần): có đồng ý → gửi (HTML + plain-text + List-Unsubscribe); ≤ 1/tuần; tắt marketing email → không nhận, in-app vẫn có', async () => {
      const u = await register({ marketing: true });
      const prefs = (await u.call('GET', '/me/notification-preferences')).body;
      expect(prefs.categories.marketing).toEqual({ email: true, push: false, inapp: true });
      expect(prefs).toMatchObject({ frequency: { marketing_email_per_week: 1, push_per_day: 2 }, timezone: 'Asia/Ho_Chi_Minh' });
      const notify = app.get(NotificationService);
      const data = { minutes: 95, attempts: 4, xp: 160, streak: 3 };
      const r1 = await notify.send(u.id, 'learning.weekly_summary', data);
      expect(r1.results.find((x) => x.channel === 'email')).toMatchObject({ status: 'sent' });
      const mail = mailer.allTo(u.email).find((m) => m.subject === 'Tóm tắt tuần của bạn trên Allingo')!;
      expect(mail.text).toContain('95 phút');
      expect(mail.html).toContain('<strong>95</strong>');
      expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<http.*\/v1\/notifications\/unsubscribe\?token=/);
      expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      const r2 = await notify.send(u.id, 'learning.weekly_summary', data);
      expect(r2.results.find((x) => x.channel === 'email')).toMatchObject({ status: 'skipped', reason: 'rate_limited' });
      expect((await u.call('PATCH', '/me/notification-preferences', { categories: { marketing: { email: false } } })).body.categories.marketing.email).toBe(false);
      await dbs.db.update(opsNotifications).set({ sentAt: new Date(Date.now() - 8 * 86_400_000) }).where(and(eq(opsNotifications.userId, u.id), eq(opsNotifications.channel, 'email')));
      const r3 = await notify.send(u.id, 'learning.weekly_summary', data);
      expect(r3.results).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'email', status: 'skipped', reason: 'category_disabled' }), expect.objectContaining({ channel: 'inapp', status: 'sent' })]));
      expect(mailer.allTo(u.email).filter((m) => m.subject === 'Tóm tắt tuần của bạn trên Allingo')).toHaveLength(1);
      // chưa đồng ý marketing → mặc định không gửi email marketing
      const noConsent = await register();
      expect((await notify.send(noConsent.id, 'learning.weekly_summary', data)).results.find((x) => x.channel === 'email')).toMatchObject({ status: 'skipped', reason: 'category_disabled' });
    });

    it('push: nhắc học trong giờ yên lặng (giờ VN) không gửi; nhắc gia hạn hoãn tới 07:00 rồi dispatch; ≤ 2 push/ngày; tắt push loại learning → bỏ qua', async () => {
      const u = await register();
      const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
      expect((await u.call('POST', '/me/push-subscriptions', { endpoint: `https://fcm.googleapis.com/fcm/send/s8-${uniq()}`, keys })).status).toBe(201);
      const sender = app.get<MemoryPushSender>(PUSH_SENDER);
      const notify = app.get(NotificationService);
      const before = sender.sent.length;
      const night = vnToday('23:15');
      const q = await notify.send(u.id, 'learning.study_reminder', { minutes: 10 }, { now: night });
      expect(q.results.find((x) => x.channel === 'push')).toMatchObject({ status: 'skipped', reason: 'quiet_hours' });
      expect(sender.sent.length).toBe(before);
      const exp = await notify.send(u.id, 'billing.subscription_expiring', { plan_name: { vi: 'TOEIC Pro – Tháng' }, days_before: 3, period_end: new Date(Date.now() + 3 * 86_400_000).toISOString() }, { now: night, channels: ['push'] });
      expect(exp.results[0]).toMatchObject({ channel: 'push', status: 'scheduled', reason: 'quiet_hours' });
      const [row] = await dbs.db.select().from(opsNotifications).where(eq(opsNotifications.id, exp.results[0]!.notification_id!));
      expect(row!.scheduledAt.toISOString()).toBe(vnToday('07:00', 1).toISOString());
      const d = await notify.dispatchDue(vnToday('07:01', 1));
      expect(d.sent).toBeGreaterThanOrEqual(1);
      expect(sender.sent.length).toBe(before + 1);
      const pushed = JSON.parse(sender.sent[sender.sent.length - 1]!.payload) as { template_code: string; title: string; body: string };
      expect(pushed).toMatchObject({ template_code: 'billing.subscription_expiring', title: 'Gói Pro sắp hết hạn' });
      // ngày mới (giờ VN): ≤ 2 push không giao dịch
      const noon = vnToday('12:00', 2);
      const sends = [];
      for (let i = 0; i < 3; i++) sends.push((await notify.send(u.id, 'learning.study_reminder', { minutes: 10 + i }, { now: noon, channels: ['push'] })).results[0]);
      expect(sends.map((s) => s!.status)).toEqual(['sent', 'sent', 'skipped']);
      expect(sends[2]).toMatchObject({ reason: 'rate_limited' });
      await u.call('PATCH', '/me/notification-preferences', { categories: { learning: { push: false } } });
      expect((await notify.send(u.id, 'learning.study_reminder', {}, { now: vnToday('12:00', 3), channels: ['push'] })).results[0]).toMatchObject({ status: 'skipped', reason: 'category_disabled' });
    });

    it('in-app: GET /me/notifications có title/body/url + unread_count; đọc một, đọc tất cả; thông báo người khác → 404', async () => {
      const u = await register();
      const other = await register();
      const notify = app.get(NotificationService);
      await notify.send(u.id, 'growth.referral_rewarded', { credits: 200, stage: 'started', is_referrer: true }, { channels: ['inapp'] });
      await notify.send(u.id, 'learning.study_reminder', { minutes: 15 }, { channels: ['inapp'] });
      const list = await u.call('GET', '/me/notifications');
      expect(list.body.unread_count).toBe(2);
      expect(list.body.data[0]).toMatchObject({ template_code: 'learning.study_reminder', category: 'learning', title: 'Đến giờ học rồi!', url: '/toeic/today', status: 'sent' });
      const id = list.body.data[1].id as string;
      expect((await u.call('POST', `/me/notifications/${id}/read`)).body).toMatchObject({ id, status: 'read' });
      expect((await u.call('GET', '/me/notifications?unread=true')).body.data).toHaveLength(1);
      expect((await other.call('POST', `/me/notifications/${id}/read`)).status).toBe(404);
      expect((await u.call('POST', '/me/notifications/read-all')).body).toEqual({ updated: 1, unread_count: 0 });
      expect((await u.call('GET', '/me/notifications')).body.unread_count).toBe(0);
    });

    it('huỷ đăng ký bằng link ký: GET → 302 trang quản lý web; POST one-click tắt email loại; token sửa → 400; trang quản lý GET/PATCH theo token', async () => {
      const u = await register({ marketing: true });
      const notify = app.get(NotificationService);
      const url = new URL(notify.unsubscribeUrl(u.id, 'marketing'));
      const get = await inject({ method: 'GET', url: `${url.pathname}${url.search}` });
      expect(get.statusCode).toBe(302);
      expect(String(get.headers.location)).toContain('/notifications/manage?token=');
      const post = await app.getHttpAdapter().getInstance().inject({ method: 'POST', url: `${url.pathname}${url.search}`, payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      expect(post.statusCode).toBe(200);
      expect(post.json()).toEqual({ unsubscribed: true, category: 'marketing', channel: 'email' });
      expect((await u.call('GET', '/me/notification-preferences')).body.categories.marketing.email).toBe(false);
      const token = url.searchParams.get('token')!;
      expect((await inject({ method: 'POST', url: `/v1/notifications/unsubscribe?token=${encodeURIComponent(token.replace('marketing', 'all'))}` })).statusCode).toBe(400);
      const manageToken = new URL(notify.manageUrl(u.id)).searchParams.get('token')!;
      const m = await inject({ method: 'GET', url: `/v1/notifications/manage?token=${encodeURIComponent(manageToken)}` });
      expect(m.json()).toMatchObject({ token_category: 'all', categories: { marketing: { email: false } } });
      expect(m.json().email_masked).toMatch(/^s8\*\*\*@example\.com$/);
      const p = await inject({ method: 'PATCH', url: `/v1/notifications/manage?token=${encodeURIComponent(manageToken)}`, body: { categories: { learning: { email: false } } } });
      expect(p.json().categories.learning.email).toBe(false);
    });
  });

  // ------------------------------------------------------------------ billing admin & Free credit tháng
  describe('billing admin & Free credit tháng', () => {
    it('admin cấp 100 credit kèm lý do → ledger admin_adjust, audit có admin id; thiếu lý do 400; trừ quá số dư 409; learner 403; ledger + danh sách thanh toán/subscription', async () => {
      const u = await register();
      const r = await admin.call('POST', `/admin/users/${u.id}/credits`, { delta: 100, note: 'Bù lỗi chấm bài' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ user_id: u.id, delta: 100, balance_after: 400, reason: 'admin_adjust', actor_id: adminId });
      const row = (await ledger(u.id)).find((l) => l.reason === 'admin_adjust')!;
      expect(row).toMatchObject({ delta: 100, note: 'Bù lỗi chấm bài', refType: 'admin', refId: adminId });
      const audit = await dbs.db.select().from(opsAuditLogs).where(and(eq(opsAuditLogs.entityId, u.id), eq(opsAuditLogs.action, 'user.grant_credits')));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorUserId).toBe(adminId);
      expect((await admin.call('POST', `/admin/users/${u.id}/credits`, { delta: 100 })).status).toBe(400);
      expect((await admin.call('POST', `/admin/users/${u.id}/credits`, { delta: 100, note: 'x' })).status).toBe(400);
      expect((await admin.call('POST', `/admin/users/${u.id}/credits`, { delta: -10_000, note: 'Thu hồi nhầm' })).status).toBe(409);
      expect((await admin.call('POST', `/admin/users/${crypto.randomUUID()}/credits`, { delta: 5, note: 'không có ai' })).status).toBe(404);
      expect((await u.call('POST', `/admin/users/${u.id}/credits`, { delta: 100, note: 'tự cấp' })).status).toBe(403);
      const l = await admin.call('GET', `/admin/users/${u.id}/credits/ledger`);
      expect(l.body).toMatchObject({ user_id: u.id, balance: 400 });
      expect(l.body.data[0]).toMatchObject({ reason: 'admin_adjust', delta: 100 });
      const o = await buy(u, 'toeic_pro_monthly');
      const pays = await admin.call('GET', `/admin/billing/payments?order_id=${o.id}`);
      expect(pays.body.data[0]).toMatchObject({ order_id: o.id, user_id: u.id, provider: 'mock', status: 'success', amount: 199_000 });
      const subs = await admin.call('GET', `/admin/billing/subscriptions?user_id=${u.id}&status=active`);
      expect(subs.body.data[0]).toMatchObject({ user_id: u.id, status: 'active', source_order_id: o.id });
      expect((await admin.call('GET', `/admin/billing/subscriptions?user_id=${u.id}&expiring_within_days=31`)).body.data).toHaveLength(1);
    });

    it('credit.grant_free_monthly: tháng đăng ký không cấp thêm; tháng sau +300 (lô hết hạn đầu tháng kế), chạy lại không cấp; Pro và khách không cấp; credit.expire thu lô cũ', async () => {
      const free = await register();
      const pro = await register();
      await buy(pro, 'toeic_pro_monthly');
      const guest = client(app);
      const g = await guest.call('POST', '/auth/guest');
      const guestId = g.body.user.id as string;
      const svc = app.get(FreeCreditsService);
      const ids = [free.id, pro.id, guestId];
      expect((await svc.grantDue(new Date(), { userIds: ids })).users).toBe(0);
      const vnNow = new Date(Date.now() + 7 * 3600_000);
      const nextMonth = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth() + 1, 1, 1) - 7 * 3600_000); // 01:00 VN ngày 1 tháng sau
      const r = await svc.grantDue(nextMonth, { userIds: ids });
      expect(r).toMatchObject({ period: vnMonth(nextMonth), users: 1, credits: 300 });
      expect((await svc.grantDue(nextMonth, { userIds: ids })).users).toBe(0);
      const grant = (await ledger(free.id)).find((l) => l.refType === 'free_monthly')!;
      expect(grant).toMatchObject({ delta: 300, reason: 'subscription_grant', refId: freeMonthlyRefId(vnMonth(nextMonth)) });
      const monthAfter = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth() + 2, 1) - 7 * 3600_000);
      expect(grant.expiresAt!.toISOString()).toBe(monthAfter.toISOString());
      expect((await ledger(pro.id)).some((l) => l.refType === 'free_monthly')).toBe(false);
      expect((await ledger(guestId)).some((l) => l.refType === 'free_monthly')).toBe(false);
      await app.get(CreditService).expireDue(new Date(monthAfter.getTime() + 3600_000));
      const exp = (await ledger(free.id)).filter((l) => l.reason === 'expire' && l.refType === 'free_monthly');
      expect(exp.map((l) => l.delta)).toEqual([-300]);
      const [last] = await dbs.db.select().from(billingCreditLedger).where(eq(billingCreditLedger.userId, free.id)).orderBy(desc(billingCreditLedger.id)).limit(1);
      expect(last!.balanceAfter).toBe(300);
      // job đăng ký trong JobsService (POST /admin/billing/jobs/credit.grant_free_monthly)
      const job = await admin.call('POST', '/admin/billing/jobs/credit.grant_free_monthly');
      expect([200, 202]).toContain(job.status);
    });
  });

  it('referral: outbox user.registered có mã + fingerprint băm (không lưu bản gốc)', async () => {
    const a = await register({ ip: '10.40.0.1' });
    const code = (await a.call('GET', '/me/referral')).body.code as string;
    const b = await register({ ip: '10.40.0.2', fp: 'raw-fingerprint-value-123', ref: code });
    const [ev] = await dbs.db.select().from(opsOutbox).where(and(eq(opsOutbox.eventType, 'user.registered'), eq(opsOutbox.aggregateId, b.id)));
    expect(ev!.payload).toMatchObject({ referral_code: code, ip: '10.40.0.2' });
    expect((ev!.payload as { device_fp: string }).device_fp).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(ev!.payload)).not.toContain('raw-fingerprint-value-123');
    const ref = await vi.waitFor(async () => {
      const [r] = await dbs.db.select().from(iamReferrals).where(eq(iamReferrals.refereeUserId, b.id));
      expect(r).toBeDefined();
      return r!;
    });
    expect(ref.deviceFingerprint).toBe((ev!.payload as { device_fp: string }).device_fp);
  });
});
