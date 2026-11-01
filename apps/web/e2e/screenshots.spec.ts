import { test } from '@playwright/test';

/**
 * Chụp màn hình các màn chính (dùng để rà soát thiết kế, không phải test nghiệm thu).
 * Chạy: E2E_NO_SERVER=1 pnpm exec playwright test e2e/screenshots.spec.ts --project=chromium
 */
const OUT = process.env.SHOT_DIR ?? 'test-results/shots';

test.skip(!process.env.SHOT_DIR, 'chỉ chạy khi đặt SHOT_DIR');

test('chụp màn hình luồng khách', async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e.cleared')) return;
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('allingo.')) window.localStorage.removeItem(k);
    window.sessionStorage.setItem('e2e.cleared', '1');
  });
  await page.goto('/vi');
  await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: true });
  await page.getByRole('button', { name: 'Luyện thử miễn phí' }).first().click();
  await page.waitForURL(/dashboard/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true });
  await page.goto('/vi/toeic/test-sets');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/03-test-sets.png`, fullPage: true });
  // mock: toeic-p5-mini-01, seed demo: toeic-mini-part5-01
  await page.locator('[data-testid^="test-set-toeic-"]').filter({ hasText: /Part 5/ }).first().getByRole('button', { name: /Bắt đầu/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-start-dialog.png` });
  await page.getByTestId('start-attempt').click();
  await page.waitForURL(/attempts/);
  await page.waitForTimeout(800);
  await page.getByTestId('option-B').click();
  await page.screenshot({ path: `${OUT}/05-exam.png`, fullPage: true });
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('1');
  }
  await page.getByTestId('submit-button').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/06-submit-dialog.png` });
  await page.getByTestId('confirm-submit').click();
  await page.waitForURL(/result/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/07-result.png`, fullPage: true });
  await page.getByTestId('review-link').click();
  await page.waitForURL(/review/);
  await page.waitForTimeout(800);
  // Cache giải thích dùng chung → nút có thể không hiện nếu đã có sẵn
  const explainBtn = page.getByTestId('review-item-1').getByTestId('explain-button');
  if (await explainBtn.isVisible()) await explainBtn.click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/08-review.png`, fullPage: true });
  await page.goto('/vi/settings');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/09-settings.png`, fullPage: true });
  // Part 2 listening (audio once)
  await page.goto('/vi/toeic/test-sets');
  await page.locator('[data-testid^="test-set-toeic-"]').filter({ hasText: /Part 2/ }).first().getByRole('button', { name: /Bắt đầu/ }).click();
  await page.getByTestId('start-attempt').click();
  await page.waitForURL(/attempts/);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/10-exam-listening.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/11-exam-mobile.png`, fullPage: true });
  await page.goto('/vi');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/12-landing-mobile.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/vi/toeic/dashboard');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/13-dashboard-dark.png`, fullPage: true });
});
