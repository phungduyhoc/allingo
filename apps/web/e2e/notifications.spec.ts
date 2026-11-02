import { expect, test } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { apiCall, currentUserId, manageToken, registerNewUser } from './billing-helpers';

/**
 * Sprint 8 – thông báo: chuông trong header có số chưa đọc cập nhật realtime (Socket.IO `notification.new`; mock: sự kiện window),
 * nội dung dịch theo template_code, "Đánh dấu đã đọc tất cả"; trang /notifications/manage?token= (không cần đăng nhập) huỷ
 * nhận email một loại; cài đặt thông báo theo loại × kênh.
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('chuông: thông báo mới realtime → đọc tất cả → tải lại vẫn đã đọc', async ({ page }) => {
  await registerNewUser(page, 'bell');
  const bell = page.getByTestId('notification-bell');
  await expect(bell).toHaveAttribute('data-unread', '0');

  // Kích hoạt dùng thử Pro 7 ngày qua API → server tạo thông báo billing.trial_started → đẩy realtime tới trang đang mở
  const r = await apiCall(page, 'POST', '/promotions/redeem', { code: 'PRO7DAY', program: 'toeic' });
  expect(r.status).toBe(200);
  await expect(bell).toHaveAttribute('data-unread', '1', { timeout: 15_000 });
  await expect(page.getByTestId('notification-badge')).toHaveText('1');

  await bell.click();
  const panel = page.getByTestId('notification-panel');
  await expect(panel).toBeVisible();
  const row = panel.locator('[data-testid="notification-item"][data-template="billing.trial_started"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Đã kích hoạt dùng thử Pro');
  await expect(row).toHaveAttribute('data-unread', 'true');

  await page.getByTestId('notifications-read-all').click();
  await expect(bell).toHaveAttribute('data-unread', '0');
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  await expect(row).toHaveAttribute('data-unread', 'false');

  await page.reload();
  await expect(page.getByTestId('notification-bell')).toHaveAttribute('data-unread', '0');
  // Trang đầy đủ + banner dùng thử trong AppShell
  await page.goto('/vi/notifications');
  await expect(page.locator('[data-testid="notification-item"][data-template="billing.trial_started"]')).toHaveAttribute('data-unread', 'false');
  await expect(page.getByTestId('subscription-banner')).toHaveAttribute('data-kind', 'trialing');
});

test('trang quản lý qua link email (token, không cần đăng nhập) huỷ email học tập → cài đặt phản ánh', async ({ page }) => {
  await registerNewUser(page, 'manage');
  const userId = await currentUserId(page);
  const token = manageToken(userId, 'learning');
  test.skip(!token, 'Thiếu khoá ký token (NOTIFY_UNSUBSCRIBE_SECRET/AUTH_SECRET) cho API thật');

  await page.goto('/vi/notifications/manage?token=bad-token-value-xxxxxxxxxxxx');
  await expect(page.getByTestId('manage-invalid')).toBeVisible();

  await page.goto(`/vi/notifications/manage?token=${encodeURIComponent(token!)}&unsubscribe=learning`);
  await expect(page.getByTestId('manage-page')).toBeVisible();
  await expect(page.getByTestId('manage-unsubscribe-card')).toBeVisible();
  // Mở trang không đổi gì – phải bấm
  await expect(page.getByTestId('cat-learning-email')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('manage-unsubscribe').click();
  await expect(page.getByTestId('manage-unsubscribed')).toBeVisible();
  await expect(page.getByTestId('cat-learning-email')).toHaveAttribute('aria-checked', 'false');

  // Cài đặt thông báo (đã đăng nhập): ma trận loại × kênh khớp server, đổi được
  await page.goto('/vi/settings/notifications');
  await expect(page.getByTestId('cat-learning-email')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('cat-billing-email')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('cat-marketing-inapp').click();
  await page.getByTestId('prefs-save').click();
  await expect(page.getByText('Đã lưu cài đặt thông báo.')).toBeVisible();
  const prefs = await apiCall(page, 'GET', '/me/notification-preferences');
  expect((prefs.data as { categories: { marketing: { inapp: boolean }; learning: { email: boolean } } }).categories).toMatchObject({ marketing: { inapp: false }, learning: { email: false } });
  if (REAL) expect(prefs.status).toBe(200);
});
