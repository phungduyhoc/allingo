import { expect, test, type Page } from '@playwright/test';
import { answerCurrent, freshGuestStorage, REAL, startTestSet } from './helpers';
import { registerViaUi, uniqueEmail } from './billing-helpers';
import { asAdmin, getFlagReal, INVITE_RE, mockHook, putFlagReal, setFlag, startSmtpSink, TINY_PNG, type FlagState, type SmtpSink } from './s12-helpers';

/**
 * S12 – luồng tester beta kín (tiêu chí nghiệm thu "từ email mời → onboarding → thi → góp ý"):
 * admin mời theo email (UI /admin/beta) → gửi ngay → bật `ff.growth.beta_gate` → người dùng mới đăng ký bị chặn (403 beta_required
 * → /beta) → mã sai báo lỗi i18n → mã đúng (đọc từ email: API thật – SMTP sink cục bộ; mock – hộp thư giả) → quyền lợi theo phản
 * hồi API → khảo sát 5 câu → hướng dẫn 60 giây (bỏ qua) → làm đề mini → báo lỗi câu ở Xem lại → góp ý có ảnh (+ trace_id) → mở
 * ticket → admin trả lời (+ credit bù) → người dùng thấy thông báo `support.reply` và trả lời trong luồng ticket.
 * Cờ beta gate là toàn cục – luôn khôi phục trong `finally` (API thật giữ nguyên `rules`).
 */

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };
const GATE = 'ff.growth.beta_gate';

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function inviteViaAdminUi(admin: Page, email: string): Promise<void> {
  await admin.goto('/vi/admin/beta?tab=waitlist');
  await expect(admin.getByTestId('admin-ops')).toHaveAttribute('data-section', 'beta');
  await admin.getByTestId('beta-emails').fill(email);
  await admin.getByTestId('beta-queue-emails').click();
  await admin.getByTestId('beta-email-confirm-confirm').click();
  await expect(admin.getByText(/Đã xếp hàng 1 lời mời/)).toBeVisible();
  await admin.getByTestId('beta-tab-invites').click();
  await expect(admin).toHaveURL(/tab=invites/);
  await admin.getByTestId('beta-send-now').click();
  await admin.locator('#beta-send-limit').fill('500');
  await admin.getByTestId('beta-send-confirm-confirm').click();
  await expect(admin.getByTestId('beta-send-result')).toBeVisible({ timeout: 30_000 });
}

test('tester: mời → gate chặn → nhập mã → khảo sát → đề mini → báo lỗi câu → góp ý có ảnh → ticket → admin trả lời → thông báo', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'Cờ toàn cục – chạy một lần (desktop)');
  test.setTimeout(300_000);
  const email = uniqueEmail('beta-tester');
  let sink: SmtpSink | null = null;
  let prev: FlagState | null = null;
  try {
    if (REAL) {
      sink = await startSmtpSink();
      prev = await getFlagReal(GATE);
      // Hạn mức gửi/ngày nâng tạm (E2E chạy lặp nhiều lần trong ngày) – rules cũ được trả lại trong finally
      const config = { ...((prev.rules.config as Record<string, unknown> | undefined) ?? {}), daily_invite_limit: 5000 };
      await putFlagReal(GATE, { enabled: prev.enabled, rules: { ...prev.rules, config } });
    } else {
      await page.goto('/vi');
    }

    // (1) Admin mời theo email + gửi ngay (UI)
    await asAdmin(browser, page, null, (admin) => inviteViaAdminUi(admin, email));
    let code: string;
    if (REAL) {
      const mail = await sink!.waitFor((m) => m.to.includes(email) && INVITE_RE.test(m.text));
      code = INVITE_RE.exec(mail.text)![0];
    } else {
      code = (await mockHook<string | null>(page, 'lastInviteCode', email))!;
    }
    expect(code).toMatch(INVITE_RE);

    // (2) Bật beta gate → người dùng mới bị chặn khỏi app (landing vẫn xem được)
    if (REAL) await putFlagReal(GATE, { ...(await getFlagReal(GATE)), enabled: true });
    else await setFlag(page, GATE, true);
    await page.goto('/vi');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await registerViaUi(page, { email, name: 'E2E Beta Tester' });
    await expect(page).toHaveURL(/\/vi\/beta\?next=/, { timeout: 30_000 });
    await expect(page.getByTestId('beta-redeem')).toBeVisible();

    // (3) Mã sai → lỗi i18n; mã đúng (gõ thường, thiếu gạch) → quyền lợi theo phản hồi API
    const input = page.getByTestId('beta-code-input');
    await input.fill('alg-zzzz-9999');
    await expect(input).toHaveValue('ALG-ZZZZ-9999');
    await page.getByTestId('beta-redeem-submit').click();
    await expect(page.getByTestId('beta-redeem-error')).toHaveAttribute('data-reason', 'invalid');
    await expect(page.getByTestId('beta-redeem-error')).toContainText('Mã không đúng, đã hết hạn hoặc đã bị thu hồi');
    await input.fill(code.toLowerCase().replace(/-/g, ''));
    await expect(input).toHaveValue(code);
    await page.getByTestId('beta-redeem-submit').click();
    const done = page.getByTestId('beta-redeemed');
    await expect(done).toHaveAttribute('data-status', 'redeemed', { timeout: 20_000 });
    await expect(page.getByTestId('beta-credits')).toContainText('+2.000');
    await expect(page.getByTestId('beta-trial')).toContainText('Dùng thử tới');

    // (4) Onboarding beta: khảo sát 5 câu → hướng dẫn 60 giây (bỏ qua, nhớ) → kênh phản hồi → về trang ban đầu
    await page.getByTestId('beta-redeemed-continue').click();
    await expect(page).toHaveURL(/\/vi\/onboarding\/beta/);
    await page.getByTestId('beta-survey-submit').click();
    await expect(page.getByText('Chọn một mục tiêu.')).toBeVisible();
    await page.getByTestId('survey-goal-job').click();
    await page.getByTestId('survey-no-exam').check();
    await page.getByTestId('survey-score').fill('450');
    await page.getByTestId('survey-device-android').click();
    await page.getByTestId('survey-device-laptop').click();
    await page.getByTestId('survey-minutes').selectOption('45');
    await page.getByTestId('beta-survey-submit').click();
    await expect(page.getByTestId('beta-onboarding')).toHaveAttribute('data-step', 'tour');
    await page.getByTestId('beta-tour-next').click();
    await expect(page.getByTestId('beta-tour')).toHaveAttribute('data-slide', '1');
    await page.getByTestId('beta-tour-skip').click();
    await expect(page.getByTestId('beta-community')).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('allingo.beta-tour.v1'))).toBe('skipped');
    await page.getByTestId('beta-onboarding-finish').click();
    await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/);
    await expect(page.getByTestId('beta-survey-reminder')).toHaveCount(0);

    // (5) Đề mini (Exam) → kết quả → Xem lại → báo lỗi câu 1 (đúng phiên bản) → gửi lại = trùng
    await startTestSet(page, PART5, 'exam');
    await expect(page.getByTestId('feedback-button')).toHaveCount(0);
    for (const k of ['B', 'A', 'A']) {
      await answerCurrent(page, k);
      await page.getByTestId('next-button').click();
    }
    await page.getByTestId('submit-button').click();
    await page.getByTestId('confirm-submit').click();
    await expect(page).toHaveURL(/\/result$/, { timeout: 30_000 });
    const attemptId = new URL(page.url()).pathname.split('/').at(-2)!;
    await page.getByTestId('review-link').click();
    await expect(page).toHaveURL(/\/review$/);
    const item = page.getByTestId('review-item-1');
    await item.getByTestId('report-question').click();
    const dlg = page.getByTestId('report-dialog');
    await dlg.getByTestId('report-reason').selectOption('typo');
    await dlg.getByTestId('report-message').fill('Thiếu dấu phẩy ở đề bài (E2E)');
    await dlg.getByTestId('report-submit').click();
    await expect(dlg.getByTestId('report-done')).toHaveAttribute('data-duplicate', 'false');
    await dlg.getByTestId('report-close').click();
    await expect(item.getByTestId('report-question')).toHaveAttribute('data-sent', 'true');
    await item.getByTestId('report-question').click();
    await page.getByTestId('report-dialog').getByTestId('report-submit').click();
    await expect(page.getByTestId('report-dialog').getByTestId('report-done')).toHaveAttribute('data-duplicate', 'true');
    await page.getByTestId('report-dialog').getByTestId('report-close').click();

    // (6) Góp ý có ảnh (+ trang, phiên bản, trace_id gần nhất)
    await page.getByTestId('feedback-button').click();
    const fb = page.getByTestId('feedback-dialog');
    await expect(fb.getByTestId('feedback-context')).toContainText(`/attempts/${attemptId}/review`);
    await fb.getByTestId('feedback-category').selectOption('ux');
    await fb.getByTestId('feedback-message').fill('Nút "Câu tiếp" hơi nhỏ trên màn hình laptop (E2E)');
    await fb.getByTestId('feedback-file').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(fb.getByTestId('feedback-preview')).toBeVisible();
    await fb.getByTestId('feedback-submit').click();
    await expect(fb.getByTestId('feedback-done')).toBeVisible({ timeout: 20_000 });
    await fb.getByTestId('feedback-close').click();

    // (7) Ticket hỗ trợ gắn bài làm
    await page.goto(`/vi/support?attempt=${attemptId}`);
    await page.getByTestId('support-category').selectOption('exam');
    await page.getByTestId('support-subject').fill('Mất audio giữa bài (E2E)');
    await page.getByTestId('support-message').fill('Audio dừng ở câu 2, tải lại thì chạy tiếp.');
    await page.getByTestId('support-submit').click();
    await expect(page).toHaveURL(/\/vi\/support\/tickets\/[0-9a-f-]{36}/);
    const ticketId = page.url().split('/').pop()!;
    await expect(page.getByTestId('ticket-status')).toHaveAttribute('data-status', 'open');
    await expect(page.getByTestId('sla-chip')).toHaveAttribute('data-state', 'pending');

    // (8) Admin: thấy góp ý (ảnh + trace), báo lỗi câu, ticket → trả lời + cấp 150 credit bù (xác nhận)
    await asAdmin(browser, page, { email }, async (admin) => {
      await admin.goto('/vi/admin/feedback');
      const fbRow = admin.getByTestId('feedback-row').filter({ hasText: 'Câu tiếp' }).first();
      await expect(fbRow).toBeVisible();
      await expect(fbRow.getByTestId('feedback-trace')).toBeVisible();
      await expect(fbRow.getByText(/Mở ảnh|Đang xử lý/)).toBeVisible();
      await admin.goto('/vi/admin/content?tab=reports');
      await expect(admin.getByTestId('content-report-row').filter({ hasText: 'Thiếu dấu phẩy' }).first()).toBeVisible();
      await admin.goto(`/vi/admin/support?ticket=${ticketId}`);
      const detail = admin.getByTestId('admin-ticket-detail');
      await expect(detail).toBeVisible();
      await expect(detail.getByTestId('admin-ticket-thread')).toContainText('Audio dừng ở câu 2');
      await detail.getByTestId('admin-reply-message').fill('Chào bạn, đội kỹ thuật đã sửa lỗi audio. Tặng bạn ít credit bù.');
      await detail.getByTestId('admin-reply-credit-toggle').check();
      await detail.getByTestId('admin-reply-delta').fill('150');
      await detail.getByTestId('admin-reply-submit').click();
      await expect(detail.getByText('Ghi chú ít nhất 3 ký tự.')).toBeVisible();
      await detail.getByTestId('admin-reply-note').fill('Bù lỗi audio (E2E)');
      await detail.getByTestId('admin-reply-submit').click();
      await admin.getByTestId('admin-credit-confirm-confirm').click();
      await expect(admin.getByText('Đã gửi trả lời và cộng 150 credit')).toBeVisible({ timeout: 20_000 });
      await expect(detail).toHaveAttribute('data-status', 'waiting_user');
    });

    // (9) Người dùng thấy thông báo support.reply → mở đúng ticket → trả lời
    await page.goto('/vi/notifications');
    const note = page.locator('[data-testid="notification-item"][data-template="support.reply"]').first();
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText('Hỗ trợ đã trả lời');
    await note.click();
    await expect(page).toHaveURL(new RegExp(`/support/tickets/${ticketId}`));
    await expect(page.getByTestId('ticket-thread').locator('[data-author="agent"]')).toContainText('đội kỹ thuật đã sửa lỗi audio');
    await expect(page.getByTestId('ticket-status')).toHaveAttribute('data-status', 'waiting_user');
    await page.getByTestId('ticket-reply-input').fill('Cảm ơn, mình đã thử lại được rồi!');
    await page.getByTestId('ticket-reply-submit').click();
    await expect(page.getByTestId('ticket-status')).toHaveAttribute('data-status', 'open');
    await expect(page.getByTestId('ticket-thread').locator('[data-author="user"]')).toHaveCount(2);
  } finally {
    if (REAL) {
      if (prev) await putFlagReal(GATE, prev);
      await sink?.close();
    } else {
      await setFlag(page, GATE, false).catch(() => undefined);
    }
  }
});

test('beta gate: landing + /beta xem được khi chưa đăng nhập; trang beta mời đăng ký giữ mã', async ({ page }) => {
  await page.goto('/vi/beta?code=ALG-ABCD-2345');
  await expect(page.getByTestId('beta-page')).toBeVisible();
  await expect(page.getByTestId('beta-signin')).toBeVisible();
  await expect(page.getByTestId('beta-signup')).toHaveAttribute('href', /\/vi\/signup\?next=%2Fbeta%3Fcode%3DALG-ABCD-2345/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('beta kín');
});
