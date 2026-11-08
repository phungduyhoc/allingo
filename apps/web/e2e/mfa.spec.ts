import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { ADMIN, currentUserId, loginViaUi, logoutViaUi, PASSWORD, registerNewUser } from './billing-helpers';
import { assertUuid, freshTotp, mockHook, setRoleViaApi } from './s12-helpers';

/**
 * S12 – MFA TOTP cho admin (RFC 6238 – mã tính trong test bằng node:crypto từ khoá base32 hiển thị trên trang):
 * bật (enroll → khoá + otpauth, không QR) → xác nhận bằng mã → 10 mã khôi phục hiện MỘT lần (tải .txt, phải tích "đã lưu") →
 * trạng thái đã bật + phiên đã xác minh → đăng nhập lại → xác minh phiên → tạo lại mã khôi phục (mã TOTP mới – chống replay).
 * Step-up (mock – dev API tắt ADMIN_MFA_REQUIRED): request admin 403 `mfa_required` → hộp thoại → mã đúng → request tự gửi lại.
 * API thật: tài khoản E2E mới được cấp vai trò admin TẠM qua API bằng superadmin của seed demo (B6/S151) rồi thu hồi qua API.
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function enrollAndConfirm(page: Page, used: Set<number>): Promise<string> {
  await page.goto('/vi/settings/security');
  const status = page.getByTestId('mfa-status');
  await expect(status).toHaveAttribute('data-enrolled', 'false');
  await page.getByTestId('mfa-enroll').click();
  const secretEl = page.getByTestId('mfa-secret');
  await expect(secretEl).toBeVisible();
  const secret = (await secretEl.getAttribute('data-secret'))!;
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  // Mã sai → lỗi tại chỗ
  await page.getByTestId('mfa-confirm-code').fill('000000');
  await page.getByTestId('mfa-confirm').click();
  await expect(page.getByText(/Mã không đúng/)).toBeVisible();
  await page.getByTestId('mfa-confirm-code').fill(await freshTotp(secret, used));
  await page.getByTestId('mfa-confirm').click();
  const codes = page.getByTestId('mfa-recovery-code');
  await expect(codes).toHaveCount(10);
  const download = page.waitForEvent('download');
  await page.getByTestId('mfa-download-codes').click();
  expect((await download).suggestedFilename()).toBe('allingo-recovery-codes.txt');
  await expect(page.getByTestId('mfa-codes-done')).toBeDisabled();
  await page.getByTestId('mfa-codes-saved').check();
  await page.getByTestId('mfa-codes-done').click();
  await expect(status).toHaveAttribute('data-enrolled', 'true');
  await expect(status).toHaveAttribute('data-verified', 'true');
  return secret;
}

test('MFA: bật TOTP → mã khôi phục một lần → đăng nhập lại → xác minh phiên → tạo lại mã khôi phục', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần (desktop)');
  test.setTimeout(240_000);
  const used = new Set<number>();
  let email = ADMIN.email;
  let password = ADMIN.password;
  let userId: string | null = null;
  if (REAL) {
    email = await registerNewUser(page, 'mfa-admin');
    password = PASSWORD;
    userId = assertUuid(await currentUserId(page));
    expect(await setRoleViaApi(userId, 'admin', 'grant')).toContain('admin');
    await logoutViaUi(page);
  }
  try {
    await loginViaUi(page, email, password);
    // Người học thường không bật được (chỉ admin) – ở đây đã là admin
    const secret = await enrollAndConfirm(page, used);

    // Phiên mới chưa xác minh → nhập mã → đã xác minh
    await logoutViaUi(page);
    await loginViaUi(page, email, password);
    await page.goto('/vi/settings/security');
    await expect(page.getByTestId('mfa-status')).toHaveAttribute('data-verified', 'false');
    await page.getByTestId('mfa-verify-code').fill(await freshTotp(secret, used));
    await page.getByTestId('mfa-verify').click();
    await expect(page.getByTestId('mfa-status')).toHaveAttribute('data-verified', 'true');

    // Tạo lại mã khôi phục (mã TOTP của bước mới)
    await page.getByTestId('mfa-regen-code').fill(await freshTotp(secret, used));
    await page.getByTestId('mfa-regen').click();
    await expect(page.getByTestId('mfa-recovery-code')).toHaveCount(10);
    await page.getByTestId('mfa-codes-saved').check();
    await page.getByTestId('mfa-codes-done').click();
    await expect(page.getByTestId('mfa-status')).toHaveAttribute('data-enrolled', 'true');
  } finally {
    if (REAL && userId) {
      // Dọn: thu hồi vai trò admin tạm qua API (tài khoản E2E dùng một lần – factor TOTP còn lại vô hại khi không còn vai trò admin)
      expect(await setRoleViaApi(userId, 'admin', 'revoke')).not.toContain('admin');
    }
  }
});

test('người học: trang bảo mật không cho bật MFA (chỉ admin)', async ({ page }) => {
  await registerNewUser(page, 'mfa-learner');
  await page.goto('/vi/settings/security');
  await expect(page.getByTestId('mfa-not-applicable')).toBeVisible();
  await expect(page.getByTestId('mfa-enroll')).toHaveCount(0);
});

test('step-up: admin API 403 mfa_required → hộp thoại → mã đúng → request gửi lại; huỷ → lỗi i18n + lối vào bảo mật', async ({ page, isMobile }) => {
  test.skip(REAL, 'Dev API: ADMIN_MFA_REQUIRED=auto tắt ở development – kiểm qua mock (API có test riêng)');
  test.skip(isMobile, 'Một lần (desktop)');
  test.setTimeout(180_000);
  const used = new Set<number>();
  await page.goto('/vi');
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  const secret = await enrollAndConfirm(page, used);
  await mockHook(page, 'setAdminMfaRequired', true);

  // Huỷ → 403 giữ nguyên → ErrorState mfa_required + nút tới Bảo mật
  await page.goto('/vi/admin/system');
  const dlg = page.getByTestId('mfa-step-up');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Huỷ' }).last().click();
  await expect(page.getByText('Thao tác quản trị cần xác minh hai lớp')).toBeVisible();
  await expect(page.getByTestId('error-mfa-cta')).toHaveAttribute('href', /\/vi\/settings\/security/);

  // Mã sai → lỗi trong hộp thoại; mã đúng → request gốc được gửi lại tự động → trang có dữ liệu
  await page.reload();
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('mfa-step-up-code').fill('123456');
  await dlg.getByTestId('mfa-step-up-submit').click();
  await expect(dlg.getByTestId('mfa-step-up-error')).toBeVisible();
  await dlg.getByTestId('mfa-step-up-code').fill(await freshTotp(secret, used));
  await dlg.getByTestId('mfa-step-up-submit').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId('system-status')).toBeVisible();
  // Đã step-up trong phiên → thao tác ghi tiếp theo không hỏi lại
  await page.getByTestId('system-tab-flags').click();
  await expect(page.getByTestId('flags-list')).toBeVisible();
  await expect(dlg).toHaveCount(0);
  await mockHook(page, 'setAdminMfaRequired', false);
});
