import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DEMO_PASSWORD } from '@allingo/db/seed';
import { DbService } from '../../src/shared/db/db.module.js';
import { bootTestApp } from './setup.js';

/**
 * Sprint 10 – sửa lỗi API phát hiện khi làm web S7–8: CORS cho X-Device-Fingerprint, POST /promotions/validate ẩn danh (giới hạn
 * theo IP, `requires_login`), job payment.reconcile chạy tay với `min_age_minutes`, `user_email` ở danh sách admin billing.
 */
describe('Sprint 10 – sửa lỗi API (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let adminToken = '';
  const prices: Record<string, string> = {};
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);
  type Res = { status: number; body: any; headers: Record<string, unknown> }; // eslint-disable-line @typescript-eslint/no-explicit-any -- body động trong test
  const call = async (method: 'GET' | 'POST' | 'OPTIONS', url: string, body?: unknown, headers: Record<string, string> = {}, ip = '127.0.0.1'): Promise<Res> => {
    const r = await inject({ method, url: `/v1${url}`, body: body as never, headers, remoteAddress: ip });
    let json: unknown = null;
    try {
      json = r.json();
    } catch {
      json = r.body;
    }
    return { status: r.statusCode, body: json, headers: r.headers };
  };
  const register = async () => {
    const email = `s10fix-${crypto.randomBytes(5).toString('hex')}@example.com`;
    const r = await call('POST', '/auth/register', { email, password: 'Password123!', display_name: 'Fix', accept_terms: true });
    expect(r.status).toBe(201);
    return { email, id: r.body.user.id as string, token: r.body.access_token as string };
  };

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDERS = 'mock';
    process.env.PAYMENT_MOCK_SECRET = 'test-mock-secret-s10';
    app = await bootTestApp();
    dbs = app.get(DbService);
    const login = await call('POST', '/auth/login', { email: 'admin@allingo.dev', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    adminToken = login.body.access_token;
    await dbs.db.update(schema.billingFeatureFlags).set({ enabled: true }).where(eq(schema.billingFeatureFlags.key, 'ff.billing.checkout'));
    const plans = (await call('GET', '/plans?program=toeic')).body as Array<{ code: string; price: { id: string } | null }>;
    for (const p of plans) if (p.price) prices[p.code] = p.price.id;
  });
  afterAll(async () => {
    delete process.env.PAYMENT_PROVIDERS;
    delete process.env.PAYMENT_MOCK_SECRET;
    await app?.close();
  });

  it('CORS: preflight từ web cho phép header X-Device-Fingerprint', async () => {
    const r = await inject({ method: 'OPTIONS', url: '/v1/auth/register', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-device-fingerprint' } });
    expect(r.statusCode).toBeLessThan(300);
    expect(String(r.headers['access-control-allow-origin'])).toBe('http://localhost:3000');
    expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('x-device-fingerprint');
  });

  it('POST /promotions/validate ẩn danh: 200 (không 401), điều kiện theo người dùng → requires_login; đăng nhập → đánh giá đầy đủ; > 30/phút/IP → 429', async () => {
    const anon = await call('POST', '/promotions/validate', { code: 'WELCOME20', price_id: prices.toeic_pro_monthly }, {}, '10.10.0.1');
    expect(anon.status).toBe(200);
    expect(anon.body).toMatchObject({ valid: true, requires_login: true, code: 'WELCOME20' });
    expect(anon.body.discount).toBeGreaterThan(0);
    const missing = await call('POST', '/promotions/validate', { code: 'KHONGCO123' }, {}, '10.10.0.1');
    expect(missing.body).toMatchObject({ valid: false, reason: 'not_found', requires_login: false });
    const expired = await call('POST', '/promotions/validate', { code: 'EXPIRED2025', price_id: prices.toeic_pro_monthly }, {}, '10.10.0.1');
    expect(expired.body).toMatchObject({ valid: false, reason: 'expired' });
    const u = await register();
    const authed = await call('POST', '/promotions/validate', { code: 'WELCOME20', price_id: prices.toeic_pro_monthly }, { authorization: `Bearer ${u.token}` }, '10.10.0.1');
    expect(authed.body.valid).toBe(true);
    expect(authed.body.requires_login).toBeUndefined();
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await call('POST', '/promotions/validate', { code: 'WELCOME20' }, {}, '10.10.0.2')).status;
    expect(last).toBe(429);
    // Người đã đăng nhập không bị giới hạn ẩn danh theo IP
    expect((await call('POST', '/promotions/validate', { code: 'WELCOME20' }, { authorization: `Bearer ${u.token}` }, '10.10.0.2')).status).toBe(200);
  });

  it('admin: payment.reconcile chạy tay với min_age_minutes = 0 kiểm cả lần thanh toán vừa tạo; danh sách đơn/thanh toán có user_email', async () => {
    const u = await register();
    const o = await call('POST', '/orders', { price_id: prices.toeic_pro_monthly }, { authorization: `Bearer ${u.token}`, 'idempotency-key': crypto.randomUUID() });
    expect(o.status).toBe(201);
    expect((await call('POST', `/orders/${o.body.id}/pay`, { provider: 'mock' }, { authorization: `Bearer ${u.token}` })).status).toBe(200);
    const admin = { authorization: `Bearer ${adminToken}` };
    const normal = await call('POST', '/admin/billing/jobs/payment.reconcile', {}, admin);
    expect(normal.status).toBe(200);
    const before = normal.body.result.checked as number;
    const forced = await call('POST', '/admin/billing/jobs/payment.reconcile', { min_age_minutes: 0 }, admin);
    expect(forced.status).toBe(200);
    expect(forced.body.result.checked).toBeGreaterThan(before);
    expect((await call('POST', '/admin/billing/jobs/payment.reconcile', { min_age_minutes: -1 }, admin)).status).toBe(400);
    expect((await call('POST', '/admin/billing/jobs/payment.reconcile', { min_age_minutes: 0 }, { authorization: `Bearer ${u.token}` })).status).toBe(403);
    const orders = (await call('GET', `/admin/billing/orders?user_id=${u.id}`, undefined, admin)).body;
    expect(orders.data[0]).toMatchObject({ id: o.body.id, user_id: u.id, user_email: u.email });
    const payments = (await call('GET', `/admin/billing/payments?user_id=${u.id}`, undefined, admin)).body;
    expect(payments.data[0]).toMatchObject({ user_id: u.id, user_email: u.email });
    const subs = (await call('GET', '/admin/billing/subscriptions?limit=5', undefined, admin)).body;
    for (const s of subs.data) expect(s).toHaveProperty('user_email');
    const invoices = (await call('GET', '/admin/billing/invoices?limit=5', undefined, admin)).body;
    for (const i of invoices.data) expect(i).toHaveProperty('user_email');
  });
});
