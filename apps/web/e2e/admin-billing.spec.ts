import { expect, test } from '@playwright/test';
import { freshGuestStorage } from './helpers';
import { ADMIN, currentUserId, loginViaUi, logoutViaUi, openCheckout, payAtMockGateway, registerNewUser, submitCheckout } from './billing-helpers';

/**
 * Sprint 8 – billing admin: học viên mua gói → admin (admin@allingo.dev) cấp 100 credit kèm lý do bắt buộc → sổ credit có
 * `admin_adjust`; hoàn tiền đơn (lý do, thu hồi credit) → đơn refunded; học viên không vào được /admin/billing.
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('admin cấp 100 credit (ghi chú bắt buộc) → ledger admin_adjust; hoàn tiền đơn', async ({ page }) => {
  test.setTimeout(120_000);
  const email = await registerNewUser(page, 'adm-learner');
  // Học viên: không có menu admin, route bị chặn phía client
  await expect(page.getByTestId('nav-admin-billing')).toHaveCount(0);
  await page.goto('/vi/admin/billing');
  await expect(page.getByTestId('admin-forbidden')).toBeVisible();

  await openCheckout(page, 'toeic_pro_monthly');
  await submitCheckout(page);
  await payAtMockGateway(page, 'paid');
  await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', 'paid', { timeout: 20_000 });
  const userId = await currentUserId(page);
  await logoutViaUi(page);

  await loginViaUi(page, ADMIN.email, ADMIN.password);
  await page.goto('/vi/admin/billing');
  await expect(page.getByTestId('admin-billing')).toBeVisible();
  await expect(page.getByTestId('admin-summary')).toBeVisible();

  // Cấp credit: thiếu ghi chú → lỗi; có ghi chú → ledger admin_adjust +100
  await page.getByTestId('admin-tab-credits').click();
  await expect(page).toHaveURL(/\/vi\/admin\/billing\/credits/);
  await page.getByTestId('credit-user').fill(userId);
  await page.getByTestId('credit-delta').fill('100');
  await page.getByTestId('credit-submit').click();
  await expect(page.getByTestId('credit-note-error')).toBeVisible();
  await page.getByTestId('credit-note').fill('Bồi thường lỗi chấm bài (E2E)');
  await page.getByTestId('credit-submit').click();
  await expect(page.getByTestId('credit-result')).toBeVisible();
  const row = page.getByTestId('admin-ledger').locator('[data-testid="ledger-row"][data-reason="admin_adjust"]').first();
  await expect(row).toHaveAttribute('data-delta', '100');
  await expect(row).toContainText('Bồi thường lỗi chấm bài (E2E)');

  // Hoàn tiền đơn của học viên
  await page.getByTestId('admin-tab-orders').click();
  await page.getByTestId('orders-filter').getByTestId('filter-user_id').fill(userId);
  await page.getByTestId('orders-filter').getByTestId('filter-apply').click();
  const orderRow = page.locator(`[data-testid="admin-order-row"][data-user="${userId}"]`).first();
  await expect(orderRow).toHaveAttribute('data-status', 'paid');
  await orderRow.getByTestId('order-refund').click();
  await page.getByTestId('refund-reason').fill('Khách yêu cầu – E2E');
  await page.getByTestId('refund-confirm').click();
  await expect(page.locator(`[data-testid="admin-order-row"][data-user="${userId}"]`).first()).toHaveAttribute('data-status', 'refunded', { timeout: 15_000 });

  // Học viên thấy sổ credit: admin_adjust +100 và thu hồi khi hoàn tiền
  await logoutViaUi(page);
  await loginViaUi(page, email);
  await page.goto('/vi/account/billing?tab=credits');
  await expect(page.locator('[data-testid="ledger-row"][data-reason="admin_adjust"][data-delta="100"]')).toBeVisible();
  await expect(page.locator('[data-testid="ledger-row"][data-reason="refund"]').first()).toBeVisible();
});
