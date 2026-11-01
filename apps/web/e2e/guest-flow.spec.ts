import { expect, test, type Page } from '@playwright/test';

/**
 * Luồng khách Sprint 0 (tiêu chí nghiệm thu mục 7 của master prompt):
 * landing → Luyện thử (tạo khách) → dashboard → chọn đề mini Part 5 → trả lời 10 câu (tải lại giữa chừng vẫn giữ nháp)
 * → nộp → kết quả → xem lại → Giải thích (SSE) → bấm lần 2 trả từ cache.
 *
 * Chạy không cần API: `NEXT_PUBLIC_API_MOCK=1` (playwright.config.ts đặt sẵn). Với API thật: E2E_REAL_API=1 + seed demo.
 */

const ANSWERS = ['B', 'A', 'A', 'A', 'B', 'A', 'B', 'B', 'A', 'A'];

async function answerCurrent(page: Page, key: string) {
  await page.getByTestId(`option-${key}`).click();
  await expect(page.getByTestId(`option-${key}`)).toHaveAttribute('aria-checked', 'true');
}

test.beforeEach(async ({ page }) => {
  // Mock giữ trạng thái trong localStorage – xoá MỘT LẦN ở lần tải đầu của mỗi test để mỗi test là một khách mới
  // (init script chạy lại ở mọi lần điều hướng/tải lại, nên dùng cờ trong sessionStorage)
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e.cleared')) return;
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('allingo.')) window.localStorage.removeItem(k);
    window.sessionStorage.setItem('e2e.cleared', '1');
  });
});

test('landing hiển thị 4 chương trình và tuyên bố nhãn hiệu', async ({ page }) => {
  await page.goto('/vi');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ngoại ngữ cho tất cả');
  for (const code of ['toeic', 'ielts', 'jlpt', 'hsk']) await expect(page.getByTestId(`program-${code}`)).toBeVisible();
  await expect(page.getByText(/TOEIC là nhãn hiệu của ETS/)).toBeVisible();
});

test('khách làm đề mini Part 5, nộp, xem lại và giải thích AI', async ({ page }) => {
  await page.goto('/vi');
  await page.getByRole('button', { name: 'Luyện thử miễn phí' }).first().click();

  // Dashboard khách
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/);
  await expect(page.getByTestId('guest-banner')).toBeVisible();
  await expect(page.getByTestId('quota-mini_test')).toBeVisible();

  // Chọn đề mini Part 5 (mock: toeic-p5-mini-01, seed demo: toeic-mini-part5-01) → chế độ Thi
  await page
    .locator('[data-testid^="test-set-toeic-"]')
    .filter({ hasText: /Part 5/ })
    .first()
    .getByRole('button', { name: /Bắt đầu/ })
    .click();
  await page.getByTestId('mode-exam').click();
  await page.getByTestId('start-attempt').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('exam-clock')).toBeVisible();

  // Trả lời 5 câu đầu, chuyển bằng nút và phím tắt
  for (let i = 0; i < 5; i++) {
    await answerCurrent(page, ANSWERS[i]!);
    if (i < 4) await page.getByTestId('next-button').click();
  }
  await page.keyboard.press('f'); // đánh dấu câu 5
  await expect(page.getByTestId('flag-button')).toHaveAttribute('aria-pressed', 'true');

  // Chờ lưu nháp rồi tải lại trang → khôi phục câu hiện tại + đáp án
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(page.getByTestId('question-card')).toContainText('Câu 5/10');
  await expect(page.getByTestId('option-B')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('grid-progress')).toContainText('5/10');

  // 5 câu còn lại bằng phím tắt số
  for (let i = 5; i < 10; i++) {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press(String(ANSWERS[i]!.charCodeAt(0) - 64));
    await expect(page.getByTestId(`option-${ANSWERS[i]}`)).toHaveAttribute('aria-checked', 'true');
  }

  // Nộp
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByTestId('raw-score')).toContainText('/10');
  await expect(page.getByTestId('scaled-score')).toBeVisible();
  await expect(page.getByText(/ước tính/i).first()).toBeVisible();

  // Xem lại + giải thích (SSE) → lần 2 từ cache
  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  const first = page.getByTestId('review-item-1');
  await expect(first).toBeVisible();
  // Cache giải thích dùng chung theo (phiên bản câu, đáp án chọn, ngôn ngữ) → có thể đã hiện sẵn nếu người khác đã hỏi
  const explainBtn = first.getByTestId('explain-button');
  if (await explainBtn.isVisible()) await explainBtn.click();
  await expect(first.getByTestId('explanation')).toBeVisible();
  await expect(first.getByTestId('explanation')).toContainText('Vì sao đáp án đúng');

  await page.reload();
  const again = page.getByTestId('review-item-1');
  // Lần 2: hoặc review đã kèm explanation cache (hiện ngay), hoặc bấm lại → API trả JSON cached:true
  await expect(again).toBeVisible();
  if (await again.getByTestId('explain-button').isVisible()) await again.getByTestId('explain-button').click();
  await expect(again.getByTestId('explanation')).toHaveAttribute('data-cached', 'true');
  await expect(again.getByText('từ bộ nhớ')).toBeVisible();
});

test('đăng ký tài khoản ghép tiến độ khách', async ({ page }) => {
  await page.goto('/vi');
  await page.getByRole('button', { name: 'Luyện thử miễn phí' }).first().click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto('/vi/signup');
  await expect(page.getByText(/phiên khách sẽ được ghép/)).toBeVisible();
  const email = `e2e-${Date.now()}@allingo.test`;
  await page.getByLabel('Tên hiển thị').fill('Học viên E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill('password123');
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByTestId('guest-banner')).toHaveCount(0);
  await expect(page.getByTestId('user-chip')).toContainText('Học viên E2E');
});
