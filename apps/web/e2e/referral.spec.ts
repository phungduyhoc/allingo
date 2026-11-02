import { expect, test } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { loginViaUi, logoutViaUi, registerViaUi, uniqueEmail } from './billing-helpers';

/**
 * Sprint 8 – referral: A mở /referral (mã, link UTM, sao chép, chia sẻ) → B mở link (API thật: /v1/r/{code} có OG rồi chuyển
 * tới /register?ref=; mock: /r/{code} của web) → banner lời mời + đăng ký gửi `referral_code` (+ X-Device-Fingerprint) →
 * A thấy "Đã đăng ký" = 1 và B trong danh sách gần đây (tên đã che).
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('A lấy link → B đăng ký qua /register?ref= → thống kê joined của A', async ({ page, context }) => {
  const emailA = uniqueEmail('ref-a');
  await registerViaUi(page, { email: emailA, name: 'Người giới thiệu' });
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/, { timeout: 20_000 });

  await page.goto('/vi/referral');
  await expect(page.getByTestId('referral-page')).toBeVisible();
  const code = (await page.getByTestId('referral-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6,12}$/);
  const link = await page.getByTestId('referral-link').inputValue();
  expect(link).toContain(code);
  expect(link).toContain('utm_source=referral');
  await expect(page.getByTestId('referral-stats')).toHaveAttribute('data-joined', '0');
  await expect(page.getByTestId('share-facebook')).toHaveAttribute('href', /facebook\.com\/sharer/);

  // Sao chép link (quyền clipboard của Chromium)
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await page.getByTestId('referral-copy-link').click();
  await expect(page.getByText('Đã sao chép link giới thiệu.')).toBeVisible();

  await logoutViaUi(page);

  // B mở link chia sẻ → trang đăng ký có ref + UTM
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/vi/register\\?.*ref=${code}`), { timeout: 20_000 });
  expect(page.url()).toContain('utm_source=referral');
  await expect(page.getByTestId('referral-banner')).toHaveAttribute('data-code', code);
  await expect(page.getByTestId('referral-banner')).toHaveAttribute('data-valid', 'true');
  await registerViaUi(page, { email: uniqueEmail('ref-b'), name: 'Bạn Được Mời', path: page.url() });
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/, { timeout: 20_000 });
  // Mã đã dùng → xoá khỏi localStorage
  expect(await page.evaluate(() => window.localStorage.getItem('allingo.referral'))).toBeNull();
  if (!REAL) {
    // Mock: header X-Device-Fingerprint đi kèm đăng ký → lưu ở lượt giới thiệu
    const fp = await page.evaluate(() => {
      const s = JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as { referrals?: Record<string, { device_fp: string | null }> };
      return Object.values(s.referrals ?? {})[0]?.device_fp ?? null;
    });
    expect(fp).toMatch(/^fp[01]\./);
  }
  await logoutViaUi(page);

  await loginViaUi(page, emailA);
  await expect(async () => {
    await page.goto('/vi/referral');
    await expect(page.getByTestId('referral-stats')).toHaveAttribute('data-joined', '1', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('referral-joined')).toHaveText('1');
  const item = page.getByTestId('referral-item').first();
  await expect(item).toHaveAttribute('data-status', 'joined');
  await expect(item).toContainText('***');
});

test('link có mã không tồn tại → cảnh báo nhưng vẫn đăng ký được', async ({ page }) => {
  await page.goto('/vi/register?ref=ZZZZ9999&utm_source=referral');
  await expect(page.getByTestId('referral-banner')).toHaveAttribute('data-valid', 'false');
  await expect(page.getByTestId('signup-form')).toBeVisible();
});
