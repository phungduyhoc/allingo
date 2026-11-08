import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest } from './helpers';

/**
 * Flashcard (S10): khách mới → /toeic/vocab → "Thêm cả bộ" → phiên ôn 10 thẻ (Free: 10 từ mới/ngày) → thẻ đầu chấm "Quên" (Again,
 * phím 1) → thẻ đó QUAY LẠI trong phiên sau các thẻ khác → các thẻ còn lại lật (Space) + "Nhớ" (phím 3) → tổng kết 11 lượt chấm,
 * 1 thẻ ôn lại, 10 từ mới → bộ từ hiện tiến độ → phiên mới: hết hạn mức từ mới hôm nay + giờ reset (giờ VN).
 * Mock: bộ "trọn bộ (mẫu)" 20 từ; API thật: "TOEIC 600 – Sức khoẻ – y tế" (30 từ, seed demo).
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

const LIST = REAL ? /Sức khoẻ – y tế/ : /trọn bộ \(mẫu\)/;

async function currentCardId(page: Page): Promise<string> {
  const card = page.getByTestId('flashcard');
  await expect(card).toBeVisible();
  return (await card.getAttribute('data-card-id'))!;
}

test('thêm cả bộ → ôn 10 thẻ → Again quay lại trong phiên → tổng kết → hết hạn mức từ mới', async ({ page }) => {
  test.setTimeout(REAL ? 150_000 : 120_000);
  await startAsGuest(page);
  await page.goto('/vi/toeic/vocab');
  await expect(page.getByTestId('vocab-page')).toBeVisible();

  const list = page.locator('[data-testid^="vocab-list-"]').filter({ has: page.getByTestId('vocab-list-title').filter({ hasText: LIST }) });
  await expect(list).toHaveAttribute('data-action', 'enroll');
  await list.getByTestId('vocab-enroll').click();
  await expect(page.getByText(/Đã thêm \d+ từ/)).toBeVisible();
  await expect(list).toHaveAttribute('data-action', 'learn_new');

  // Phiên ôn của bộ: còn 10 từ mới hôm nay (Free)
  await list.getByTestId('vocab-start').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/vocab\/review\?list=/);
  await expect(page.getByTestId('count-new')).toHaveText('10');
  await page.getByTestId('size-10').click();
  await page.getByTestId('review-start').click();
  await expect(page.getByTestId('review-progress')).toHaveAttribute('data-total', '10');

  // Thẻ 1: lật bằng Space → lịch xem trước 4 nút → "Quên" bằng phím 1
  const first = await currentCardId(page);
  await expect(page.getByTestId('card-headword')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('flashcard-back')).toBeVisible();
  await expect(page.getByTestId('rate-interval-1')).toHaveText(/phút/);
  await expect(page.getByTestId('rate-interval-3')).toHaveText(/ngày/);
  await page.keyboard.press('1');

  // Các thẻ còn lại: Space + 3 ("Nhớ"); ghi lại thứ tự thẻ để kiểm tra thẻ Again quay lại SAU thẻ khác
  const order: string[] = [first];
  for (let i = 0; i < 15; i++) {
    const summary = page.getByTestId('review-summary');
    const card = page.getByTestId('flashcard');
    await expect(summary.or(card)).toBeVisible();
    if (await summary.isVisible()) break;
    const id = await currentCardId(page);
    expect(id).not.toBe(order[order.length - 1]);
    order.push(id);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('flashcard-back')).toBeVisible();
    await page.keyboard.press('3');
  }
  const again = order.indexOf(first, 1);
  expect(again, `thẻ Again phải quay lại trong phiên: ${order.join(',')}`).toBeGreaterThan(1);
  expect(order).toHaveLength(11);

  // Tổng kết
  const summary = page.getByTestId('review-summary');
  await expect(summary).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('summary-reviews')).toHaveText('11');
  await expect(page.getByTestId('summary-again')).toHaveText('1');
  await expect(page.getByTestId('summary-new')).toHaveText('10');
  await expect(page.getByTestId('summary-recall')).toHaveText('91%');

  // Bộ từ: đã có tiến độ, hết từ mới hôm nay → phiên mới báo hạn mức + giờ reset theo giờ VN
  await page.goto('/vi/toeic/vocab');
  await expect(page.getByTestId('vocab-new-today')).toHaveText('0');
  await expect(list.getByText(/10 đang học/)).toBeVisible();
  await page.goto('/vi/toeic/vocab/review');
  await page.getByTestId('review-start').click();
  await expect(page.getByTestId('review-empty')).toBeVisible();
  await expect(page.getByTestId('new-limit-notice')).toContainText(/Lượt mới lúc 00:00 (hôm nay|ngày mai)/);
});

test('chế độ nghe – gõ lại từ: gõ sai → đáp án + gợi ý "Quên"; phím số khi đang gõ không chấm điểm', async ({ page }) => {
  test.setTimeout(90_000);
  await startAsGuest(page);
  await page.goto('/vi/toeic/vocab');
  const list = page.locator('[data-testid^="vocab-list-"]').filter({ has: page.getByTestId('vocab-list-title').filter({ hasText: LIST }) });
  await list.getByTestId('vocab-enroll').click();
  await expect(list).toHaveAttribute('data-action', 'learn_new');
  await list.getByTestId('vocab-start').click();
  await page.getByTestId('mode-dictation').click();
  await page.getByTestId('review-start').click();
  await expect(page.getByTestId('dictation-input')).toBeVisible();
  // Tiêu đề từ bị ẩn ở mặt trước (nghe + nghĩa)
  await expect(page.getByTestId('card-headword')).toHaveCount(0);
  const input = page.getByTestId('dictation-input');
  await input.pressSequentially('zz12');
  await expect(input).toHaveValue('zz12');
  await input.press('Enter');
  await expect(page.getByTestId('dictation-result')).toHaveAttribute('data-result', 'wrong');
  await expect(page.getByTestId('card-headword')).toBeVisible();
  // Ô gõ vẫn focus ở mặt sau → phím "3" không chấm điểm (đang gõ)
  await input.press('3');
  await expect(page.getByTestId('flashcard')).toHaveAttribute('data-side', 'back');
  await expect(page.getByTestId('review-progress')).toHaveAttribute('data-done', '0');
  await page.getByTestId('rate-1').click();
  await expect(page.getByTestId('dictation-input')).toHaveValue('');
});
