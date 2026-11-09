import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import type { AnswerInput } from '@allingo/schemas/question/answer';
import type { QuestionContent } from '@allingo/schemas/question/content';

/** Dùng chung cho E2E IELTS (C2 dạng câu, C3 đề đầy đủ): axe, tràn ngang, nhập câu trả lời bằng điều khiển gốc */

const TFNG_ORDER = ['true', 'false', 'not_given'] as const;

export async function expectNoSeriousViolations(page: Page, label: string): Promise<void> {
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

export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: tràn ngang`).toBeLessThanOrEqual(1);
}

/** Nhập câu trả lời vào thẻ câu đang xem bằng điều khiển gốc (ô nhập gõ phím, `<select>`, nút radio) */
export async function answerCard(
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
