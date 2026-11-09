import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest } from './helpers';
import { getFlagReal, putFlagReal, setFlag, type FlagState } from './s12-helpers';

/**
 * C1 – khu học đa chương trình `/[program]/…` (mock + API thật):
 *  - URL `/toeic/...` cũ giữ nguyên (HTTP 200, không hiện "sắp ra mắt");
 *  - bộ chọn chương trình (dải đầu nội dung) → JLPT "sắp ra mắt" + danh sách chờ (BETA-02) → quay về TOEIC;
 *  - mã chương trình sai → 404 thật (như S152); IELTS: cờ ra mắt tắt → "sắp ra mắt", bật (có đề phát hành) → khu học IELTS.
 * Cờ `ff.catalog.program.ielts` là toàn cục → API thật: lưu trạng thái trước spec, trả lại ở `afterEach` (chạy cả khi test hết giờ).
 */

const IELTS_FLAG = 'ff.catalog.program.ielts';
const switcher = (page: Page) => page.locator('[data-testid="program-switcher"]:visible').first();

let savedFlag: FlagState | null = null;
test.beforeAll(async () => {
  if (REAL) savedFlag = await getFlagReal(IELTS_FLAG);
});
test.afterEach(async () => {
  if (savedFlag) await putFlagReal(IELTS_FLAG, savedFlag);
});

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('URL /toeic/... giữ nguyên; bộ chọn → JLPT "sắp ra mắt" + danh sách chờ; quay về TOEIC', async ({ page }) => {
  await startAsGuest(page);
  for (const p of ['test-sets', 'practice', 'errors', 'stats', 'plan', 'today', 'vocab']) {
    const res = await page.goto(`/vi/toeic/${p}`);
    expect(res?.status(), p).toBe(200);
    await expect(page.getByTestId('program-gate-loading')).toHaveCount(0);
    await expect(page.getByTestId('program-coming-soon')).toHaveCount(0);
  }
  await page.goto('/vi/toeic/dashboard');
  await expect(switcher(page)).toHaveValue('toeic');
  // Liên kết điều hướng của khu học trỏ đúng chương trình
  await expect(page.locator('a[href="/vi/toeic/test-sets"]:visible').first()).toBeVisible();

  await switcher(page).selectOption('jlpt');
  await expect(page).toHaveURL(/\/vi\/jlpt\/dashboard$/);
  const soon = page.getByTestId('program-coming-soon');
  await expect(soon).toBeVisible();
  await expect(soon).toHaveAttribute('data-program', 'jlpt');
  await expect(soon.getByRole('heading', { level: 1 })).toContainText('JLPT');
  await expect(switcher(page)).toHaveValue('jlpt');
  // Trang con khác của JLPT cũng "sắp ra mắt" (không 404)
  const sub = await page.goto('/vi/jlpt/test-sets');
  expect(sub?.status()).toBe(200);
  await expect(page.getByTestId('program-coming-soon')).toBeVisible();

  // Danh sách chờ: thiếu đồng ý → lỗi tại chỗ; đủ → ghi nhận
  const form = page.getByTestId('waitlist-form');
  await form.getByRole('textbox').fill(`e2e.c1.${Date.now()}@example.com`);
  await form.getByTestId('waitlist-submit').click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.getByTestId('waitlist-consent').check();
  await form.getByTestId('waitlist-submit').click();
  await expect(page.getByTestId('waitlist-accepted').or(page.getByTestId('waitlist-unavailable'))).toBeVisible();

  // Quay về TOEIC – giữ trang đang xem (test-sets)
  await page.getByTestId('coming-soon-back').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/test-sets$/);
  await expect(switcher(page)).toHaveValue('toeic');
  await expect(page.getByTestId('program-coming-soon')).toHaveCount(0);
});

test('mã chương trình sai → 404 thật; chương trình hợp lệ chưa có nội dung → 200', async ({ page }) => {
  for (const p of ['/vi/foo/dashboard', '/vi/ielts2/test-sets', '/en/xyz/practice']) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBe(404);
  }
  const ok = await page.goto('/vi/hsk/dashboard');
  expect(ok?.status()).toBe(200);
});

test('IELTS: cờ ra mắt tắt → "sắp ra mắt"; bật → khu học IELTS có đề mẫu, điều hướng theo /ielts', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile && REAL, 'Cờ toàn cục trên API thật – chạy một lần (desktop)');
  await startAsGuest(page);
  await setFlag(page, IELTS_FLAG, false);
  await page.goto('/vi/ielts/dashboard');
  await expect(page.getByTestId('program-coming-soon')).toHaveAttribute('data-program', 'ielts');

  await setFlag(page, IELTS_FLAG, true);
  await page.goto('/vi/toeic/dashboard');
  await switcher(page).selectOption('ielts');
  await expect(page).toHaveURL(/\/vi\/ielts\/dashboard$/);
  await expect(page.getByTestId('program-coming-soon')).toHaveCount(0);
  await page.locator('a[href="/vi/ielts/test-sets"]:visible').first().click();
  await expect(page).toHaveURL(/\/vi\/ielts\/test-sets$/);
  await expect(page.getByTestId('test-set-ielts-question-types-demo')).toBeVisible();
  // Đề TOEIC không lẫn vào danh sách IELTS
  await expect(page.locator('[data-testid^="test-set-toeic-"]')).toHaveCount(0);
  // Tải lại vẫn nhớ chương trình đang học (PATCH /me active_program)
  await page.goto('/vi/settings');
  await expect(switcher(page)).toHaveValue('ielts');
  await switcher(page).selectOption('toeic');
  await expect(switcher(page)).toHaveValue('toeic');
});
