import { expect, test } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { registerNewUser } from './billing-helpers';
import { createPlanViaApi, TZ } from './plan-helpers';

/**
 * Sprint 9 – huy hiệu: lưới đã đạt/chưa + tiến độ, XP + cấp; toast khi nhận huy hiệu (thông báo in-app `learning.badge_awarded`
 * qua realtime). Mock: dựng chuỗi 6 ngày (hôm qua) bằng hook `__ALLINGO_MOCK__.seedStreak` → học hôm nay → "7 ngày liên tiếp" +
 * "Bài đầu tiên". API thật: người mới → bài luyện đầu tiên → "Bài đầu tiên".
 */

test.use({ timezoneId: TZ });

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('huy hiệu: lưới + tiến độ, nhận huy hiệu khi học (toast realtime), XP/cấp', async ({ page }) => {
  test.setTimeout(120_000);
  await registerNewUser(page, 'badges');
  await createPlanViaApi(page);

  await page.goto('/vi/badges');
  const grid = page.getByTestId('badge-grid');
  await expect(grid.getByTestId('badge-tile')).toHaveCount(6);
  await expect(grid.locator('[data-earned="true"]')).toHaveCount(0);
  await expect(grid.locator('[data-code="first_attempt"]')).toContainText('0/1');
  await expect(page.getByTestId('xp-card')).toHaveAttribute('data-level', '1');

  if (!REAL) {
    await page.waitForFunction(() => !!(window as unknown as { __ALLINGO_MOCK__?: { seedStreak?: unknown } }).__ALLINGO_MOCK__?.seedStreak);
    expect(await page.evaluate(() => (window as unknown as { __ALLINGO_MOCK__: { seedStreak: (n: number) => boolean } }).__ALLINGO_MOCK__.seedStreak(6))).toBe(true);
    await page.reload();
    await expect(grid.locator('[data-code="streak_7"]')).toContainText('6/7');
  }

  // Học hôm nay: một lượt luyện Part 5 từ trang Luyện tập → nộp
  await page.goto('/vi/toeic/practice');
  await page.getByTestId('practice-section').selectOption('part5');
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await page.getByTestId('question-card').getByTestId('option-A').click();
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 30_000 });

  // Toast huy hiệu (realtime notification.new → toast riêng có tên huy hiệu)
  await expect(page.getByText('Huy hiệu mới: Bài đầu tiên')).toBeVisible({ timeout: 20_000 });
  if (!REAL) await expect(page.getByText('Huy hiệu mới: 7 ngày liên tiếp')).toBeVisible();

  await page.goto('/vi/badges');
  await expect(grid.locator('[data-code="first_attempt"]')).toHaveAttribute('data-earned', 'true');
  await expect(grid.locator('[data-code="first_attempt"]')).toContainText('Đã đạt');
  if (!REAL) {
    await expect(grid.locator('[data-code="streak_7"]')).toHaveAttribute('data-earned', 'true');
    await expect(page.getByTestId('badges-streak')).toContainText('7 ngày');
  }
  await expect.poll(async () => Number(await page.getByTestId('xp-card').getAttribute('data-xp'))).toBeGreaterThan(0);
  // Huy hiệu đã đạt xếp trước
  await expect(grid.getByTestId('badge-tile').first()).toHaveAttribute('data-earned', 'true');
});
