import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * B5/S24 – TOEIC Part 7 bộ đôi/bộ ba: tab từng văn bản (WAI-ARIA tablist, ←/→/Home/End, aria-selected/aria-controls) ở màn luyện tập
 * (practice) và màn xem lại (review); câu khác cùng bộ giữ nguyên tab đang đọc. Exam Mode: `exam-layout.spec.ts`.
 * Mock: đề `toeic-reading-mini-01` (bộ đôi ở câu 8–10). API thật: bộ luyện `toeic-reading-01-drill-part7` (bộ đôi ở câu 7–11).
 */
const SET = { mock: 'toeic-reading-mini-01', real: 'toeic-reading-01-drill-part7' };
const MULTI = REAL ? 7 : 8;
const TOTAL = REAL ? 11 : 10;

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function gotoQuestion(page: Page, n: number, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Mở danh sách câu' }).click();
    await page.getByRole('dialog').getByTestId(`grid-${n}`).click();
  } else {
    await page.locator('aside').getByTestId(`grid-${n}`).click();
  }
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${n}/${TOTAL}`);
}

test('Part 7 nhiều văn bản: tab từng văn bản khi luyện tập và khi xem lại', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await startAsGuest(page);
  await startTestSet(page, SET, 'practice');
  await gotoQuestion(page, MULTI, isMobile);

  const pane = page.getByTestId('passage');
  await expect(pane).toHaveAttribute('data-parts', /^[23]$/);
  const tablist = pane.getByTestId('passage-tablist');
  await expect(tablist).toHaveAttribute('role', 'tablist');
  const tabs = tablist.getByRole('tab');
  const n = await tabs.count();
  expect(n).toBeGreaterThanOrEqual(2);
  // Tab đầu được chọn; chỉ tab đang chọn có tabIndex 0; tab trỏ tới panel tương ứng
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toHaveAttribute('tabindex', '0');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
  const panelId = await tabs.nth(1).getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  await expect(page.locator(`[id="${panelId}"]`)).toBeHidden();

  // Bàn phím: focus tab đầu → → chọn tab 2 (focus theo); End → tab cuối; Home → tab đầu; ← từ tab đầu vòng về cuối
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'tabpanel');
  await page.keyboard.press('End');
  await expect(tabs.nth(n - 1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(n - 1)).toHaveAttribute('aria-selected', 'true');
  // Phím mũi tên trên tab không chuyển câu
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${MULTI}/${TOTAL}`);

  // Câu sau trong cùng bộ: vẫn là bộ nhiều văn bản, tab đang đọc được giữ
  await tabs.nth(1).click();
  await gotoQuestion(page, MULTI + 1, isMobile);
  await expect(page.getByTestId('passage-tablist').getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');

  // Nộp → xem lại: câu thuộc bộ có tab văn bản trong khung đoạn văn
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  const item = page.getByTestId(`review-item-${MULTI}`);
  await expect(item).toBeVisible();
  const details = item.getByTestId('review-passage');
  await details.locator('summary').click();
  const reviewTabs = details.getByTestId('review-passage-tabs').getByRole('tab');
  expect(await reviewTabs.count()).toBe(n);
  await reviewTabs.nth(1).click();
  await expect(reviewTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(details.getByTestId('passage-panel-2')).toBeVisible();
  await expect(details.getByTestId('passage-panel-1')).toBeHidden();
  // id không trùng giữa các câu cùng bộ trong trang xem lại
  const ids = await page.locator('[role="tab"][id]').evaluateAll((els) => els.map((e) => e.id));
  expect(new Set(ids).size).toBe(ids.length);
});
