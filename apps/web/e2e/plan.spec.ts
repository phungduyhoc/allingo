import { expect, test } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { apiCall, registerNewUser } from './billing-helpers';
import { createPlanViaApi, taskOfType, TZ, vnDate } from './plan-helpers';

/**
 * Sprint 9 – lộ trình & Hôm nay (người học Free, lộ trình 8 tuần không ngày thi, học cả 7 ngày, 300 phút/tuần):
 * 1) Hôm nay → mở lượt luyện Part từ task (POST /attempts kèm plan_task_id) → nộp → "Về Hôm nay" → task done (server tự đánh dấu
 *    khi bài được chấm) + chuỗi ngày 1 + XP tăng;
 * 2) đổi ngày task trong tuần: kéo thả (desktop) và menu "Chuyển sang ngày…" (bàn phím/mobile) → tải lại vẫn giữ; tuần sau khoá (Free);
 * 3) check-in "tuần này bận, chỉ 2 giờ" → đề xuất giảm tải tuần tới (diff trước/sau) → Áp dụng → tuần tới ≤ 120 phút, đề xuất applied.
 */

test.use({ timezoneId: TZ });

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('Hôm nay → mở drill từ task → nộp → quay lại thấy task xong + streak/XP', async ({ page }) => {
  test.setTimeout(REAL ? 180_000 : 120_000);
  await registerNewUser(page, 'today');
  await createPlanViaApi(page);
  const xpBefore = ((await apiCall(page, 'GET', '/me/stats?program=toeic')).data as { xp: { total: number } }).xp.total;

  await page.goto('/vi/toeic/today');
  const today = page.getByTestId('today-page');
  await expect(today).toHaveAttribute('data-date', vnDate(0));
  await expect(page.getByTestId('streak-card')).toHaveAttribute('data-streak', '0');
  const list = page.getByTestId('today-tasks');
  await expect(list.locator('[data-testid="plan-task"]').first()).toBeVisible();
  await expect(page.getByTestId('today-quick')).toBeVisible();

  // Task luyện Part đầu tiên (Part 5 nếu có – câu chữ, nộp nhanh)
  const drills = taskOfType(list, 'part_drill');
  await expect(drills.first()).toBeVisible();
  const reading = drills.filter({ hasText: /Part [567]/ });
  const task = (await reading.count()) ? reading.first() : drills.first();
  const taskId = (await task.getAttribute('data-task-id'))!;
  await task.getByTestId('task-open').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(page.getByTestId('attempt-runner')).toBeVisible();
  // Trả lời câu đầu rồi nộp
  await page.getByTestId('question-card').locator('[data-testid^="option-"]').first().click();
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 30_000 });
  await page.getByTestId('result-back-to-plan').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/today$/);

  // Task đã xong (outbox attempt.graded → done; realtime plan.updated / tải lại), chuỗi 1 ngày, đã học hôm nay, XP tăng
  await expect(page.locator(`[data-testid="plan-task"][data-task-id="${taskId}"]`)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
  await expect(page.getByTestId('streak-card')).toHaveAttribute('data-streak', '1', { timeout: 15_000 });
  await expect(page.getByTestId('streak-current')).toHaveText('1 ngày');
  await expect.poll(async () => Number(await page.getByTestId('today-xp').getAttribute('data-xp')), { timeout: 15_000 }).toBeGreaterThan(xpBefore);
  await expect(page.getByTestId('today-done-count')).toContainText(/^1\//);

  // Mở lại task đã xong → làm lại để ôn (không gắn plan_task_id) – nút "Mở lại"
  await expect(page.locator(`[data-testid="plan-task"][data-task-id="${taskId}"]`).getByTestId('task-open')).toContainText('Mở lại');

  // Dashboard: thẻ Hôm nay hiện chuỗi
  await page.goto('/vi/toeic/dashboard');
  await expect(page.getByTestId('dashboard-today')).toBeVisible();
  await expect(page.getByTestId('dashboard-streak')).toContainText('1 ngày');
});

test('đổi ngày task trong tuần: kéo thả + menu "Chuyển sang ngày…"; tuần sau khoá với Free', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await registerNewUser(page, 'move');
  await createPlanViaApi(page);
  await page.goto('/vi/toeic/plan');
  await expect(page.getByTestId('plan-page')).toHaveAttribute('data-weeks', '8');
  await expect(page.getByTestId('plan-page')).toHaveAttribute('data-pro', 'false');
  const d0 = vnDate(0);
  const d1 = vnDate(1);
  const d2 = vnDate(2);
  const day = (date: string) => page.locator(`[data-testid="plan-day"][data-date="${date}"]`);
  await expect(day(d0)).toBeVisible();

  // 1) Menu ⋯ → "Chuyển sang" (bàn phím / mobile)
  const first = day(d0).locator('[data-testid="plan-task"][data-status="pending"]').first();
  const id1 = (await first.getAttribute('data-task-id'))!;
  await first.getByTestId('task-menu').click();
  const select = first.getByTestId('task-move-select');
  // Không có ngày đã qua / ngày hiện tại trong lựa chọn
  await expect(select.locator(`option[value="${d0}"]`)).toHaveCount(0);
  await select.selectOption(d2);
  await expect(day(d2).locator(`[data-task-id="${id1}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(day(d0).locator(`[data-task-id="${id1}"]`)).toHaveCount(0);

  // 2) Kéo thả (desktop): task hôm nay → ngày mai
  if (!isMobile) {
    const second = day(d0).locator('[data-testid="plan-task"][data-status="pending"]').first();
    const id2 = (await second.getAttribute('data-task-id'))!;
    // Thả gần đầu ô ngày đích (cùng hàng với ô hôm nay, lg:grid-cols-2): thả vào TÂM ô cao (font hệ thống rộng trên CI → ô ~490 px)
    // buộc Playwright cuộn trang giữa thao tác kéo HTML5 → Chromium bỏ sự kiện dragover/drop (CI đỏ, cục bộ xanh)
    await second.dragTo(day(d1), { targetPosition: { x: 40, y: 24 } });
    await expect(day(d1).locator(`[data-task-id="${id2}"]`)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(day(d1).locator(`[data-task-id="${id2}"]`)).toBeVisible();
  }
  await page.reload();
  await expect(day(d2).locator(`[data-task-id="${id1}"]`)).toBeVisible();

  // Server giữ luật: không đổi sang tuần khác (PATCH trả 400)
  const r = await apiCall(page, 'PATCH', `/plan-tasks/${id1}`, { due_date: vnDate(9) });
  expect(r.status).toBe(400);

  // Free: tuần 2 khoá + CTA nâng cấp
  await expect(page.getByTestId('week-tab-2')).toHaveAttribute('data-locked', 'true');
  await page.getByTestId('week-tab-2').click();
  await expect(page.getByTestId('week-locked')).toBeVisible();
  await expect(page.getByTestId('week-upgrade')).toHaveAttribute('href', /\/pricing$/);
});

test('check-in "tuần này bận, chỉ 2 giờ" → đề xuất giảm tải tuần tới → áp dụng', async ({ page }) => {
  test.setTimeout(120_000);
  await registerNewUser(page, 'checkin');
  const plan = await createPlanViaApi(page);
  expect(plan.weeks[1]!.load_minutes).toBeGreaterThan(120);

  await page.goto('/vi/toeic/plan');
  await expect(page.getByTestId('plan-page')).toBeVisible();
  // Mở điểm danh từ task check-in cuối tuần (luôn mở được, không cần chờ tới hạn)
  const checkinTask = page.locator('[data-testid="week-panel"] [data-testid="plan-task"][data-task-type="checkin"]');
  await checkinTask.getByTestId('task-open').click();
  const dialog = page.getByTestId('checkin-dialog');
  await expect(dialog.getByTestId('checkin-form')).toBeVisible();
  await dialog.getByTestId('feeling-tired').click();
  await dialog.getByTestId('checkin-actual').fill('2');
  await dialog.getByTestId('checkin-difficulties').fill('Tuần này bận, chỉ 2 giờ');
  await dialog.getByTestId('next-hours-2').click();
  await dialog.getByTestId('checkin-submit').click();

  await expect(dialog.getByTestId('checkin-result')).toBeVisible({ timeout: 20_000 });
  const card = dialog.getByTestId('proposal-card');
  await expect(card).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await expect(card.getByTestId('proposal-diff')).toBeVisible();
  await expect(card.getByTestId('proposal-minutes')).toHaveAttribute('data-after', /^\d+$/);
  expect(Number(await card.getByTestId('proposal-minutes').getAttribute('data-after'))).toBeLessThanOrEqual(120);
  const proposalId = (await card.getAttribute('data-proposal-id'))!;
  await card.getByTestId('proposal-apply').click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Lịch sử đề xuất lưu trạng thái applied; tuần tới ≤ 120 phút; check-in tuần này xong
  const list = await apiCall(page, 'GET', '/me/plan/adjust?program=toeic&limit=5');
  const applied = (list.data as { data: { proposal_id: string; status: string; minutes_after: number }[] }).data.find((p) => p.proposal_id === proposalId);
  expect(applied?.status).toBe('applied');
  expect(applied!.minutes_after).toBeLessThanOrEqual(120);
  const after = (await apiCall(page, 'GET', '/me/plan?program=toeic')).data as { weeks: { week_no: number; load_minutes: number; checkin_done: boolean }[] };
  expect(after.weeks[1]!.load_minutes).toBeLessThanOrEqual(120);
  expect(after.weeks[0]!.checkin_done).toBe(true);
  await expect(page.locator('[data-testid="week-panel"] [data-testid="plan-task"][data-task-type="checkin"]')).toHaveAttribute('data-status', 'done', { timeout: 15_000 });

  // Áp dụng lại cùng đề xuất → 200 (idempotent)
  const again = await apiCall(page, 'POST', `/me/plan/adjust/${proposalId}/apply`);
  expect(again.status).toBe(200);
});
