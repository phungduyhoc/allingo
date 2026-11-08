import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';
import { ADMIN, apiCall, loginViaUi, logoutViaUi, registerNewUser } from './billing-helpers';
import { mockHook } from './s12-helpers';

/**
 * S12 – trang mới & hoàn thiện: văn bản pháp lý (/legal/* đọc phiên bản từ GET /legal/policies, nhãn "Bản nháp chờ luật sư duyệt",
 * /terms|/privacy chuyển hướng, chân trang), tuyên bố không liên kết ETS ở chân trang khu vực học, NPS in-app (mock: ép đến hạn) không
 * hiện khi Exam Mode, "Để sau" 24 giờ, gửi điểm + lý do; axe WCAG 2.1 AA 0 serious/critical trên các trang/hộp thoại S12; mobile
 * không tràn ngang.
 */

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };

async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`),
    `${label}: axe serious/critical`,
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: tràn ngang`).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('pháp lý: 4 văn bản có phiên bản + nhãn bản nháp chờ luật sư; /terms chuyển hướng; chân trang liên kết', async ({ page }) => {
  for (const [doc, title] of [
    ['terms', 'Điều khoản sử dụng'],
    ['privacy', 'Chính sách quyền riêng tư'],
    ['refund', 'Chính sách hoàn tiền'],
    ['voice-consent', 'Đồng ý xử lý dữ liệu giọng nói'],
  ] as const) {
    await page.goto(`/vi/legal/${doc}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByTestId('legal-draft-badge')).toHaveText('Bản nháp chờ luật sư duyệt');
    await expect(page.getByTestId('legal-version')).toContainText(/Phiên bản 2026-11/);
  }
  // API thật: trạng thái đọc từ GET /legal/policies (không phải phiên bản dự phòng)
  if (REAL) await expect(page.getByTestId('legal-page')).toHaveAttribute('data-status', 'draft_pending_legal_review');
  await page.goto('/vi/terms');
  await expect(page).toHaveURL(/\/vi\/legal\/terms$/);
  await page.goto('/en/legal/refund');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Refund Policy');
  await expect(page.getByTestId('legal-draft-badge')).toHaveText('Draft pending legal review');
  // Chân trang marketing
  await page.goto('/vi/toeic');
  await expect(page.getByTestId('ets-disclaimer')).toBeVisible();
  const footer = page.locator('footer');
  for (const href of ['/vi/legal/terms', '/vi/legal/privacy', '/vi/legal/refund', '/vi/legal/voice-consent']) await expect(footer.locator(`a[href="${href}"]`)).toBeVisible();
  await expectNoSeriousViolations(page, 'trang TOEIC');
  await page.goto('/vi/legal/privacy');
  await expectNoSeriousViolations(page, 'chính sách quyền riêng tư');
});

test('khu vực học: chân trang có tuyên bố không liên kết ETS + liên kết pháp lý/hỗ trợ; mobile không tràn', async ({ page }) => {
  await startAsGuest(page);
  await expect(page.getByTestId('app-ets-disclaimer')).toContainText('không liên kết với hoặc được ETS chứng thực');
  await expect(page.getByTestId('app-footer').locator('a[href="/vi/support"]')).toBeVisible();
  await expect(page.getByTestId('feedback-button')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'dashboard');
});

test('NPS ngày 7: không hiện khi đang thi; "Để sau" ẩn 24 giờ; gửi 0–10 + lý do → cảm ơn → không hiện lại', async ({ page, isMobile }) => {
  test.skip(REAL, 'Mốc ngày 7/14 do server tính từ ngày đổi mã – mock ép đến hạn');
  test.skip(isMobile, 'Một lần (desktop)');
  test.setTimeout(120_000);
  const email = await registerNewUser(page, 'nps');
  await mockHook(page, 'setNpsDue', email, 'nps_d7');
  await page.reload();
  const card = page.getByTestId('nps-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-kind', 'nps_d7');
  await expectNoSeriousViolations(page, 'dashboard + NPS');

  // Exam Mode: có bài thi exam đang làm → không làm phiền
  await startTestSet(page, PART5, 'exam');
  await page.goto('/vi/toeic/dashboard');
  await expect(page.getByTestId('kpi-streak')).toBeVisible();
  await expect(page.getByTestId('feedback-button')).toHaveCount(0);
  await expect(page.getByTestId('nps-card')).toHaveCount(0);
  const open = (await apiCall(page, 'GET', '/me/attempts?status=in_progress&mode=exam')).data as { data: Array<{ id: string }> };
  for (const a of open.data) await apiCall(page, 'POST', `/attempts/${a.id}/submit`, {});
  await page.reload();
  await expect(card).toBeVisible();

  // Để sau → ẩn, tải lại vẫn ẩn (24 giờ)
  await card.getByTestId('nps-later').click();
  await expect(page.getByTestId('nps-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('kpi-streak')).toBeVisible();
  await expect(page.getByTestId('nps-card')).toHaveCount(0);

  // Hết "Để sau" → chấm 9 + lý do → cảm ơn
  await page.evaluate(() => window.localStorage.removeItem('allingo.nps-snooze.v1'));
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card.getByTestId('nps-submit')).toBeDisabled();
  await card.getByTestId('nps-option-9').click();
  await expect(card.getByTestId('nps-score-9')).toBeChecked();
  await expect(card.getByText('Điều bạn thích nhất là gì?')).toBeVisible();
  await card.getByTestId('nps-comment').fill('Giải thích AI rất dễ hiểu');
  await card.getByTestId('nps-submit').click();
  await expect(page.getByTestId('nps-thanks')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('kpi-streak')).toBeVisible();
  await expect(page.getByTestId('nps-card')).toHaveCount(0);
});

test('a11y + mobile: /beta, onboarding beta, hỗ trợ + ticket, bảo mật, hộp thoại góp ý & báo lỗi câu', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  await page.goto('/vi/beta');
  await expect(page.getByTestId('beta-signin')).toBeVisible();
  await expectNoSeriousViolations(page, '/beta (khách)');
  await expectNoHorizontalOverflow(page, '/beta');

  await registerNewUser(page, 'a11y-s12');
  await page.goto('/vi/beta');
  await expect(page.getByTestId('beta-redeem').or(page.getByTestId('beta-has-access'))).toBeVisible();
  await expectNoSeriousViolations(page, '/beta (đăng nhập)');

  await page.goto('/vi/onboarding/beta');
  await expect(page.getByTestId('beta-survey-form')).toBeVisible();
  await page.getByTestId('beta-survey-submit').click();
  await expect(page.getByText('Chọn một mục tiêu.')).toBeVisible();
  await expectNoSeriousViolations(page, 'khảo sát beta (lỗi)');
  await expectNoHorizontalOverflow(page, 'khảo sát beta');

  await page.goto('/vi/support');
  await expect(page.getByTestId('support-new-form')).toBeVisible();
  await expectNoSeriousViolations(page, '/support');
  await expectNoHorizontalOverflow(page, '/support');
  await page.getByTestId('support-subject').fill('Kiểm tra a11y');
  await page.getByTestId('support-message').fill('Nội dung kiểm tra trợ năng');
  await page.getByTestId('support-submit').click();
  await expect(page.getByTestId('ticket-thread')).toBeVisible();
  await expectNoSeriousViolations(page, 'ticket');
  await expectNoHorizontalOverflow(page, 'ticket');

  await page.goto('/vi/settings/security');
  await expect(page.getByTestId('mfa-not-applicable')).toBeVisible();
  await expectNoSeriousViolations(page, '/settings/security');

  await page.getByTestId('feedback-button').click();
  await expect(page.getByTestId('feedback-dialog').getByTestId('feedback-message')).toBeVisible();
  await expectNoSeriousViolations(page, 'hộp thoại góp ý');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('feedback-dialog')).toHaveCount(0);

  if (!isMobile) {
    await startTestSet(page, PART5, 'practice');
    await page.getByTestId('question-card').getByTestId('option-A').click();
    await expect(page.getByTestId('practice-feedback')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('question-card').getByTestId('report-question').click();
    await expect(page.getByTestId('report-dialog').getByTestId('report-reason')).toBeVisible();
    await expectNoSeriousViolations(page, 'hộp thoại báo lỗi câu (practice)');
  }
});

test('a11y: các mục admin vận hành 0 vi phạm serious/critical; không tràn ngang trên mobile', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/vi');
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  for (const [path, ready] of [
    ['/vi/admin', 'admin-overview'],
    ['/vi/admin/beta', 'admin-ops'],
    ['/vi/admin/beta?tab=invites', 'beta-today-sent'],
    ['/vi/admin/beta?tab=report', 'beta-report'],
    ['/vi/admin/feedback', 'admin-ops'],
    ['/vi/admin/content?tab=reports', 'admin-ops'],
    ['/vi/admin/content?tab=stats', 'stats-computed-at'],
    ['/vi/admin/support', 'admin-ops'],
    ['/vi/admin/users', 'users-search'],
    ['/vi/admin/ai', 'admin-ops'],
    ['/vi/admin/system', 'system-status'],
    ['/vi/admin/system?tab=dead-letters', 'admin-ops'],
    ['/vi/admin/system?tab=flags', 'flags-list'],
    ['/vi/admin/audit', 'audit-filter'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
    // Bảng/biểu mẫu tải xong (không còn spinner)
    await expect(page.locator('main [aria-busy="true"], main .animate-spin')).toHaveCount(0, { timeout: 20_000 });
    await expectNoSeriousViolations(page, path);
    await expectNoHorizontalOverflow(page, path);
  }
});

test('trang S12: không thiếu thông điệp (MISSING_MESSAGE) và không vi phạm CSP – người học + admin', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần trên desktop');
  test.setTimeout(240_000);
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/MISSING_MESSAGE|Content Security Policy/i.test(m.text())) problems.push(`[${m.type()}] ${m.text().slice(0, 200)} @ ${page.url()}`);
  });
  page.on('pageerror', (e) => {
    if (/MISSING_MESSAGE|Content Security Policy/i.test(e.message)) problems.push(`[pageerror] ${e.message.slice(0, 200)}`);
  });
  const visit = async (paths: readonly string[]) => {
    for (const p of paths) {
      await page.goto(p);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForLoadState('networkidle');
    }
  };
  await visit(['/vi/beta', '/en/beta', '/vi/legal/terms', '/en/legal/voice-consent']);
  await registerNewUser(page, 'msg-s12');
  await visit(['/vi/support', '/vi/onboarding/beta', '/vi/settings/security', '/en/support', '/vi/beta']);
  await logoutViaUi(page);
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  await visit(['/vi/admin', '/vi/admin/beta', '/vi/admin/beta?tab=invites', '/vi/admin/beta?tab=report', '/vi/admin/feedback', '/vi/admin/content', '/vi/admin/content?tab=stats', '/vi/admin/support', '/vi/admin/users', '/vi/admin/ai', '/vi/admin/system', '/vi/admin/system?tab=flags', '/vi/admin/audit', '/en/admin/system', '/vi/admin/billing']);
  expect(problems).toEqual([]);
});
