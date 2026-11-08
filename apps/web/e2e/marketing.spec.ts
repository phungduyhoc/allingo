import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';

/**
 * Marketing & SEO (S10): landing/TOEIC/blog render ở server từ CMS (Payload) – `E2E_CMS_URL` → so khớp với REST CMS thật; không
 * có → chỉ kiểm cấu trúc (CMS chạy hoặc fixture mock khi CMS tắt). JSON-LD (Organization, FAQPage, Article/BlogPosting), OG image,
 * canonical/hreflang, sitemap liệt kê bài, robots; tuyên bố không liên kết ETS; đăng ký chờ JLPT; webhook revalidate (HMAC);
 * đồng ý cookie: trước khi đồng ý KHÔNG có request phân tích (kể cả consent=false) và không tải PostHog; sau đồng ý gửi
 * landing_view với consent=true; attribution UTM lần đầu gửi kèm đăng ký.
 */

const CMS = process.env.E2E_CMS_URL?.replace(/\/+$/, '') ?? null;

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function jsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raw.flatMap((t) => {
    const v = JSON.parse(t) as Record<string, unknown> | Array<Record<string, unknown>>;
    return Array.isArray(v) ? v : [v];
  });
}

/** Sự kiện phễu đã gửi: API thật → request mạng; mock → "máy chủ" giả trong localStorage */
async function mockEvents(page: Page): Promise<Array<{ event: string; consent: boolean }>> {
  return page.evaluate(() => {
    try {
      return ((JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as { analyticsEvents?: Array<{ event: string; consent: boolean }> }).analyticsEvents ?? []).slice();
    } catch {
      return [];
    }
  });
}

function revalidateSecret(): string | null {
  if (process.env.WEB_REVALIDATE_SECRET) return process.env.WEB_REVALIDATE_SECRET;
  const env = resolve(process.cwd(), '../../.env');
  if (!existsSync(env)) return null;
  return /^WEB_REVALIDATE_SECRET=(.+)$/m.exec(readFileSync(env, 'utf8'))?.[1]?.trim() ?? null;
}

test('landing: blocks CMS + 4 chương trình, JSON-LD Organization/FAQ, canonical + hreflang, OG image; không tải biểu đồ', async ({ page, request }) => {
  const scripts: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url());
  });
  await page.goto('/vi');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ngoại ngữ cho tất cả');
  await expect(page.getByTestId('block-hero')).toBeVisible();
  await expect(page.getByTestId('block-features')).toBeVisible();
  await expect(page.getByTestId('block-faq')).toBeVisible();
  for (const code of ['toeic', 'ielts', 'jlpt', 'hsk']) await expect(page.getByTestId(`program-${code}`)).toBeVisible();
  const ld = await jsonLd(page);
  expect(ld.some((x) => x['@type'] === 'Organization' && x.name === 'Allingo')).toBe(true);
  expect(ld.some((x) => x['@type'] === 'FAQPage')).toBe(true);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/vi$/);
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/en$/);
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toMatch(/opengraph-image/);
  const img = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
  expect(scripts.some((u) => /recharts/i.test(u))).toBe(false);

  if (CMS) {
    const cms = (await (await request.get(`${CMS}/api/pages?where[slug][equals]=home&depth=1`)).json()) as { docs: Array<{ layout: Array<{ blockType: string; heading?: { vi?: string } }> }> };
    const hero = cms.docs[0]!.layout.find((b) => b.blockType === 'hero');
    await expect(page.getByTestId('block-hero')).toContainText(hero!.heading!.vi!);
  }
});

test('/toeic: tuyên bố không liên kết ETS, định dạng 7 Part, FAQPage; /jlpt: sắp ra mắt + đăng ký chờ', async ({ page }) => {
  await page.goto('/vi/toeic');
  await expect(page.getByTestId('ets-disclaimer')).toContainText('không liên kết');
  await expect(page.getByTestId('ets-disclaimer')).toContainText('ETS');
  await expect(page.getByText('Định dạng TOEIC Listening & Reading')).toBeVisible();
  expect((await jsonLd(page)).some((x) => x['@type'] === 'FAQPage')).toBe(true);

  await page.goto('/vi/jlpt');
  await expect(page.getByTestId('coming-soon-jlpt')).toBeVisible();
  await page.getByTestId('waitlist-submit').click();
  await expect(page.getByText('Email chưa hợp lệ.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Email' }).fill(`waitlist-${Date.now()}@allingo.test`);
  await page.getByTestId('waitlist-submit').click();
  await expect(page.getByText('Bạn cần đồng ý nhận email thông báo.')).toBeVisible();
  await page.getByTestId('waitlist-consent').check();
  await page.getByTestId('waitlist-submit').click();
  // API thật chưa có POST /waitlist (backend S12) → thông báo thân thiện; mock → 202
  await expect(page.getByTestId(REAL ? 'waitlist-unavailable' : 'waitlist-accepted').or(page.getByTestId('waitlist-accepted'))).toBeVisible();
});

test('blog: danh sách → bài (Lexical, tác giả, chuyên mục) + JSON-LD Article/BlogPosting + OG; sitemap liệt kê bài; robots', async ({ page, request }) => {
  await page.goto('/vi/blog');
  const cards = page.getByTestId('blog-card');
  await expect(cards.first()).toBeVisible();
  const slugs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')!));
  const titles = await page.getByTestId('blog-card-link').allTextContents();
  if (CMS) {
    const cms = (await (await request.get(`${CMS}/api/posts?sort=-publishedAt&limit=50&depth=0`)).json()) as { docs: Array<{ slug: string; title: { vi: string } }> };
    expect(slugs).toEqual(cms.docs.map((d) => d.slug));
    expect(titles).toEqual(cms.docs.map((d) => d.title.vi));
  }

  await page.getByTestId('blog-card-link').first().click();
  await expect(page).toHaveURL(new RegExp(`/vi/blog/${slugs[0]}$`));
  await expect(page.getByTestId('blog-post-title')).toHaveText(titles[0]!);
  await expect(page.getByTestId('blog-post-content').locator('p').first()).toBeVisible();
  await expect(page.getByTestId('blog-post-content').locator('script')).toHaveCount(0);
  const article = (await jsonLd(page)).find((x) => x['@type'] === 'BlogPosting' || x['@type'] === 'Article');
  expect(article).toBeTruthy();
  expect(article!.url).toMatch(new RegExp(`/vi/blog/${slugs[0]}$`));
  expect(String(article!.headline).length).toBeGreaterThan(5);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
  const og = (await page.locator('meta[property="og:image"]').getAttribute('content'))!;
  expect((await request.get(new URL(og).pathname + new URL(og).search)).status()).toBe(200);

  // Bài không tồn tại → 404
  expect((await request.get('/vi/blog/khong-ton-tai-e2e')).status()).toBe(404);

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const s of slugs) {
    expect(sitemap).toContain(`/vi/blog/${s}</loc>`);
    expect(sitemap).toContain(`/en/blog/${s}</loc>`);
  }
  expect(sitemap).toContain('hreflang="en"');
  expect(sitemap).toContain('/vi/toeic</loc>');
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  expect(robots).toContain('Disallow: /vi/toeic/dashboard');
});

test('webhook revalidate: chữ ký sai/thiếu → 401; chữ ký đúng → làm mới đường dẫn theo locale', async ({ request }) => {
  const body = JSON.stringify({ event: 'update', collection: 'posts', id: 'e2e', slug: 'e2e', paths: ['/blog/e2e', '/blog', '/sitemap.xml'], tags: ['posts', 'sitemap', 'post:e2e'], locales: ['vi', 'en'], at: new Date().toISOString() });
  const ts = String(Math.floor(Date.now() / 1000));
  const bad = await request.post('/api/revalidate', { data: body, headers: { 'content-type': 'application/json', 'x-allingo-timestamp': ts, 'x-allingo-signature': 'sha256=deadbeef' } });
  expect([401, 503]).toContain(bad.status());
  const secret = revalidateSecret();
  test.skip(!secret, 'WEB_REVALIDATE_SECRET chưa cấu hình');
  const sig = `sha256=${createHmac('sha256', secret!).update(`${ts}.${body}`).digest('hex')}`;
  const ok = await request.post('/api/revalidate', { data: body, headers: { 'content-type': 'application/json', 'x-allingo-timestamp': ts, 'x-allingo-signature': sig } });
  expect(ok.status()).toBe(200);
  expect(((await ok.json()) as { paths: string[] }).paths).toEqual(expect.arrayContaining(['/vi/blog/e2e', '/en/blog/e2e', '/sitemap.xml']));
  const stale = String(Math.floor(Date.now() / 1000) - 600);
  const old = await request.post('/api/revalidate', { data: body, headers: { 'content-type': 'application/json', 'x-allingo-timestamp': stale, 'x-allingo-signature': `sha256=${createHmac('sha256', secret!).update(`${stale}.${body}`).digest('hex')}` } });
  expect(old.status()).toBe(401);
});

test('đồng ý cookie: trước đồng ý không có request phân tích/PostHog; đồng ý → landing_view (consent=true); nhớ lựa chọn, sửa ở chân trang', async ({ page }) => {
  const analytics: Request[] = [];
  const posthog: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/analytics/events')) analytics.push(r);
    if (/posthog/i.test(r.url())) posthog.push(r.url());
  });
  await page.goto('/vi?utm_source=e2e&utm_campaign=s10');
  await expect(page.getByTestId('cookie-banner')).toBeVisible();
  // Đi tiếp vài trang khi CHƯA đồng ý
  await page.goto('/vi/toeic');
  await page.goto('/vi/blog');
  await page.waitForTimeout(800);
  expect(analytics).toHaveLength(0);
  if (!REAL) expect(await mockEvents(page)).toHaveLength(0);
  expect(posthog).toHaveLength(0);

  // Từ chối → vẫn không gửi; banner ẩn, sau tải lại không hiện (không nháy – html[data-consent])
  await page.getByTestId('consent-reject').click();
  await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-consent', 'necessary');
  await expect(page.getByTestId('cookie-banner')).toBeHidden();
  expect(analytics).toHaveLength(0);

  // Sửa lại ở chân trang → đồng ý → landing_view với consent=true
  await page.getByTestId('consent-settings').click();
  await expect(page.getByTestId('cookie-banner')).toBeVisible();
  await expect(page.getByTestId('cookie-banner')).toContainText('chỉ cookie cần thiết');
  await page.getByTestId('consent-accept').click();
  await expect(page.locator('html')).toHaveAttribute('data-consent', 'analytics');
  if (REAL) {
    await expect.poll(() => analytics.length).toBeGreaterThan(0);
    const body = analytics[0]!.postDataJSON() as { event: string; consent: boolean; anonymous_id: string; path: string };
    expect(body).toMatchObject({ event: 'landing_view', consent: true, path: '/vi/blog' });
    expect(body.anonymous_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  } else {
    await expect.poll(async () => (await mockEvents(page)).length).toBeGreaterThan(0);
    expect((await mockEvents(page))[0]).toMatchObject({ event: 'landing_view', consent: true });
  }
  expect(posthog).toHaveLength(0);

  // Attribution lần chạm đầu (UTM của trang đầu tiên, không ghi đè)
  const attribution = await page.evaluate(() => JSON.parse(window.localStorage.getItem('allingo.attribution.v1') ?? 'null') as Record<string, string> | null);
  expect(attribution).toMatchObject({ utm_source: 'e2e', utm_campaign: 's10', landing_path: '/vi' });

  // Đăng ký: signup_start (đã đồng ý) + attribution gửi kèm POST /auth/register
  const registerBody = page.waitForRequest((r) => r.url().includes('/auth/register') && r.method() === 'POST').catch(() => null);
  await page.goto('/vi/signup');
  if (REAL) await expect.poll(() => analytics.some((r) => (r.postDataJSON() as { event: string }).event === 'signup_start')).toBe(true);
  else await expect.poll(async () => (await mockEvents(page)).some((e) => e.event === 'signup_start' && e.consent)).toBe(true);
  await page.getByLabel('Tên hiển thị').fill('E2E Attribution');
  await page.getByLabel('Email', { exact: true }).fill(`attr-${Date.now()}@allingo.test`);
  await page.getByLabel('Mật khẩu').fill('Allingo-e2e-2026!');
  await page.getByTestId('accept-terms').check();
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  await expect(page).toHaveURL(/dashboard/);
  if (REAL) {
    const req = await registerBody;
    expect((req?.postDataJSON() as { attribution?: Record<string, string> } | undefined)?.attribution).toMatchObject({ utm_source: 'e2e', landing_path: '/vi' });
  } else {
    const users = await page.evaluate(() => Object.values((JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as { users?: Record<string, { email?: string; attribution?: Record<string, string> }> }).users ?? {}));
    expect(users.find((u) => u.email?.startsWith('attr-'))?.attribution).toMatchObject({ utm_source: 'e2e', landing_path: '/vi' });
  }
});
