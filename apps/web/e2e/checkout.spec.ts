import { expect, test } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { adminApi, backdatePayments, openCheckout, orderIdFromUrl, payAtMockGateway, registerNewUser, submitCheckout } from './billing-helpers';

/**
 * Sprint 7/8 – mua gói: đăng ký → /pricing (mã WELCOME20 xem trước giá) → checkout (mã đã áp, thông tin hoá đơn doanh nghiệp
 * với MST kiểm tra như server) → cổng giả `paid` → trang kết quả (polling/Socket.IO) `paid` → quyền Pro + sổ credit + hoá đơn;
 * `failed` → "Thử thanh toán lại" → `paid`; `paid-drop` (mất webhook) → admin chạy `payment.reconcile` → `paid`.
 * Cổng: API thật = trang /v1/payments/mock/checkout (PAYMENT_PROVIDERS=mock); mock = /[locale]/mock-gateway (cùng data-outcome).
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('WELCOME20 → checkout doanh nghiệp → cổng paid → kết quả paid → Pro + ledger + hoá đơn', async ({ page }) => {
  await registerNewUser(page, 'buy');

  // Bảng giá: quyền lợi từ FEATURE_GATES, mã xem trước giá (server tính)
  await openCheckout(page, 'toeic_pro_monthly', { promo: 'WELCOME20' });
  await expect(page.getByTestId('checkout-promo-applied')).toContainText('WELCOME20');
  await expect(page.getByTestId('summary-total')).toHaveAttribute('data-total', '159200');

  // Hoá đơn doanh nghiệp: MST sai chữ số kiểm tra bị chặn ở client như server
  await page.getByTestId('buyer-type-business').click();
  await page.getByTestId('buyer-company').fill('Công ty TNHH Allingo E2E');
  await page.getByTestId('buyer-tax-code').fill('0123456789');
  await page.getByTestId('buyer-address').fill('1 Tràng Tiền, Hoàn Kiếm, Hà Nội');
  await page.getByTestId('checkout-terms').check();
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('buyer-tax-code-error')).toContainText('Mã số thuế không hợp lệ');
  await page.getByTestId('buyer-tax-code').fill('0100109106');
  await submitCheckout(page);

  await payAtMockGateway(page, 'paid');
  const result = page.getByTestId('checkout-result');
  await expect(result).toHaveAttribute('data-status', 'paid', { timeout: 20_000 });
  await expect(page.getByTestId('result-title')).toHaveText('Thanh toán thành công');
  await expect(page.getByTestId('result-total')).toHaveAttribute('data-total', '159200');
  await expect(page.getByTestId('result-entitlement')).toHaveAttribute('data-pro', 'true', { timeout: 15_000 });

  // Tài khoản → Thanh toán: gói hiện tại + sổ credit (subscription_grant +5000)
  await page.goto('/vi/account/billing');
  await expect(page.getByTestId('current-plan')).toHaveAttribute('data-plan', 'toeic_pro_monthly');
  await page.getByTestId('billing-tab-credits').click();
  await expect(page.locator('[data-testid="ledger-row"][data-reason="subscription_grant"][data-delta="5000"]')).toBeVisible();

  // Đơn + hoá đơn điện tử (số, mã tra cứu) – phát hành ngay sau order.paid (job inline / mock)
  await page.getByTestId('billing-tab-orders').click();
  await page.getByTestId('order-row').first().click();
  await expect(page.getByTestId('order-detail')).toHaveAttribute('data-status', 'paid');
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('invoice-card')).toHaveAttribute('data-invoice-status', 'issued', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('invoice-number')).toHaveText(/^\d{8}$/);
  await expect(page.getByTestId('invoice-lookup')).not.toBeEmpty();
});

test('cổng báo failed → kết quả failed → Thử thanh toán lại → paid (gói credit)', async ({ page }) => {
  await registerNewUser(page, 'retry');
  await openCheckout(page, 'credits_1000');
  await submitCheckout(page);
  await payAtMockGateway(page, 'failed');
  await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', 'failed', { timeout: 20_000 });
  await expect(page.getByTestId('result-title')).toHaveText('Thanh toán không thành công');

  await page.getByTestId('result-retry').click();
  await payAtMockGateway(page, 'paid');
  await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', 'paid', { timeout: 20_000 });
  await expect(page.getByTestId('result-entitlement')).toContainText(/1[.,]?000 credit/);

  await page.goto('/vi/account/billing?tab=credits');
  await expect(page.locator('[data-testid="ledger-row"][data-reason="purchase"][data-delta="1000"]')).toBeVisible();
});

test('mất webhook (paid-drop) → kết quả chờ xác nhận → admin chạy payment.reconcile → paid', async ({ page }) => {
  await registerNewUser(page, 'drop');
  await openCheckout(page, 'toeic_pro_monthly');
  await submitCheckout(page);
  await payAtMockGateway(page, 'paid-drop');
  const result = page.getByTestId('checkout-result');
  await expect(result).toHaveAttribute('data-status', 'pending', { timeout: 20_000 });
  await expect(page.getByTestId('result-title')).toHaveText('Đang xác nhận thanh toán…');
  const orderId = orderIdFromUrl(page);

  if (REAL) {
    backdatePayments(orderId);
    const admin = await adminApi();
    const res = await admin.post('admin/billing/jobs/payment.reconcile');
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { result: { paid: number } }).result.paid).toBeGreaterThanOrEqual(1);
    await admin.dispose();
  } else {
    await page.evaluate(() => (window as unknown as { __ALLINGO_MOCK__: { runJob: (j: string) => unknown } }).__ALLINGO_MOCK__.runJob('payment.reconcile'));
  }
  // Trang kết quả tự cập nhật (Socket.IO order.updated hoặc polling) – không tải lại
  await expect(result).toHaveAttribute('data-status', 'paid', { timeout: 30_000 });
  await expect(page.getByTestId('result-entitlement')).toHaveAttribute('data-pro', 'true', { timeout: 15_000 });
});
