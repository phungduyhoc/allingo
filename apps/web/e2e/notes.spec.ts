import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 6 – ghi chú: Review → "Thêm ghi chú" ở một câu → gõ Markdown → tự lưu (debounce; POST rồi PATCH) → "Đã lưu" →
 * Xong (hiển thị Markdown) → tải lại vẫn hiện (`ReviewItem.note`) → "Ghi chú của tôi": tìm kiếm, mở lại bài xem lại
 * đúng câu (?focus=), sửa, xoá; giới hạn 2.000 ký tự. Mock: `toeic-p5-mini-01`; API thật: `toeic-mini-part5-01`.
 */

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function toReview(page: Page): Promise<string> {
  await startAsGuest(page);
  const attemptId = await startTestSet(page, PART5, 'exam');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByTestId('review-item-2')).toBeVisible();
  return attemptId;
}

test('Review: ghi chú Markdown tự lưu → tải lại vẫn hiện → "Ghi chú của tôi" tìm kiếm, mở câu, sửa, xoá', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const attemptId = await toReview(page);
  const item = page.getByTestId('review-item-2');
  const qv = await page.locator('div[data-qv]').nth(1).getAttribute('data-qv');
  const writes: string[] = [];
  page.on('request', (r) => {
    if (/\/notes(\/[^/?]+)?$/.test(new URL(r.url()).pathname) && r.method() !== 'GET') writes.push(r.method());
  });

  await item.getByTestId('note-add').click();
  const note = item.getByTestId('note');
  const input = note.getByTestId('note-input');
  await expect(input).toBeFocused();
  await input.pressSequentially('**Mẹo**: "by" + mốc thời gian', { delay: 10 });
  await expect(note).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });
  await expect(note.getByTestId('note-status')).toHaveText('Đã lưu');
  await expect(note.getByTestId('note-count')).toHaveText(/^\d+\/2000$/);
  // Gõ tiếp → PATCH cùng ghi chú (không tạo ghi chú mới)
  await input.press('End');
  await input.pressSequentially(' – không dùng "until"', { delay: 10 });
  await expect(note.getByTestId('note-status')).toHaveText('Đã lưu', { timeout: 10_000 });
  await note.getByTestId('note-done').click();
  const view = item.getByTestId('note');
  await expect(view).toHaveAttribute('data-state', 'view');
  await expect(view.getByTestId('note-body').locator('strong')).toHaveText('Mẹo');
  await expect(view.getByTestId('note-body')).toContainText('không dùng "until"');
  if (REAL) {
    await expect.poll(() => writes[0]).toBe('POST');
    expect(writes.slice(1).every((m) => m === 'PATCH')).toBe(true);
  } else {
    const notes = await page.evaluate(() =>
      Object.values(
        (
          JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as {
            notes?: Record<string, { body: string }>;
          }
        ).notes ?? {},
      ),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe('**Mẹo**: "by" + mốc thời gian – không dùng "until"');
  }

  // Tải lại → ReviewItem.note hiển thị lại
  await page.reload();
  await expect(page.getByTestId('review-item-2').getByTestId('note').getByTestId('note-body')).toContainText(
    'Mẹo: "by" + mốc thời gian',
  );

  // Ghi chú của tôi: tìm kiếm + mở lại đúng câu
  await page.goto('/vi/notes');
  await expect(page.getByTestId('notes-item')).toHaveCount(1);
  await page.getByTestId('notes-search').fill('mốc thời gian');
  await expect(page.getByTestId('notes-count')).toHaveText('1 ghi chú');
  await page.getByTestId('notes-search').fill('zzzz-khong-co');
  await expect(page.getByText('Không có ghi chú nào khớp “zzzz-khong-co”.')).toBeVisible();
  await page.getByTestId('notes-search').fill('');
  await expect(page.getByTestId('notes-item')).toHaveCount(1);
  await page.getByTestId('notes-open-review').click();
  await expect(page).toHaveURL(new RegExp(`/attempts/${attemptId}/review\\?focus=${qv}`));
  await expect(page.locator(`div[data-qv="${qv}"]`)).toBeInViewport();

  // Sửa trong "Ghi chú của tôi" rồi xoá
  await page.goto('/vi/notes');
  const editor = page.getByTestId('notes-item').first().getByTestId('notes-editor');
  await editor.getByTestId('note-edit').click();
  await editor.getByTestId('note-input').fill('Ghi chú đã sửa');
  await expect(editor.getByTestId('note-status')).toHaveText('Đã lưu', { timeout: 10_000 });
  await editor.getByTestId('note-done').click();
  await expect(editor.getByTestId('note-body')).toHaveText('Ghi chú đã sửa');
  await editor.getByTestId('note-delete').click();
  await expect(page.getByText('Đã xoá ghi chú.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('notes-item')).toHaveCount(0);
});

test('Giới hạn 2.000 ký tự; xoá hết chữ → xoá ghi chú', async ({ page }) => {
  await toReview(page);
  const item = page.getByTestId('review-item-1');
  await item.getByTestId('note-add').click();
  const note = item.getByTestId('note');
  await note.getByTestId('note-input').fill('x'.repeat(2100));
  await expect(note.getByTestId('note-count')).toHaveText('2000/2000');
  await expect(note.getByText('Ghi chú tối đa 2000 ký tự')).toBeVisible();
  await expect(note.getByTestId('note-status')).toHaveText('Đã lưu', { timeout: 10_000 });
  // Xoá hết → DELETE → không còn ghi chú
  await note.getByTestId('note-input').fill('');
  await expect(note).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });
  await note.getByTestId('note-done').click();
  await expect(item.getByTestId('note-add')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('review-item-1').getByTestId('note-add')).toBeVisible();
});
