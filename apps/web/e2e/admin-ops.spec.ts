import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { ADMIN, currentUserId, loginViaUi, logoutViaUi, PASSWORD, registerNewUser } from './billing-helpers';
import { loginBack, mockHook } from './s12-helpers';

/**
 * S12 – admin vận hành (/admin): người dùng (tìm – PII che, khoá → mọi phiên bị thu hồi ngay, mở khoá, impersonate CHỈ ĐỌC có
 * banner + thoát, nhật ký audit lọc theo người dùng), hệ thống (trạng thái, DLQ + replay có xác nhận khi có dữ liệu, cờ – xác nhận
 * rồi huỷ), nội dung (thống kê câu + tính lại), AI, báo cáo beta. Học viên không vào được (client chặn, server 403).
 * API thật: người học và admin ở hai context trình duyệt (phiên độc lập – kiểm chứng thu hồi phiên); mock: đổi tài khoản trên trang.
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function openUser(admin: Page, email: string): Promise<void> {
  await admin.goto('/vi/admin/users');
  const search = admin.getByTestId('users-search');
  await search.getByTestId('filter-q').fill(email);
  await search.getByTestId('filter-apply').click();
  const row = admin.getByTestId('admin-user-row').first();
  await expect(row).toBeVisible();
  // PII che: email không hiện nguyên văn
  await expect(row).not.toContainText(email);
  await row.getByTestId('admin-user-open').click();
  await expect(admin.getByTestId('admin-user-detail')).toBeVisible();
}

test('khoá tài khoản → phiên bị thu hồi + không đăng nhập được; mở khoá; impersonate chỉ đọc; audit', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'Một lần (desktop)');
  test.setTimeout(240_000);
  const email = await registerNewUser(page, 'lock');
  const userId = await currentUserId(page);
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);
  await page.goto('/vi/admin/users');
  await expect(page.getByTestId('admin-forbidden')).toBeVisible();

  // Admin: API thật → context riêng (phiên người học vẫn mở); mock → đổi tài khoản trên trang
  let admin: Page;
  let closeAdmin = async () => undefined as unknown;
  if (REAL) {
    const ctx = await browser.newContext({ locale: 'vi-VN' });
    admin = await ctx.newPage();
    closeAdmin = () => ctx.close();
    await loginViaUi(admin, ADMIN.email, ADMIN.password);
  } else {
    await logoutViaUi(page);
    await loginViaUi(page, ADMIN.email, ADMIN.password);
    admin = page;
  }
  try {
    await openUser(admin, email);
    const detail = admin.getByTestId('admin-user-detail');
    await expect(detail).toHaveAttribute('data-status', 'active');

    // Impersonate CHỈ ĐỌC: lý do bắt buộc → banner + đếm ngược → dữ liệu (email che) → thoát
    await detail.getByTestId('admin-user-impersonate').click();
    const impDlg = admin.getByTestId('admin-user-impersonate-confirm');
    await expect(impDlg.getByTestId('admin-user-impersonate-confirm-confirm')).toBeDisabled();
    await impDlg.getByTestId('admin-user-impersonate-confirm-reason').fill('Điều tra ticket (E2E)');
    await impDlg.getByTestId('admin-user-impersonate-confirm-confirm').click();
    const banner = admin.getByTestId('impersonation-banner');
    await expect(banner).toContainText('CHỈ ĐỌC');
    await expect(banner).toContainText(/còn \d+:\d{2}/);
    const view = admin.getByTestId('impersonation-view');
    await expect(view.locator('pre')).toContainText(userId);
    await expect(view.locator('pre')).not.toContainText(email);
    await admin.getByTestId('imp-view-tickets').click();
    await expect(view.locator('pre')).toContainText('data');
    await admin.getByTestId('impersonation-exit').click();
    await expect(admin.getByTestId('impersonation-view')).toHaveCount(0);
    await expect(detail).toBeVisible();

    // Khoá: lý do + xác nhận
    await detail.getByTestId('admin-user-lock').click();
    const lockDlg = admin.getByTestId('admin-user-lock-confirm');
    await lockDlg.getByTestId('admin-user-lock-confirm-reason').fill('Vi phạm điều khoản (E2E)');
    await lockDlg.getByTestId('admin-user-lock-confirm-confirm').click();
    await expect(admin.getByText(/Đã khoá tài khoản – thu hồi \d+ phiên/)).toBeVisible();
    await expect(detail).toHaveAttribute('data-status', 'suspended');

    if (REAL) {
      // Phiên của người học bị thu hồi NGAY: tải lại → GET /me 401 (refresh cũng bị từ chối) → về trang chủ
      const t0 = Date.now();
      await page.reload();
      await expect(page).toHaveURL(/\/vi\/?$/, { timeout: 60_000 });
      expect(Date.now() - t0).toBeLessThan(60_000);
      const relog = await page.request.post(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1'}/auth/login`, { data: { email, password: PASSWORD }, headers: { Origin: 'http://localhost:3000' } });
      expect(relog.status()).toBe(401);
    }

    // Mở khoá
    await detail.getByTestId('admin-user-unlock').click();
    await admin.getByTestId('admin-user-unlock-confirm-confirm').click();
    await expect(admin.getByText('Đã mở khoá tài khoản')).toBeVisible();
    await expect(detail).toHaveAttribute('data-status', 'active');

    // Nhật ký audit lọc theo người dùng: có user.locked + user.unlocked + impersonation
    await admin.goto(`/vi/admin/audit?entity=${userId}`);
    await expect(admin.locator('[data-testid="audit-row"][data-action="user.locked"]').first()).toBeVisible();
    await expect(admin.locator('[data-testid="audit-row"][data-action="user.unlocked"]').first()).toBeVisible();
    await expect(admin.locator('[data-testid="audit-row"][data-action^="impersonation."], [data-testid="audit-row"][data-action="user.impersonation_started"]').first()).toBeVisible();
    // Tìm theo tiền tố hành động
    await admin.getByTestId('audit-filter').getByTestId('filter-action').fill('user.');
    await admin.getByTestId('audit-filter').getByTestId('filter-apply').click();
    await expect(admin.locator('[data-testid="audit-row"]').first()).toHaveAttribute('data-action', /^user\./);
  } finally {
    if (REAL) await closeAdmin();
    else await logoutViaUi(page).catch(() => undefined);
  }
  // Đăng nhập lại được sau khi mở khoá
  await loginBack(page, email);
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/);
});

test('hệ thống: trạng thái, DLQ (+ replay khi có), cờ (xác nhận → huỷ), thống kê câu + tính lại, AI, báo cáo beta, tổng quan', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần (desktop)');
  test.setTimeout(180_000);
  await page.goto('/vi');
  if (!REAL) await mockHook(page, 'addDeadLetter', 'beta.invites_send', 'notify');
  await loginViaUi(page, ADMIN.email, ADMIN.password);

  await page.getByTestId('nav-admin').click();
  await expect(page.getByTestId('admin-overview')).toBeVisible();
  await expect(page.getByTestId('overview-dlq')).toBeVisible();

  await page.getByTestId('admin-nav-system').click();
  await expect(page.getByTestId('system-status')).toBeVisible();
  await expect(page.getByTestId('system-redis')).toContainText('Hoạt động');
  await expect(page.getByTestId('queue-row').first()).toBeVisible();

  // DLQ: danh sách (lọc chưa replay) → replay có xác nhận nếu có dữ liệu
  await page.getByTestId('system-tab-dead-letters').click();
  await expect(page).toHaveURL(/tab=dead-letters/);
  const rows = page.getByTestId('dlq-row');
  await expect(rows.first().or(page.getByText('Không có job dead-letter.'))).toBeVisible();
  if ((await rows.count()) > 0) {
    await rows.first().getByTestId('dlq-replay').click();
    await expect(page.getByTestId('dlq-replay-confirm')).toContainText('Replay job này?');
    await page.getByTestId('dlq-replay-confirm-confirm').click();
    // Toast kết quả (tránh khớp <option> "Đã replay" của bộ lọc)
    await expect(page.getByText(/Đã replay \(|Replay lỗi:|không có trình xử lý/).first()).toBeVisible({ timeout: 30_000 });
  }

  // Cờ: bật/tắt luôn qua hộp xác nhận – huỷ thì không đổi
  await page.getByTestId('system-tab-flags').click();
  const gate = page.locator('[data-testid="flag-row"][data-key="ff.growth.beta_gate"]');
  await expect(gate).toBeVisible();
  const before = await gate.getAttribute('data-enabled');
  await gate.getByTestId('flag-switch-ff.growth.beta_gate').click();
  await expect(page.getByTestId('flag-confirm')).toBeVisible();
  await page.getByTestId('flag-confirm').getByRole('button', { name: 'Huỷ' }).first().click();
  await expect(gate).toHaveAttribute('data-enabled', before ?? 'false');

  // Nội dung: thống kê câu + đề xuất, tính lại (xác nhận)
  await page.getByTestId('admin-nav-content').click();
  await page.getByTestId('content-tab-stats').click();
  await expect(page.getByTestId('question-stat-row').first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stats-recompute').click();
  await page.getByTestId('stats-recompute-confirm-confirm').click();
  await expect(page.getByText('Đã chạy tính lại thống kê')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('filter-recommendation').selectOption('retire');
  await page.getByTestId('filter-apply').click();
  const retire = page.getByTestId('question-stat-row');
  await expect(retire.first().or(page.getByText('Không có dữ liệu.'))).toBeVisible();
  for (const r of await retire.all()) await expect(r).toHaveAttribute('data-recommendation', 'retire');

  // AI + báo cáo beta
  await page.getByTestId('admin-nav-ai').click();
  await expect(page.getByTestId('ai-quality-row').first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('admin-nav-beta').click();
  await page.getByTestId('beta-tab-report').click();
  await expect(page.getByTestId('beta-report')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('beta-report')).toContainText(/Báo cáo beta kín/);
});
