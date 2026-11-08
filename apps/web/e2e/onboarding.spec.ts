import { expect, test } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { apiCall, registerNewUser } from './billing-helpers';
import { completeDiagnostic, TZ, vnDate } from './plan-helpers';

/**
 * Sprint 9 – người mới: dashboard mời lập lộ trình → onboarding 4 bước (chương trình → mục tiêu + ngày thi → giờ học/tuần + ngày
 * học + giờ nhắc + múi giờ mặc định theo trình duyệt → chẩn đoán) → bài chẩn đoán thích ứng tới hết (một câu mỗi màn, tiến độ,
 * mức, không đúng/sai) → kết quả (điểm ± khoảng L/R/Tổng, mastery, mục tiêu khả thi + lý do) → tạo lộ trình 8 tuần (ngày thi
 * sau 56 ngày), tuần cuối có full test. Người học bật dùng thử Pro (PRO7DAY) để xem mọi tuần (Free chỉ xem tuần hiện tại).
 */

test.use({ timezoneId: TZ });

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('onboarding 4 bước → chẩn đoán đến hết → kết quả → lộ trình 8 tuần, tuần cuối có full test', async ({ page }) => {
  test.setTimeout(REAL ? 300_000 : 150_000);
  await registerNewUser(page, 'onboard');
  const redeem = await apiCall(page, 'POST', '/promotions/redeem', { code: 'PRO7DAY', program: 'toeic' });
  expect(redeem.status).toBe(200);

  // Dashboard: chưa có lộ trình → thẻ mời onboarding
  await page.reload();
  await expect(page.getByTestId('dashboard-onboarding')).toBeVisible();
  await page.getByTestId('dashboard-onboarding-cta').click();
  await expect(page).toHaveURL(/\/vi\/onboarding$/);

  // Bước 1: chương trình (chỉ TOEIC mở)
  await expect(page.getByTestId('onboarding-page')).toHaveAttribute('data-step', '1');
  await expect(page.getByTestId('program-toeic')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('program-ielts')).toBeDisabled();
  await page.getByTestId('onboarding-next').click();

  // Bước 2: mục tiêu + ngày thi (ngày đã qua bị chặn như API)
  await expect(page.getByTestId('onboarding-page')).toHaveAttribute('data-step', '2');
  await page.getByTestId('target-750').click();
  await expect(page.getByTestId('target-input')).toHaveValue('750');
  await page.getByTestId('exam-date').fill(vnDate(0));
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByText('Ngày thi phải sau hôm nay.')).toBeVisible();
  const examDate = vnDate(56);
  await page.getByTestId('exam-date').fill(examDate);
  await page.getByTestId('onboarding-next').click();

  // Bước 3: giờ học/tuần, ngày học, giờ nhắc, múi giờ mặc định theo trình duyệt
  await expect(page.getByTestId('onboarding-page')).toHaveAttribute('data-step', '3');
  await expect(page.getByTestId('timezone')).toHaveValue(TZ);
  await page.getByTestId('weekly-300').click();
  await expect(page.getByTestId('weekly-input')).toHaveValue('300');
  await expect(page.getByTestId('day-sun')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('day-sun').click();
  await expect(page.getByTestId('day-sun')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('reminder-time').fill('19:30');
  await page.getByTestId('onboarding-next').click();

  // Bước 4: tóm tắt → bắt đầu chẩn đoán (enrollment lưu mục tiêu/ngày thi/phút ngày để gợi ý mục tiêu khả thi)
  await expect(page.getByTestId('onboarding-page')).toHaveAttribute('data-step', '4');
  await expect(page.getByTestId('onboarding-summary')).toContainText('750');
  await expect(page.getByTestId('onboarding-summary')).toContainText(examDate);
  await page.getByTestId('onboarding-start-diagnostic').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/diagnostic\?from=onboarding/);
  await expect(page.getByTestId('diagnostic-question')).toBeVisible({ timeout: 20_000 });

  // Tải lại giữa chừng → tiếp tục đúng câu đang chờ (sau khi trả lời 2 câu)
  for (let i = 0; i < 2; i++) {
    const q = page.getByTestId('diagnostic-question');
    const qid = await q.getAttribute('data-question-id');
    await q.locator('[data-testid^="option-"]').first().click();
    await page.getByTestId('diagnostic-next').click();
    await expect(page.getByTestId('diagnostic-question')).not.toHaveAttribute('data-question-id', qid!);
  }
  const pending = await page.getByTestId('diagnostic-question').getAttribute('data-question-id');
  await page.reload();
  await expect(page.getByTestId('diagnostic-question')).toHaveAttribute('data-question-id', pending!, { timeout: 20_000 });
  await expect(page.getByTestId('diagnostic-progress')).toHaveAttribute('data-number', '3');

  const run = await completeDiagnostic(page);
  expect(run.answered).toBeGreaterThanOrEqual(REAL ? 25 : 12);
  // Mock trả lời đúng mọi câu → lên mức 2 (đúng 2 câu liên tiếp)
  if (!REAL) expect(run.levels.has('2')).toBe(true);

  // Kết quả: điểm ước tính ± khoảng, L/R, mastery theo kỹ năng, mục tiêu khả thi + lý do
  const result = page.getByTestId('diagnostic-result');
  await expect(result.getByTestId('diagnostic-score')).toHaveText(/^\d{2,3}$/);
  await expect(result.getByTestId('diagnostic-range')).toContainText(/Khoảng \d+–\d+/);
  await expect(result.getByTestId('diagnostic-listening')).toContainText(/Khoảng \d+–\d+/);
  await expect(result.getByTestId('diagnostic-reading')).toContainText(/Khoảng \d+–\d+/);
  await expect(result.locator('[data-subskill]').first()).toBeVisible();
  const target = result.getByTestId('diagnostic-target');
  await expect(target).toHaveAttribute('data-reason', /^(feasible|stretch|unreachable)$/);
  await expect(result.getByTestId('diagnostic-reason')).not.toBeEmpty();
  const suggested = Number(await target.getAttribute('data-suggested'));
  expect(suggested).toBeGreaterThanOrEqual(10);

  // Dùng mục tiêu khả thi → tạo lộ trình
  await result.getByTestId('target-choice-suggested').click();
  await result.getByTestId('diagnostic-create-plan').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/plan\?created=1/, { timeout: 30_000 });
  const plan = page.getByTestId('plan-page');
  await expect(plan).toHaveAttribute('data-weeks', '8');
  await expect(plan).toHaveAttribute('data-pro', 'true');
  await expect(page.getByTestId('plan-summary')).toContainText(`Mục tiêu ${suggested}`);
  await expect(page.getByTestId('plan-exam-pct')).toContainText('Còn 56 ngày đến ngày thi');

  // Tuần 1 có việc cụ thể, phút/tuần đúng cài đặt (không vượt 300)
  await expect(page.getByTestId('week-panel')).toHaveAttribute('data-week', '1');
  await expect(page.locator('[data-testid="week-panel"] [data-testid="plan-task"]').first()).toBeVisible();
  const budget = Number(await page.getByTestId('week-load').getAttribute('data-budget'));
  const load = Number(await page.getByTestId('week-load').getAttribute('data-load'));
  expect(budget).toBeLessThanOrEqual(300);
  expect(load).toBeLessThanOrEqual(budget);

  // Tuần cuối (8) – mô phỏng, có full test
  await expect(page.getByTestId('week-tab-8')).toHaveAttribute('data-full-test', 'true');
  await page.getByTestId('week-tab-8').click();
  await expect(page.getByTestId('week-panel')).toHaveAttribute('data-week', '8');
  await expect(page.locator('[data-testid="week-panel"] [data-testid="plan-task"][data-task-type="full_test"]')).toHaveCount(1);

  // Dashboard giờ hiện thẻ Hôm nay thay cho lời mời
  await page.goto('/vi/toeic/dashboard');
  await expect(page.getByTestId('dashboard-today')).toBeVisible();
  await expect(page.getByTestId('dashboard-onboarding')).toHaveCount(0);
});
