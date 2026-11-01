import { expect, test } from '@playwright/test';
import { answerCurrent, draftsInIndexedDb, freshGuestStorage, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 3 – Exam Mode chịu mất mạng (tiêu chí nghiệm thu S3):
 * đề mini Part 5 chế độ Thi → trả lời vài câu → offline (banner, nháp vào IndexedDB) → online (đồng bộ) → tải lại
 * (giữ đáp án + đúng câu đang xem) → offline rồi ĐÓNG tab → mở lại (khôi phục nháp chưa gửi từ IndexedDB)
 * → nộp → kết quả có khối Chẩn đoán → Xem lại lọc "Câu sai" đúng (giữ trên URL).
 * Chạy được với mock (mặc định) và API thật (E2E_REAL_API=1).
 */

const PART5_MINI = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };
const KEYS = ['B', 'A', 'C', 'A', 'A', 'B', 'A'];

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('Thi: mất mạng giữa chừng không mất câu trả lời, tải lại đúng câu, nộp → chẩn đoán → lọc câu sai', async ({ page, context }) => {
  await startAsGuest(page);
  const attemptId = await startTestSet(page, PART5_MINI, 'exam');
  await expect(page.getByTestId('exam-clock')).toBeVisible();
  await expect(page.getByTestId('attempt-runner')).toHaveAttribute('data-store', 'indexeddb');

  // 1) Online: câu 1–3
  for (let i = 0; i < 3; i++) {
    await answerCurrent(page, KEYS[i]!);
    await page.getByTestId('next-button').click();
  }
  await expect(page.getByTestId('question-card')).toContainText('Câu 4/10');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');

  // 2) Mất mạng: câu 4–5 → banner + nháp nằm trong IndexedDB
  await context.setOffline(true);
  await answerCurrent(page, KEYS[3]!);
  const banner = page.getByTestId('offline-banner');
  await expect(banner).toHaveAttribute('data-mode', 'offline');
  await expect(banner).toContainText('Mất kết nối – câu trả lời được giữ trên máy');
  await page.getByTestId('next-button').click();
  await answerCurrent(page, KEYS[4]!);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'offline');
  await expect.poll(() => draftsInIndexedDb(page, attemptId)).toBeGreaterThanOrEqual(2);

  // 3) Có mạng lại → tự đồng bộ, banner biến mất, IndexedDB trống
  await context.setOffline(false);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
  await expect(banner).toHaveCount(0);
  await expect.poll(() => draftsInIndexedDb(page, attemptId)).toBe(0);

  // 4) Tải lại → đáp án còn nguyên, đúng câu đang xem
  await page.reload();
  await expect(page.getByTestId('question-card')).toContainText('Câu 5/10');
  await expect(page.getByTestId('question-card').getByTestId(`option-${KEYS[4]}`)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('grid-progress')).toContainText('5/10');

  // 5) Mất mạng rồi đóng tab (nháp chỉ còn trong IndexedDB) → có mạng, mở lại: khôi phục câu 6–7 + vị trí câu 7
  await page.getByTestId('next-button').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await context.setOffline(true);
  await answerCurrent(page, KEYS[5]!);
  await page.getByTestId('next-button').click();
  await answerCurrent(page, KEYS[6]!);
  await expect.poll(() => draftsInIndexedDb(page, attemptId)).toBeGreaterThanOrEqual(2);
  await page.close();
  await context.setOffline(false);

  const tab = await context.newPage();
  await tab.goto(`/vi/attempts/${attemptId}`);
  await expect(tab.getByTestId('question-card')).toContainText('Câu 7/10');
  await expect(tab.getByTestId('question-card').getByTestId(`option-${KEYS[6]}`)).toHaveAttribute('aria-checked', 'true');
  await expect(tab.getByTestId('grid-progress')).toContainText('7/10');
  await expect(tab.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
  await expect.poll(() => draftsInIndexedDb(tab, attemptId)).toBe(0);

  // 6) Nộp → kết quả có chẩn đoán (bỏ trống 3/10 → cờ many_unanswered), thang 5–495 ghi rõ ước tính
  await tab.getByTestId('submit-button').click();
  await tab.getByTestId('confirm-submit').click();
  await expect(tab).toHaveURL(/\/result$/);
  const diagnosis = tab.getByTestId('diagnosis-card');
  await expect(diagnosis).toBeVisible();
  await expect(diagnosis.locator('[data-flag="many_unanswered"]')).toBeVisible();
  await expect(tab.getByTestId('scale-range')).toContainText('5–495');
  await expect(tab.getByTestId('scale-range')).toContainText('ước tính');
  const raw = (await tab.getByTestId('raw-score').innerText()).trim();
  const correct = Number(raw.split('/')[0]);
  const total = Number(raw.split('/')[1]);
  expect(total).toBe(10);
  const wrongCount = total - correct;

  // 7) Xem lại: lọc "Câu sai" (tham số API only_wrong) → chỉ câu sai, đếm đúng; giữ trên URL khi tải lại
  await tab.getByTestId('review-link').click();
  await expect(tab).toHaveURL(/\/review$/);
  await expect(tab.locator('[data-testid^="review-item-"]')).toHaveCount(10);
  await tab.getByTestId('review-filter-wrong').click();
  await expect(tab).toHaveURL(/\/review\?filter=wrong$/);
  const items = tab.locator('[data-testid^="review-item-"]');
  await expect(items).toHaveCount(wrongCount);
  for (const item of await items.all()) await expect(item).toHaveAttribute('data-correct', 'false');
  await expect(tab.getByTestId('wrong-position')).toContainText(`${wrongCount} câu sai`);
  await tab.getByTestId('next-wrong').click();
  await expect(tab.getByTestId('wrong-position')).toContainText(`Câu sai 1/${wrongCount}`);

  await tab.reload();
  await expect(tab.getByTestId('review-filter-wrong')).toHaveAttribute('aria-selected', 'true');
  await expect(tab.locator('[data-testid^="review-item-"]')).toHaveCount(wrongCount);

  // Lọc kết hợp: Câu sai + Part 5 (đề chỉ có Part 5 → cùng số lượng); Đã đánh dấu → không có câu nào
  await tab.getByTestId('review-section').selectOption('part5');
  await expect(tab).toHaveURL(/filter=wrong&section=part5/);
  await expect(tab.locator('[data-testid^="review-item-"]')).toHaveCount(wrongCount);
  await tab.getByTestId('review-filter-flagged').click();
  await expect(tab.getByText('Không có câu nào khớp bộ lọc.')).toBeVisible();
});
