import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * S11 – a11y (chuẩn bị beta S12): axe-core (WCAG 2.0/2.1 A + AA) trên dashboard, màn thi Exam Mode, hộp thoại nộp, Review +
 * giải thích AI → 0 vi phạm serious/critical. Luồng thi hoàn toàn bằng bàn phím: Tab tới phương án → Space chọn, ←/→ chuyển
 * câu, phím số/chữ chọn, F đánh dấu, Tab tới "Nộp bài" → Enter → hộp thoại (focus bị giữ trong hộp thoại) → Enter nộp.
 * Trình đọc màn hình: phương án là `radio` trong `radiogroup` có tên (đề bài), trạng thái lưu/nộp qua vùng `status` (aria-live).
 */

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };

async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`);
  expect(summary, `${label}: axe serious/critical`).toEqual([]);
}

/** Nhấn Tab (tối đa `max` lần) cho tới khi phần tử đang focus khớp `testId` – chứng minh tới được bằng bàn phím */
async function tabTo(page: Page, testId: string, max = 80, shift = false): Promise<void> {
  for (let i = 0; i < max; i++) {
    if ((await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')) === testId) return;
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Không tới được [data-testid=${testId}] bằng Tab sau ${max} lần`);
}

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('dashboard: axe 0 vi phạm serious/critical (sau khi mọi thẻ dựng xong)', async ({ page }) => {
  await startAsGuest(page);
  await expect(page.getByTestId('kpi-streak')).toBeVisible();
  // Thẻ dựng khi trình duyệt rảnh (S11 – Deferred) phải có mặt trước khi quét
  await expect(page.getByTestId('dashboard-tutor')).toBeVisible();
  await expect(page.getByTestId('attempt-history').or(page.getByText('Chưa có bài làm nào'))).toBeVisible();
  await expectNoSeriousViolations(page, 'dashboard');
});

test('luồng thi bằng bàn phím + trình đọc màn hình; axe màn thi, hộp thoại nộp, Review + giải thích', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Bàn phím vật lý: kiểm trên desktop');
  test.setTimeout(REAL ? 150_000 : 90_000);
  await startAsGuest(page);
  await startTestSet(page, PART5, 'exam');

  const card = page.getByTestId('question-card');
  // Trình đọc màn hình: nhóm phương án có tên (đề bài) + từng phương án là radio có trạng thái
  const group = card.getByRole('radiogroup');
  await expect(group).toHaveCount(1);
  expect((await group.evaluate((el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')).trim().length).toBeGreaterThan(5);
  await expect(card.getByRole('radio')).toHaveCount(4);
  await expectNoSeriousViolations(page, 'màn thi');

  // Câu 1: Tab tới phương án A → Space chọn
  await tabTo(page, 'option-A');
  await page.keyboard.press('Space');
  await expect(card.getByTestId('option-A')).toHaveAttribute('aria-checked', 'true');
  // Câu 2: → rồi phím "2" (= B); F đánh dấu
  await page.keyboard.press('ArrowRight');
  await expect(card).toContainText('Câu 2/10');
  await page.keyboard.press('2');
  await expect(card.getByTestId('option-B')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('f');
  await expect(page.getByTestId('flag-button')).toHaveAttribute('aria-pressed', 'true');
  // ← quay lại câu 1 vẫn giữ đáp án; trạng thái lưu nháp đọc được qua vùng status
  await page.keyboard.press('ArrowLeft');
  await expect(card).toContainText('Câu 1/10');
  await expect(card.getByTestId('option-A')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('save-status')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');

  // Nộp: Tab tới nút "Nộp bài" → Enter → hộp thoại giữ focus → Tab tới xác nhận → Enter
  await tabTo(page, 'submit-button', 120);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expectNoSeriousViolations(page, 'hộp thoại nộp');
  await tabTo(page, 'confirm-submit', 6);
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/result$/, { timeout: 20_000 });
  await expect(page.getByTestId('raw-score')).toContainText('/10');
  await expectNoSeriousViolations(page, 'kết quả');

  // Review + giải thích (mở bằng bàn phím)
  await page.getByTestId('review-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/review$/);
  const first = page.getByTestId('review-item-1');
  await expect(first).toBeVisible();
  await expectNoSeriousViolations(page, 'review');
  const explain = first.getByTestId('explain-button');
  if (await explain.isVisible()) {
    await explain.focus();
    await page.keyboard.press('Enter');
  }
  await expect(first.getByTestId('explanation')).toBeVisible({ timeout: 30_000 });
  await expect(first.getByTestId('explanation')).toHaveAttribute('aria-live', 'polite');
  await expect(first.getByTestId('explanation-body')).toBeVisible({ timeout: 30_000 });
  await expectNoSeriousViolations(page, 'review + giải thích');
});

test('Listening Exam Mode: màn "Bắt đầu nghe" (hộp thoại) + thanh nghe – axe 0 serious/critical', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Một lần trên desktop là đủ');
  await page.addInitScript(() => {
    (window as unknown as { __ALLINGO_AUDIO_RATE__: number }).__ALLINGO_AUDIO_RATE__ = 4;
  });
  await startAsGuest(page);
  await startTestSet(page, { mock: 'toeic-listening-mini-01', real: 'toeic-listening-01-drill-part1' }, 'exam');
  await expect(page.getByTestId('listening-gate')).toBeVisible();
  await expectNoSeriousViolations(page, 'listening gate');
  await page.getByTestId('start-listening').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('listening-bar')).toBeVisible();
  await expect(page.getByTestId('listening-bar')).toHaveAttribute('role', 'status');
  await expectNoSeriousViolations(page, 'listening đang phát');
});
