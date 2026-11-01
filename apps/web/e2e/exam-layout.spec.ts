import { expect, test } from '@playwright/test';
import { answerCurrent, freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 3 – bố cục Exam Mode một trang cho Reading Part 5–7: thanh Part (+ phím [ ]), đoạn văn trái – câu hỏi phải
 * có thanh kéo (desktop) / đoạn văn thu gọn được (mobile), câu cùng nhóm hiển thị cùng đoạn văn, mốc [n] tô sáng,
 * tiêu đề phụ [Nhãn] của bộ nhiều đoạn, chế độ tập trung (Z/Esc), cỡ chữ 3 mức lưu localStorage.
 * Mock: đề `toeic-reading-mini-01` (3+4+3 câu). API thật: `toeic-reading-full-01` (30/16/54 câu, 75 phút).
 */

const READING = { mock: 'toeic-reading-mini-01', real: 'toeic-reading-full-01' };
/** Câu đầu Part 6 / câu đầu bộ nhiều đoạn Part 7 (số thứ tự trong đề) */
const P6_FIRST = REAL ? 31 : 4;
const P7_MULTI = REAL ? 76 : 8;
const TOTAL = REAL ? 100 : 10;

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('Reading Part 5–7: thanh Part, đoạn văn + nhóm câu, tập trung, cỡ chữ', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  await startAsGuest(page);
  await startTestSet(page, READING, 'exam');
  const bar = page.getByTestId('part-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('part-tab-part5')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('passage')).toHaveCount(0);
  await answerCurrent(page, 'A');
  await expect(page.getByTestId('part-tab-part5')).toContainText(`1/${REAL ? 30 : 3}`);

  // ] → Part 6: đoạn văn + các câu cùng nhóm, mốc chỗ trống của câu đang xem được tô sáng
  await page.keyboard.press(']');
  await expect(page.getByTestId('part-tab-part6')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${P6_FIRST}/${TOTAL}`);
  const passage = page.getByTestId('passage');
  await expect(passage).toBeVisible();
  await expect(page.getByTestId('question-block').first()).toBeVisible();
  const marker = passage.locator('[data-testid^="passage-marker-"][data-active="true"]');
  await expect(marker).toHaveCount(1);
  const firstMarker = await marker.getAttribute('data-testid');

  // Câu sau trong cùng nhóm: đoạn văn giữ nguyên, mốc tô sáng chuyển sang chỗ trống kế tiếp
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${P6_FIRST + 1}/${TOTAL}`);
  await expect(passage).toBeVisible();
  await expect(passage.locator('[data-testid^="passage-marker-"][data-active="true"]')).not.toHaveAttribute('data-testid', firstMarker!);
  await answerCurrent(page, 'B');

  if (!isMobile) {
    // Desktop: đoạn văn trái – câu hỏi phải, thanh kéo đổi tỉ lệ (bàn phím ←/→, Enter về 50%)
    const sep = page.getByRole('separator', { name: /Đổi tỉ lệ đoạn văn/ });
    await expect(page.getByTestId('split-pane')).toBeVisible();
    await expect(sep).toHaveAttribute('aria-valuenow', '50');
    await sep.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(sep).toHaveAttribute('aria-valuenow', '60');
    // Phím mũi tên trên thanh kéo không chuyển câu
    await expect(page.getByTestId('question-card')).toContainText(`Câu ${P6_FIRST + 1}/${TOTAL}`);
    // Kéo chuột
    const box = (await page.getByTestId('split-pane').boundingBox())!;
    const handle = (await sep.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Number(await sep.getAttribute('aria-valuenow'))).toBeLessThan(45);
  } else {
    // Mobile: xếp dọc, đoạn văn thu gọn/mở lại được
    await expect(page.getByTestId('split-pane')).toHaveCount(0);
    await page.getByTestId('passage-toggle').click();
    await expect(passage).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('passage-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('passage-toggle').click();
    await expect(passage).toHaveAttribute('data-collapsed', 'false');
  }

  // Bộ nhiều đoạn Part 7: tiêu đề phụ từ nhãn [Tiêu đề]
  if (isMobile) {
    await page.getByRole('button', { name: 'Mở danh sách câu' }).click();
    await page.getByRole('dialog').getByTestId(`grid-${P7_MULTI}`).click();
  } else {
    await page.locator('aside').getByTestId(`grid-${P7_MULTI}`).click();
  }
  await expect(page.getByTestId('part-tab-part7')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${P7_MULTI}/${TOTAL}`);
  await expect(page.getByTestId('passage-heading').first()).toBeVisible();
  expect(await page.getByTestId('passage-heading').count()).toBeGreaterThanOrEqual(2);

  // Chế độ tập trung: ẩn header/thanh Part/lưới, đồng hồ vẫn hiện; Esc thoát
  await page.keyboard.press('z');
  await expect(page.getByTestId('attempt-runner')).toHaveAttribute('data-focus', 'true');
  await expect(page.getByTestId('exam-header')).toHaveCount(0);
  await expect(page.getByTestId('part-bar')).toHaveCount(0);
  await expect(page.getByTestId('focus-bar').getByTestId('exam-clock')).toBeVisible();
  await expect(page.getByTestId('attempt-live')).toHaveText('Đã bật chế độ tập trung');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('exam-header')).toBeVisible();

  // Cỡ chữ: 3 mức, lưu localStorage (tải lại vẫn giữ)
  await page.getByTestId('font-increase').click();
  await page.keyboard.press('+');
  await expect(page.getByTestId('font-level')).toHaveAttribute('data-level', '2');
  await expect(page.getByTestId('font-increase')).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('font-level')).toHaveAttribute('data-level', '2');
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${P7_MULTI}/${TOTAL}`);
  await page.keyboard.press('-');
  await expect(page.getByTestId('font-level')).toHaveAttribute('data-level', '1');
});
