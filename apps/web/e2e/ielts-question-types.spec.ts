import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { keyAnswerOf } from '@allingo/schemas/question/describe';
import type { AnswerInput } from '@allingo/schemas/question/answer';
import type { QuestionContent } from '@allingo/schemas/question/content';
import { IELTS_DEMO_CODE, IELTS_DEMO_QUESTIONS } from '../src/mock/ielts-fixtures';
import { freshGuestStorage, REAL, startAsGuest } from './helpers';
import { getFlagReal, putFlagReal, setFlag, type FlagState } from './s12-helpers';

/**
 * C2 – 14 dạng câu IELTS Reading/Listening (đề mẫu tự biên soạn `ielts-question-types-demo`, 18 câu – cùng nội dung ở mock và seed
 * demo): làm bài ở Exam Mode bằng ô nhập/ô chọn gốc (bàn phím, không cần kéo thả) → nộp → kết quả band → xem lại từng mục đúng/sai;
 * practice: "Kiểm tra" → tô từng chỗ trống + đáp án đúng. axe không lỗi serious/critical ở các renderer mới; mobile không tràn ngang.
 * Cờ ra mắt IELTS bật trong test (API thật: admin API; trạng thái cũ khôi phục ở `afterEach` – chạy cả khi test hết giờ, `finally` thì không).
 */

const IELTS_FLAG = 'ff.catalog.program.ielts';
/** Câu cố ý trả lời sai một chỗ trống (short_answer – vị trí 17) */
const WRONG_INDEX = IELTS_DEMO_QUESTIONS.findIndex((q) => q.content.type === 'short_answer');
const TFNG_ORDER = ['true', 'false', 'not_given'] as const;

async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
  // Chờ animation hữu hạn kết thúc (axe quét khi opacity < 1 → color-contrast giả) – như s12-pages.spec.ts
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 5)
          .join(' | ')}`,
    ),
    `${label}: axe serious/critical`,
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: tràn ngang`).toBeLessThanOrEqual(1);
}

async function enableIelts(page: Page): Promise<void> {
  await setFlag(page, IELTS_FLAG, true);
}

/** API thật: cờ là toàn cục – lưu trạng thái trước spec, trả lại sau MỖI test */
let savedFlag: FlagState | null = null;
test.beforeAll(async () => {
  if (REAL) savedFlag = await getFlagReal(IELTS_FLAG);
});
test.afterEach(async () => {
  if (savedFlag) await putFlagReal(IELTS_FLAG, savedFlag);
});

async function startDemo(page: Page, mode: 'exam' | 'practice'): Promise<void> {
  await page.goto('/vi/ielts/test-sets');
  await page
    .getByTestId(`test-set-${IELTS_DEMO_CODE}`)
    .getByRole('button', { name: /Bắt đầu/ })
    .click();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId('start-attempt').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('attempt-runner')).toBeVisible();
}

/** Nhập câu trả lời vào thẻ câu đang xem bằng điều khiển gốc (ô nhập gõ phím, `<select>`, nút radio) */
async function answerCard(
  card: Locator,
  content: QuestionContent,
  answer: AnswerInput,
  opts: { typeKeys?: boolean } = {},
): Promise<void> {
  switch (answer.type) {
    case 'mcq_single':
      await card.getByTestId(`option-${answer.selected}`).click();
      return;
    case 'mcq_multi':
      for (const k of answer.selected) await card.getByTestId(`option-${k}`).click();
      return;
    case 'tfng': {
      const c = content as Extract<QuestionContent, { type: 'tfng' }>;
      for (const s of c.statements) {
        const v = answer.values[s.key] as (typeof TFNG_ORDER)[number];
        await card
          .getByRole('radiogroup', { name: s.text, exact: true })
          .getByRole('radio')
          .nth(TFNG_ORDER.indexOf(v))
          .click();
      }
      return;
    }
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      for (const [item, option] of Object.entries(answer.pairs))
        await card.getByTestId(`pair-select-${item}`).selectOption(option);
      return;
    case 'summary_word_bank':
      for (const [id, key] of Object.entries(answer.gaps))
        await card.getByTestId(`bank-select-${id}`).selectOption(key);
      return;
    case 'plan_map_labelling':
      for (const [item, key] of Object.entries(answer.values))
        await card.getByTestId(`place-select-${item}`).selectOption(key);
      return;
    default: {
      const gaps = (answer as { gaps: Record<string, string> }).gaps;
      for (const [id, value] of Object.entries(gaps)) {
        const input = card.getByTestId(`gap-input-${id}`);
        if (opts.typeKeys) {
          // Gõ phím thật: phím tắt màn thi (A–D, F, mũi tên…) không được kích hoạt khi đang ở ô nhập
          await input.click();
          await input.pressSequentially(value);
        } else await input.fill(value);
        await expect(input).toHaveValue(value);
      }
    }
  }
}

function answerFor(i: number): AnswerInput {
  const c = IELTS_DEMO_QUESTIONS[i]!.content;
  const key = keyAnswerOf(c)!;
  if (i !== WRONG_INDEX) return key;
  const gaps = { ...(key as { gaps: Record<string, string> }).gaps };
  gaps[Object.keys(gaps)[0]!] = 'zebra crossing';
  return { ...(key as object), gaps } as AnswerInput;
}

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('Exam Mode: 18 câu (14 dạng mới) → nộp → band → xem lại từng mục; a11y + không tràn ngang', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile && REAL, 'Cờ toàn cục trên API thật – chạy một lần (desktop); mock chạy cả mobile');
  test.setTimeout(240_000);
  await startAsGuest(page);
  await enableIelts(page);
  await startDemo(page, 'exam');
  // Không có trợ giúp AI trong Exam Mode
  await expect(page.getByTestId('explain-button')).toHaveCount(0);

  const axeAt = new Set([
    'table_completion',
    'plan_map_labelling',
    'diagram_labelling',
    'matching_headings',
    'summary_word_bank',
    'flow_chart_completion',
  ]);
  for (let i = 0; i < IELTS_DEMO_QUESTIONS.length; i++) {
    const q = IELTS_DEMO_QUESTIONS[i]!;
    const card = page.getByTestId('question-card');
    await expect(card).toHaveAttribute('data-number', String(i + 1));
    if (!['mcq_single', 'mcq_multi', 'tfng'].includes(q.content.type))
      await expect(card.getByTestId(`renderer-${q.content.type}`)).toBeVisible();
    if (q.content.type === 'mcq_multi') await expect(card.getByTestId('mcq-multi-hint')).toBeVisible();
    if (q.content.type === 'plan_map_labelling' || q.content.type === 'diagram_labelling') {
      // Phương án không cần nhìn: alt + khối mô tả bằng chữ
      await expect(card.getByTestId('rl-figure-image')).toHaveAttribute('alt', /.+/);
      await expect(card.getByTestId('rl-figure-description')).toBeVisible();
    }
    if (q.content.type === 'table_completion') await expect(card.getByTestId('completion-table-scroll')).toBeVisible();
    await answerCard(card, q.content, answerFor(i), { typeKeys: q.content.type === 'form_completion' });
    // Gõ phím trong ô nhập không chuyển câu
    await expect(page.getByTestId('question-card')).toHaveAttribute('data-number', String(i + 1));
    if (isMobile) await expectNoHorizontalOverflow(page, `câu ${i + 1} (${q.content.type})`);
    else if (axeAt.has(q.content.type)) await expectNoSeriousViolations(page, `câu ${i + 1} (${q.content.type})`);
    await page.getByTestId('next-button').click();
  }
  // Câu cuối: nút "Nộp bài" mở hộp xác nhận
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByTestId('scaled-score')).toHaveText(/^\d(\.5)?$/);
  await expect(page.getByTestId('breakdown-listening')).toBeVisible();
  await expect(page.getByTestId('breakdown-reading_p1')).toBeVisible();

  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  for (let i = 0; i < IELTS_DEMO_QUESTIONS.length; i++) {
    const item = page.getByTestId(`review-item-${i + 1}`);
    await expect(item, `câu ${i + 1}`).toHaveAttribute('data-correct', i === WRONG_INDEX ? 'false' : 'true');
  }
  const wrong = page.getByTestId(`review-item-${WRONG_INDEX + 1}`);
  const firstGap = Object.keys(
    (keyAnswerOf(IELTS_DEMO_QUESTIONS[WRONG_INDEX]!.content) as { gaps: Record<string, string> }).gaps,
  )[0]!;
  await expect(wrong.locator(`[data-gap="${firstGap}"]`)).toHaveAttribute('data-state', 'wrong');
  await expect(wrong.getByTestId(`gap-correct-${firstGap}`)).toBeVisible();
  // Dạng nối / bản đồ: từng mục tô đúng
  const mapIdx = IELTS_DEMO_QUESTIONS.findIndex((q) => q.content.type === 'plan_map_labelling');
  await expect(
    page
      .getByTestId(`review-item-${mapIdx + 1}`)
      .locator('[data-testid^="place-row-"][data-state="correct"]')
      .first(),
  ).toBeVisible();
  if (isMobile) await expectNoHorizontalOverflow(page, 'xem lại');
  else await expectNoSeriousViolations(page, 'xem lại IELTS');
});

test('practice: điền từ → "Kiểm tra" → tô từng chỗ trống + đáp án đúng; nối có phương án chọn bằng bàn phím', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile && REAL, 'Cờ toàn cục trên API thật – chạy một lần (desktop)');
  await startAsGuest(page);
  await enableIelts(page);
  await startDemo(page, 'practice');
  // Câu 2: form_completion – sai chỗ trống đầu
  await page.getByTestId('next-button').click();
  const card = page.getByTestId('question-card');
  await expect(card.getByTestId('renderer-form_completion')).toBeVisible();
  const c = IELTS_DEMO_QUESTIONS[1]!.content;
  const key = keyAnswerOf(c) as { type: 'form_completion'; gaps: Record<string, string> };
  const [first, ...rest] = Object.keys(key.gaps);
  await answerCard(card, c, { ...key, gaps: { ...key.gaps, [first!]: 'wrong answer here' } });
  await card.getByTestId('practice-check').click();
  await expect(card.locator(`[data-gap="${first}"]`)).toHaveAttribute('data-state', 'wrong');
  await expect(card.getByTestId(`gap-correct-${first}`)).toBeVisible();
  for (const id of rest) await expect(card.locator(`[data-gap="${id}"]`)).toHaveAttribute('data-state', 'correct');
  // Đã kiểm tra → khoá sửa
  await expect(card.getByTestId(`gap-input-${first}`)).toBeDisabled();

  // Câu nối (matching_headings): chọn bằng bàn phím trên <select> gốc
  const hIdx = IELTS_DEMO_QUESTIONS.findIndex((q) => q.content.type === 'matching_headings');
  for (let i = 1; i < hIdx; i++) await page.getByTestId('next-button').click();
  const hCard = page.getByTestId('question-card');
  await expect(hCard).toHaveAttribute('data-number', String(hIdx + 1));
  await expect(hCard.getByTestId('renderer-matching_headings')).toBeVisible();
  // Dòng ví dụ (Example) là ô chọn bị khoá – lấy mục đầu tiên còn trả lời được
  const sel = hCard.locator('[data-testid^="pair-select-"]:not([disabled])').first();
  await sel.focus();
  await expect(sel).toBeFocused();
  await expect(sel).toHaveValue('');
  await sel.press('ArrowDown');
  await expect(sel).not.toHaveValue('');
  // Phím mũi tên trong ô chọn không chuyển câu
  await expect(page.getByTestId('question-card')).toHaveAttribute('data-number', String(hIdx + 1));
  if (isMobile) await expectNoHorizontalOverflow(page, 'practice IELTS');
});
