import { expect, test, type Page } from '@playwright/test';
import { keyAnswerOf } from '@allingo/schemas/question/describe';
import { numberMarks } from '@allingo/schemas/question/marks';
import { IELTS_LISTENING_01_SET, IELTS_READING_ACADEMIC_01_SET } from '../src/mock/ielts-fixtures';
import { freshGuestStorage, REAL, startAsGuest } from './helpers';
import { getFlagReal, putFlagReal, setFlag, type FlagState } from './s12-helpers';
import { answerCard, expectNoHorizontalOverflow, expectNoSeriousViolations } from './ielts-helpers';

/**
 * C3 – đề IELTS đầy đủ (tự biên soạn, cùng mã/nội dung ở mock và seed demo):
 * - Reading Academic 3 passage / 40 câu: đánh số "Questions 1–40" theo mục, lưới 40 ô, điều hướng theo số (focus đúng mục), nộp →
 *   band Reading + 40/40 + hình thức Academic; xem lại đánh số theo mục.
 * - Listening 4 part: Exam Mode đọc trước → audio cả part phát MỘT lần (không có trình phát tự do) → … → xem lại 2′ → TỰ NỘP; trả lời
 *   ngay trong lúc đọc trước. Practice: trình phát tự do; sau khi nộp nghe lại + transcript có mốc thời gian (bấm để tua) + dòng đáp án.
 * Audio tăng tốc bằng `window.__ALLINGO_AUDIO_RATE__` (chỉ bản dev) – đọc trước 30 s/16, xem lại 120 s/16.
 */

const IELTS_FLAG = 'ff.catalog.program.ielts';
const READING_CODE = 'ielts-reading-academic-01';
const LISTENING_CODE = 'ielts-listening-01';
const RATE = 16;

const reading = IELTS_READING_ACADEMIC_01_SET.questions;
const listening = IELTS_LISTENING_01_SET.questions;
const READING_NUM = numberMarks(reading.map((q) => q.content), 'per_item');

let savedFlag: FlagState | null = null;
test.beforeAll(async () => {
  if (REAL) savedFlag = await getFlagReal(IELTS_FLAG);
});
test.afterEach(async () => {
  if (savedFlag) await putFlagReal(IELTS_FLAG, savedFlag);
});
test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
  await page.addInitScript((rate) => {
    (window as unknown as { __ALLINGO_AUDIO_RATE__: number }).__ALLINGO_AUDIO_RATE__ = rate;
  }, RATE);
});

async function start(page: Page, code: string, mode: 'exam' | 'practice'): Promise<void> {
  await startAsGuest(page);
  await setFlag(page, IELTS_FLAG, true);
  await page.goto('/vi/ielts/test-sets');
  await page.getByTestId(`test-set-${code}`).getByRole('button', { name: /Bắt đầu/ }).click();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId('start-attempt').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('attempt-runner')).toBeVisible();
}

test('Reading Academic: đánh số 1–40 theo mục, điều hướng theo số, nộp → band Reading 9.0, 40/40', async ({ page, isMobile }) => {
  test.skip(isMobile && REAL, 'Cờ toàn cục trên API thật – chạy một lần (desktop)');
  test.setTimeout(300_000);
  expect(READING_NUM.at(-1)!.number_start + READING_NUM.at(-1)!.mark_count - 1).toBe(40);
  await start(page, READING_CODE, 'exam');
  await expect(page.getByTestId('explain-button')).toHaveCount(0);

  // Lưới 40 ô (mỗi SỐ câu hỏi một ô); chọn số 40 → câu cuối, focus vào mục tương ứng; chọn số 1 → về câu đầu
  const openGrid = async () => {
    if (!isMobile) return page.locator('aside');
    await page.getByRole('button', { name: 'Mở danh sách câu' }).click();
    return page.getByRole('dialog');
  };
  let grid = await openGrid();
  await expect(grid.locator('[data-testid^="grid-"][data-answered]')).toHaveCount(40);
  await grid.getByTestId('grid-40').click();
  await expect(page.getByTestId('question-card')).toHaveAttribute('data-number', String(READING_NUM.at(-1)!.number_start));
  grid = await openGrid();
  await grid.getByTestId('grid-1').click();
  await expect(page.getByTestId('question-card')).toHaveAttribute('data-number', '1');

  // Trả lời đúng mọi câu bằng điều khiển gốc
  for (let i = 0; i < reading.length; i++) {
    const card = page.getByTestId('question-card');
    await expect(card).toHaveAttribute('data-number', String(READING_NUM[i]!.number_start));
    if (READING_NUM[i]!.mark_count > 1) await expect(card.getByTestId('question-number')).toContainText(`${READING_NUM[i]!.number_start}–${READING_NUM[i]!.number_start + READING_NUM[i]!.mark_count - 1}`);
    await answerCard(card, reading[i]!.content, keyAnswerOf(reading[i]!.content)!);
    if (i === 0 && !isMobile) await expectNoSeriousViolations(page, 'reading câu 1');
    if (isMobile && i === 0) await expectNoHorizontalOverflow(page, 'reading câu 1');
    if (i < reading.length - 1) await page.getByTestId('next-button').click();
  }
  if (!isMobile) await expect(page.locator('aside').getByTestId('grid-progress')).toHaveText(/40\s*\/\s*40/);
  await page.getByTestId('next-button').click();
  await page.getByTestId('confirm-submit').click();

  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByTestId('ielts-band-card')).toBeVisible();
  await expect(page.getByTestId('ielts-band-value-reading')).toHaveText('9.0');
  await expect(page.getByTestId('ielts-band-raw-reading')).toContainText('40/40');
  await expect(page.getByTestId('ielts-module')).toContainText('Academic');
  await expect(page.getByTestId('raw-score')).toHaveText('40/40');
  await expect(page.getByTestId('breakdown-reading_p3')).toBeVisible();
  if (!isMobile) await expectNoSeriousViolations(page, 'kết quả IELTS');

  await page.getByTestId('review-link').click();
  await expect(page.getByTestId(`review-item-${READING_NUM[1]!.number_start}`)).toBeVisible();
});

test('Listening Exam Mode: đọc trước → nghe một lần từng part → xem lại → tự nộp', async ({ page, isMobile }) => {
  test.skip(isMobile && REAL, 'Cờ toàn cục trên API thật – chạy một lần (desktop)');
  test.skip(REAL, 'API thật: audio từ seed:media dài (~30′) – chạy luồng mock (audio 12 s/part)');
  test.setTimeout(180_000);
  await start(page, LISTENING_CODE, 'exam');
  // Exam Mode: không có trình phát tự do (không tua/dừng)
  await expect(page.getByTestId('listening-gate')).toBeVisible();
  await page.getByTestId('start-listening').click();
  const bar = page.getByTestId('listening-bar');
  await expect(bar).toHaveAttribute('data-pause-phase', 'preread');
  await expect(page.getByTestId('group-audio-player')).toHaveCount(0);
  await expect(page.getByTestId('audio-group')).toHaveAttribute('data-status', 'preread');
  // Trả lời được ngay trong lúc đọc trước (câu đầu part 1)
  const first = page.getByTestId('question-card');
  await answerCard(first, listening[0]!.content, keyAnswerOf(listening[0]!.content)!);
  // Part 1 phát (một lần) rồi sang đọc trước part 2
  await expect(bar).toHaveAttribute('data-phase', /loading|playing/, { timeout: 15_000 });
  await expect(page.getByTestId('listening-now')).toContainText(/Listening Part 2|Part 2/, { timeout: 30_000 });
  // Hết part 4 → xem lại → tự nộp
  await expect(bar).toHaveAttribute('data-pause-phase', 'review', { timeout: 60_000 });
  await expect(page).toHaveURL(/\/result$/, { timeout: 60_000 });
  await expect(page.getByTestId('ielts-band-listening')).toBeVisible();
  await expect(page.getByTestId('ielts-module')).toHaveCount(0);
});

test('Listening Practice: trình phát tự do; xem lại có transcript theo mốc thời gian (bấm để tua) và dòng chứa đáp án', async ({ page, isMobile }) => {
  test.skip(isMobile && REAL, 'Cờ toàn cục trên API thật – chạy một lần (desktop)');
  test.setTimeout(120_000);
  await start(page, LISTENING_CODE, 'practice');
  await expect(page.getByTestId('listening-gate')).toHaveCount(0);
  await expect(page.getByTestId('group-audio-player')).toBeVisible();
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await page.getByTestId('review-link').click();
  const group = page.getByTestId('review-audio-group').first();
  await expect(group.getByTestId('review-group-player')).toBeVisible();
  await expect(group.getByTestId('transcript-line').first()).toBeVisible();
  await expect(group.locator('[data-testid="transcript-line"][data-evidence="true"]').first()).toBeVisible();
  await group.getByTestId('transcript-seek').nth(1).click();
  if (isMobile) await expectNoHorizontalOverflow(page, 'xem lại Listening');
  else await expectNoSeriousViolations(page, 'xem lại Listening');
});
