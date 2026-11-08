import { expect, test, type Page } from '@playwright/test';
import { answerCurrent, freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Sổ lỗi (S10): làm đề mini Part 5 ở chế độ thi, cố ý sai 3 câu đầu (chọn D – đáp án đúng là A/B) và bỏ trống phần còn lại →
 * nộp → /toeic/errors có các mục (câu, đáp án của bạn/đúng, loại lỗi) + thống kê theo loại/Part → lọc theo Part → chọn 2 câu →
 * "Làm lại" tạo timed_drill đúng 2 câu đó → nộp (sai lại) → mục được gộp (sai 2 lần) → đổi lý do, ghi chú, tạo thẻ ôn →
 * "Đã hiểu" → biến khỏi danh sách chưa hiểu, có trong "Đã hiểu".
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };

async function submitAttempt(page: Page) {
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 30_000 });
}

test('câu sai → sổ lỗi → làm lại đúng các câu đã chọn → gộp lần sai → đánh dấu đã hiểu', async ({ page }) => {
  test.setTimeout(REAL ? 180_000 : 120_000);
  await startAsGuest(page);
  await startTestSet(page, PART5, 'exam');
  for (let i = 0; i < 3; i++) {
    await answerCurrent(page, 'D');
    await page.getByTestId('next-button').click();
  }
  await submitAttempt(page);

  await page.goto('/vi/toeic/errors');
  await expect(page.getByTestId('errors-page')).toBeVisible();
  const entries = page.getByTestId('error-entry');
  await expect(entries.first()).toBeVisible({ timeout: 20_000 });
  const total = Number(await page.getByTestId('errors-open').textContent());
  expect(total).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('errors-by-part').locator('[data-key="part5"]')).toHaveAttribute('data-count', String(total));
  await expect(page.getByTestId('errors-by-kind').locator('button').first()).toBeVisible();

  // Câu đã trả lời sai hiển thị "D" ở "Bạn chọn"
  const answered = entries.filter({ has: page.getByTestId('error-your-answer').filter({ hasText: /^D/ }) });
  await expect(answered).toHaveCount(3);
  await expect(answered.first().getByTestId('error-correct-answer')).toHaveText(/^[A-C]/);
  await expect(answered.first().getByTestId('error-question')).not.toBeEmpty();

  // Lọc theo Part (URL giữ bộ lọc) → tải lại vẫn giữ
  await page.getByTestId('errors-filter-part').selectOption('part5');
  await expect(page).toHaveURL(/part=part5/);
  await page.reload();
  await expect(page.getByTestId('errors-filter-part')).toHaveValue('part5');
  await expect(entries).toHaveCount(Math.min(total, 20));

  // Chọn 2 câu đã trả lời sai → "Làm lại 2 câu đã chọn" → timed_drill đúng 2 câu
  const pick = [answered.nth(0), answered.nth(1)];
  const ids = [await pick[0]!.getAttribute('data-entry-id'), await pick[1]!.getAttribute('data-entry-id')];
  for (const e of pick) await e.getByTestId('error-select').check();
  await expect(page.getByTestId('errors-drill')).toHaveText(/Làm lại 2 câu đã chọn/);
  await page.getByTestId('errors-drill').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(page.getByTestId('attempt-runner')).toBeVisible();
  await expect(page.getByTestId('grid-progress')).toContainText('/2');
  // Sai lại cả hai câu rồi nộp
  await answerCurrent(page, 'D');
  await page.getByTestId('next-button').click();
  await answerCurrent(page, 'D');
  await submitAttempt(page);

  await page.goto('/vi/toeic/errors?part=part5');
  const target = page.locator(`[data-testid="error-entry"][data-entry-id="${ids[0]}"]`);
  await expect(target.getByTestId('error-occurrences')).toHaveText('Sai 2 lần', { timeout: 20_000 });

  // Đổi lý do → nhãn loại đổi + "(tự động: …)"; ghi chú; tạo thẻ ôn
  await target.getByTestId('error-reason').selectOption('vocabulary');
  await expect(target.getByTestId('error-kind')).toHaveText('Từ vựng');
  await expect(target).toContainText('(tự động:');
  await target.getByTestId('error-note-toggle').click();
  await target.getByTestId('error-note-input').fill('Nhớ: nhìn từ loại sau chỗ trống');
  await target.getByTestId('error-note-save').click();
  await expect(target.getByTestId('error-note')).toContainText('nhìn từ loại');
  await target.getByTestId('error-create-card').click();
  await expect(target.getByTestId('error-card-created')).toBeVisible();

  // Đã hiểu → rời danh sách "Chưa hiểu", tổng giảm, có trong "Đã hiểu"
  await target.getByTestId('error-resolve').click();
  await expect(target).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('errors-open')).toHaveText(String(total - 1));
  await expect(page.getByTestId('errors-resolved')).toHaveText('1');
  await page.getByTestId('errors-status-resolved').click();
  await expect(page.locator(`[data-testid="error-entry"][data-entry-id="${ids[0]}"]`)).toHaveAttribute('data-resolved', 'true');
  await expect(page.locator(`[data-testid="error-entry"][data-entry-id="${ids[0]}"]`).getByTestId('error-note')).toContainText('nhìn từ loại');

  // Thẻ lỗi xuất hiện trong phiên ôn (loại "Câu đã sai")
  await page.goto('/vi/toeic/vocab/review');
  await page.getByTestId('review-start').click();
  await expect(page.getByTestId('flashcard')).toBeVisible();
  await expect(page.getByText('Câu đã sai')).toBeVisible();
});

test('đang làm bài thi (Exam Mode) → sổ lỗi khoá + banner "Tiếp tục bài thi"', async ({ page }) => {
  test.setTimeout(90_000);
  await startAsGuest(page);
  await startTestSet(page, PART5, 'exam');
  await page.goto('/vi/toeic/errors');
  await expect(page.getByTestId('exam-lock-banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('errors-drill')).toBeDisabled();
});
