import { expect, test } from '@playwright/test';

/**
 * Sprint 1 – xác thực: đăng nhập bằng mã email (OTP), trang điều khoản/chính sách.
 * Mock và API dev đều dùng mã cố định 123456 (mock: hằng số; API: OTP_DEV_FIXED_CODE trong .env dev).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e.cleared')) return;
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('allingo.')) window.localStorage.removeItem(k);
    window.sessionStorage.setItem('e2e.cleared', '1');
  });
});

test('đăng nhập bằng mã email: sai mã báo lỗi, đúng mã vào dashboard', async ({ page }) => {
  const email = `otp-${Date.now()}@allingo.test`;
  await page.goto('/vi/login');
  await page.getByTestId('toggle-otp').click();
  await page.getByLabel('Email nhận mã').fill(email);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByTestId('otp-info')).toContainText(email);
  await page.getByTestId('otp-code').fill('000000');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByTestId('otp-error')).toContainText('Mã không đúng');
  await page.getByTestId('otp-code').fill('123456');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByTestId('guest-banner')).toHaveCount(0);
});

test('trang điều khoản và chính sách hiển thị bản dự thảo', async ({ page }) => {
  await page.goto('/vi/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Điều khoản sử dụng');
  await expect(page.getByText(/Bản dự thảo/)).toBeVisible();
  // S12: /terms, /privacy chuyển hướng vĩnh viễn sang /legal/* (tiêu đề theo GET /legal/policies)
  await page.goto('/vi/privacy');
  await expect(page).toHaveURL(/\/vi\/legal\/privacy$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chính sách quyền riêng tư');
  await expect(page.getByText(/Nghị định 13\/2023/)).toBeVisible();
});
