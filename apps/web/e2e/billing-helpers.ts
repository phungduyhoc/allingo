import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { REAL } from './helpers';

/**
 * Tiện ích E2E Sprint 7/8 (billing, referral, thông báo, admin) – chạy được cả với API giả lập (mặc định) và API thật
 * (E2E_REAL_API=1). Gọi "máy chủ" trực tiếp: API thật → page.request (dùng chung cookie với trình duyệt); mock →
 * `window.__ALLINGO_MOCK__.request` (trạng thái giả nằm trong localStorage của trang).
 */

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
export const ADMIN = { email: 'admin@allingo.dev', password: 'Allingo@2026' };
export const PASSWORD = 'E2e-Passw0rd!';

export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@allingo.test`;

export async function registerViaUi(page: Page, opts: { email: string; name: string; path?: string }): Promise<void> {
  if (opts.path) await page.goto(opts.path);
  else await page.goto('/vi/signup');
  const form = page.getByTestId('signup-form');
  await form.getByLabel('Tên hiển thị').fill(opts.name);
  await form.getByLabel('Email', { exact: true }).fill(opts.email);
  await form.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByTestId('accept-terms').check();
  await form.getByRole('button', { name: 'Đăng ký', exact: true }).click();
}

export async function registerNewUser(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await registerViaUi(page, { email, name: `E2E ${prefix}` });
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/, { timeout: 20_000 });
  return email;
}

export async function loginViaUi(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/vi/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/, { timeout: 20_000 });
}

export async function logoutViaUi(page: Page): Promise<void> {
  if (!/\/vi\/(toeic|account|settings|notifications|referral|admin|checkout)/.test(page.url())) await page.goto('/vi/toeic/dashboard');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/vi\/?$/);
}

/** Gọi API như người dùng đang đăng nhập trong trang */
export async function apiCall(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  if (REAL) {
    const res = await page.request.fetch(`${API}${path}`, { method, data: body, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), Origin: 'http://localhost:3000' } });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* chuỗi */
    }
    return { status: res.status(), data };
  }
  await page.waitForFunction(() => !!(window as unknown as { __ALLINGO_MOCK__?: { request?: unknown } }).__ALLINGO_MOCK__?.request);
  return page.evaluate(
    async ([m, p, b]) => {
      const w = window as unknown as { __ALLINGO_MOCK__: { request: (m: string, p: string, b?: unknown) => Promise<{ status: number; data: unknown }> } };
      return w.__ALLINGO_MOCK__.request(m, p, b);
    },
    [method, path, body] as const,
  );
}

export async function currentUserId(page: Page): Promise<string> {
  const r = await apiCall(page, 'GET', '/me');
  expect(r.status).toBe(200);
  return (r.data as { id: string }).id;
}

/** Context API đăng nhập admin (chỉ API thật) – chạy job/đọc admin song song phiên học viên của trình duyệt */
export async function adminApi(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: `${API}/`, extraHTTPHeaders: { Origin: 'http://localhost:3000' } });
  const res = await ctx.post('auth/login', { data: ADMIN });
  expect(res.ok()).toBe(true);
  return ctx;
}

function repoEnv(): Record<string, string> {
  const file = resolve(process.cwd(), '../../.env');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/\s+#.*$/, '').replace(/^"|"$/g, '');
  }
  return out;
}

/**
 * Token trang quản lý thông báo trong email (`v1.<user b64url>.<scope>.<sig>`, HMAC-SHA256 base64url 22 ký tự) – cùng thuật toán
 * API. API thật: khoá NOTIFY_UNSUBSCRIBE_SECRET hoặc dẫn xuất từ AUTH_SECRET (đọc env/.env dev); mock: khoá cố định của mock.
 */
export function manageToken(userId: string, scope: 'learning' | 'billing' | 'marketing' | 'all'): string | null {
  let secret: string | null = 'allingo-mock-unsubscribe-secret';
  if (REAL) {
    const env = { ...repoEnv(), ...process.env };
    secret = env.NOTIFY_UNSUBSCRIBE_SECRET ?? (env.AUTH_SECRET ? createHmac('sha256', env.AUTH_SECRET).update('allingo:notify:unsubscribe:v1').digest('hex') : null);
  }
  if (!secret) return null;
  const body = `v1.${Buffer.from(userId, 'utf8').toString('base64url')}.${scope}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url').slice(0, 22)}`;
}

/**
 * API thật: `payment.reconcile` chỉ xét giao dịch `initiated` > PAYMENT_RECONCILE_AFTER_MINUTES (15′) – lùi `created_at` của
 * giao dịch trong DB dev (runbook payments §7 "sửa created_at trong dev") để chạy job ngay. Chỉ dùng cho DB dev/E2E.
 */
export function backdatePayments(orderId: string, minutes = 20): void {
  const url = process.env.E2E_DATABASE_URL ?? repoEnv().DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo';
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('bad order id');
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', `update billing.payments set created_at = now() - interval '${minutes} minutes' where order_id = '${orderId}' and status = 'initiated'`], { stdio: 'pipe' });
}

/** Bấm nút kết quả trên cổng thanh toán giả (API: /v1/payments/mock/checkout; mock: /[locale]/mock-gateway) */
export async function payAtMockGateway(page: Page, outcome: 'paid' | 'failed' | 'cancelled' | 'paid-drop'): Promise<void> {
  await expect(page).toHaveURL(REAL ? /\/v1\/payments\/mock\/checkout\?ref=/ : /\/mock-gateway\?ref=/, { timeout: 20_000 });
  await page.locator(`button[data-outcome="${outcome}"]`).click();
  await expect(page).toHaveURL(/\/vi\/checkout\/result\?/, { timeout: 20_000 });
}

/** Từ /pricing: mua gói theo mã (data-testid buy-<code>) → trang checkout */
export async function openCheckout(page: Page, planCode: string, opts: { promo?: string; period?: 'monthly' | 'yearly' | 'lifetime' } = {}): Promise<void> {
  await page.goto('/vi/pricing');
  await expect(page.getByTestId('pricing-page')).toBeVisible();
  if (opts.period) await page.getByTestId(`period-${opts.period}`).click();
  if (opts.promo) {
    await page.getByTestId('promo-input').fill(opts.promo);
    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-valid')).toBeVisible();
  }
  await page.getByTestId(`buy-${planCode}`).click();
  await expect(page).toHaveURL(/\/vi\/checkout\?price_id=/);
  await expect(page.getByTestId('checkout-page')).toBeVisible();
}

/** Trên trang checkout: (mặc định cá nhân) đồng ý điều khoản → thanh toán bằng cổng mock */
export async function submitCheckout(page: Page): Promise<void> {
  await page.getByTestId('provider-mock').click();
  await page.getByTestId('checkout-terms').check();
  await page.getByTestId('checkout-submit').click();
}

export function orderIdFromUrl(page: Page): string {
  const id = new URL(page.url()).searchParams.get('order_id');
  expect(id).toBeTruthy();
  return id!;
}
