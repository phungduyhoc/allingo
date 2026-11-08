import { expect, test, type Page } from '@playwright/test';
import { openCheckout, payAtMockGateway, registerNewUser, submitCheckout } from './billing-helpers';
import { answerCurrent, freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * S11 – CSP nghiêm có nonce (src/proxy.ts, lib/security/csp.ts): header CSP mỗi request một nonce, mọi <script> mang nonce, không
 * `unsafe-inline` cho script; luồng chính không có vi phạm CSP (sự kiện `securitypolicyviolation` + lỗi console) trên origin web:
 * landing, dashboard, làm bài Exam (Reading) + Listening, kết quả → Review + giải thích, checkout (cổng mock), blog (CMS).
 * Đồng thời bắt `MISSING_MESSAGE` của next-intl (S11 tách thông điệp theo trang khu vực học) trên các trang chính.
 * Chạy cả bản dev (`next dev`, có 'unsafe-eval' cho React dev) và production (`E2E_NO_SERVER=1` + `next start` → không eval).
 */

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };
const LISTENING = { mock: 'toeic-listening-mini-01', real: 'toeic-listening-01-drill-part1' };

interface Watch {
  problems: () => Promise<string[]>;
}

/** Ghi vi phạm CSP (mọi tài liệu cùng origin web) + lỗi console liên quan CSP / thiếu thông điệp i18n */
async function watch(page: Page): Promise<Watch> {
  const consoleProblems: string[] = [];
  const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:3000').origin;
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    const from = m.location().url ?? '';
    if (from && !from.startsWith(origin)) return;
    if (/Content Security Policy|Content-Security-Policy|MISSING_MESSAGE|nonce/i.test(text)) consoleProblems.push(`[console ${m.type()}] ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => {
    if (/MISSING_MESSAGE|Content Security Policy/i.test(e.message)) consoleProblems.push(`[pageerror] ${e.message.slice(0, 300)}`);
  });
  // Vi phạm lưu trong sessionStorage → gộp qua mọi lần điều hướng cùng origin (không mất khi đổi trang)
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      try {
        const list = JSON.parse(sessionStorage.getItem('e2e.csp') ?? '[]') as string[];
        list.push(`${e.violatedDirective} blocked=${e.blockedURI} at ${e.sourceFile}:${e.lineNumber} sample=${e.sample} page=${location.pathname}`);
        sessionStorage.setItem('e2e.csp', JSON.stringify(list));
      } catch {
        /* storage chặn */
      }
    });
  });
  return {
    problems: async () => {
      const violations = page.url().startsWith(origin) ? await page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e.csp') ?? '[]') as string[]) : [];
      return [...consoleProblems, ...violations.map((v) => `[csp] ${v}`)];
    },
  };
}

/** Vi phạm trong trang hiện tại phải đọc trước khi điều hướng (mỗi tài liệu một danh sách) */
async function expectClean(page: Page, w: Watch, label: string): Promise<void> {
  expect(await w.problems(), `${label}: vi phạm CSP / thiếu thông điệp`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('landing: header CSP có nonce mới mỗi request, mọi <script> trong HTML (kể cả JSON-LD, đồng ý cookie) mang nonce, không vi phạm', async ({ page, request }) => {
  const w = await watch(page);
  const res = await page.goto('/vi');
  const csp = res!.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]{16,}'[^;]*'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  for (const d of ["frame-ancestors '", "base-uri 'self'", "object-src 'none'", "form-action 'self'", 'connect-src ', 'img-src ', 'media-src ']) expect(csp).toContain(d);
  // HTML do server trả: mọi thẻ <script> (chunk, RSC inline, đồng ý cookie, next-themes, JSON-LD) mang ĐÚNG nonce của header
  const html = await request.get('/vi');
  const htmlCsp = html.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(htmlCsp)![1]!;
  expect(htmlCsp).not.toContain(/'nonce-([^']+)'/.exec(csp)![1]!);
  const tags = (await html.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(5);
  expect(tags.filter((tag) => !tag.includes(`nonce="${nonce}"`))).toEqual([]);
  expect(tags.some((tag) => tag.includes('application/ld+json'))).toBe(true);
  // Script trình duyệt đã thực thi giữ nonce (property – thuộc tính bị ẩn sau khi phân tích)
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')].every((s) => (s.nonce ?? '').length > 0))).toBe(true);
  await page.waitForLoadState('networkidle');
  await expectClean(page, w, 'landing');
});

test('dashboard → đề Exam (Reading) → kết quả → Review + giải thích: không vi phạm CSP', async ({ page }) => {
  test.setTimeout(REAL ? 150_000 : 90_000);
  const w = await watch(page);
  await startAsGuest(page);
  await expect(page.getByTestId('dashboard-tutor')).toBeVisible();
  await expectClean(page, w, 'dashboard');
  await startTestSet(page, PART5, 'exam');
  await answerCurrent(page, 'B');
  await page.getByTestId('next-button').click();
  await answerCurrent(page, 'A');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await expectClean(page, w, 'exam');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByTestId('raw-score')).toBeVisible();
  await expectClean(page, w, 'result');
  await page.getByTestId('review-link').click();
  const first = page.getByTestId('review-item-1');
  await expect(first).toBeVisible();
  const btn = first.getByTestId('explain-button');
  if (await btn.isVisible()) await btn.click();
  await expect(first.getByTestId('explanation-body')).toBeVisible({ timeout: 30_000 });
  await expectClean(page, w, 'review + explain');
});

test('Listening Exam: phát audio (media-src) không vi phạm CSP', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần trên desktop');
  await page.addInitScript(() => {
    (window as unknown as { __ALLINGO_AUDIO_RATE__: number }).__ALLINGO_AUDIO_RATE__ = 4;
  });
  const w = await watch(page);
  await startAsGuest(page);
  await startTestSet(page, LISTENING, 'exam');
  await page.getByTestId('start-listening').click();
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector<HTMLAudioElement>('audio[data-testid="exam-audio"][data-active="true"]')?.currentTime), { timeout: 30_000 })
    .toBe(true);
  await expectClean(page, w, 'listening');
});

test('checkout (cổng mock) → kết quả paid: không vi phạm CSP', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần trên desktop');
  test.setTimeout(120_000);
  const w = await watch(page);
  await registerNewUser(page, 'csp');
  await openCheckout(page, 'toeic_pro_monthly');
  await expectClean(page, w, 'checkout');
  await submitCheckout(page);
  // API thật: cổng giả là trang của API (CSP riêng của API) – chỉ kiểm trang web
  await payAtMockGateway(page, 'paid');
  await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', 'paid', { timeout: 20_000 });
  await expectClean(page, w, 'checkout result');
});

test('blog (CMS): danh sách + bài viết (ảnh CMS, JSON-LD) không vi phạm CSP', async ({ page }) => {
  const w = await watch(page);
  await page.goto('/vi/blog');
  await expect(page.getByTestId('blog-card').first()).toBeVisible();
  await expectClean(page, w, 'blog list');
  await page.getByTestId('blog-card-link').first().click();
  await expect(page.getByTestId('blog-post-title')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectClean(page, w, 'blog post');
});

test('các trang khu vực học: không thiếu thông điệp (MISSING_MESSAGE) và không vi phạm CSP', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần trên desktop');
  test.setTimeout(180_000);
  const w = await watch(page);
  await startAsGuest(page);
  const pages = ['/vi/toeic/today', '/vi/toeic/plan', '/vi/toeic/stats', '/vi/toeic/vocab', '/vi/toeic/errors', '/vi/toeic/test-sets', '/vi/toeic/practice', '/vi/notes', '/vi/settings', '/vi/settings/notifications', '/vi/account/billing', '/vi/notifications', '/vi/badges', '/vi/referral', '/vi/onboarding', '/vi/toeic/diagnostic', '/vi/pricing'];
  for (const p of pages) {
    await page.goto(p);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await expectClean(page, w, p);
  }
  // Điều hướng phía client giữa các trang (layout giữ nguyên, thông điệp trang mới phải có đủ)
  await page.goto('/vi/toeic/dashboard');
  await expect(page.getByTestId('kpi-streak')).toBeVisible();
  await page.getByTestId('dashboard-stats-link').click();
  await expect(page).toHaveURL(/\/toeic\/stats/);
  await page.waitForLoadState('networkidle');
  await expectClean(page, w, 'dashboard → stats (client)');
});
