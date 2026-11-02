import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, selectInZone, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 6 – tra từ: nhấp đúp "invoice" trong đề bài ở Review → popover (headword, IPA US/UK + phát âm, nghĩa, ví dụ,
 * collocations); bôi đen chữ gõ dở → gợi ý → bấm gợi ý; thêm 5 từ vào "từ vựng của tôi" (SRS) → trạng thái đã lưu;
 * bôi đen câu dài (> 4 từ) → dịch AI (nhãn AI dịch), tải lại → lần 2 "Bản dịch có sẵn" (cache server);
 * Practice có tra từ, Exam Mode thì không.
 *
 * Mock: đề `toeic-p5-mini-01` (câu 5 có "invoice"); API thật: `toeic-mini-part5-01` (câu có "attached invoice").
 */

const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };
const READING = { mock: 'toeic-reading-mini-01', real: 'toeic-reading-full-01' };

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function toReview(page: Page): Promise<void> {
  await startAsGuest(page);
  await startTestSet(page, PART5, 'exam');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByTestId('review-item-1')).toBeVisible();
}

/** Vùng tra từ (đề bài) đầu tiên chứa `word` */
const zoneWith = (page: Page, word: string) => page.locator('article [data-lookup]').filter({ hasText: word }).first();
const popover = (page: Page) => page.getByTestId('lookup-popover');

async function closePopover(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
}

test('Review: nhấp đúp "invoice" → IPA US/UK, nghĩa, ví dụ, phát âm; chữ gõ dở → gợi ý; thêm vào từ vựng', async ({
  page,
}) => {
  await toReview(page);
  const zone = zoneWith(page, 'invoice');
  await expect(zone).toBeVisible();
  // Đo thời gian phản hồi tra từ (API thật: tiêu chí < 200 ms khi đã cache)
  const timing = REAL
    ? page.waitForResponse((r) => r.url().includes('/dictionary/lookup') && r.url().includes('q=invoice'))
    : null;
  expect(await selectInZone(page, zone, 'invoice', 'dblclick')).toBe(true);
  const card = popover(page).getByTestId('lookup-card');
  await expect(card).toHaveAttribute('data-status', 'success');
  await expect(card).toHaveAttribute('data-source', 'dictionary');
  await expect(card.getByTestId('lookup-headword')).toHaveText('invoice');
  await expect(card.getByTestId('lookup-ipa-us')).toContainText('/ˈɪnvɔɪs/');
  await expect(card.getByTestId('lookup-ipa-uk')).toContainText('/');
  await expect(card.getByTestId('lookup-meanings')).toContainText('hoá đơn');
  await expect(card.getByTestId('lookup-examples')).toBeVisible();
  await expect(card.getByTestId('lookup-collocations')).toBeVisible();
  if (REAL) {
    const res = (await timing)!;
    const t = res.request().timing();
    test.info().annotations.push({ type: 'lookup-ms', description: String(Math.round(t.responseEnd)) });
  }
  // Phát âm: US (audio_url có sẵn hoặc /tts), UK (luôn /tts giọng en-GB) – không báo lỗi
  const ttsReq = REAL ? page.waitForRequest((r) => r.url().includes('/tts?')) : null;
  await card.getByTestId('lookup-play-uk').click();
  if (REAL) expect((await ttsReq)!.url()).toContain('voice=en-GB');
  await expect(card.getByTestId('lookup-play-uk')).toBeEnabled();
  await expect(page.getByText('Không phát được âm thanh')).toHaveCount(0);
  // Thêm vào từ vựng → "Đã thêm vào từ vựng"
  await card.getByTestId('srs-add').click();
  await expect(card.getByTestId('srs-saved')).toHaveText('Đã thêm vào từ vựng');
  await closePopover(page);

  // Bôi đen chữ dở "invoic" → không có trong từ điển → gợi ý "invoice" → bấm gợi ý → mục từ điển, đã lưu
  expect(await selectInZone(page, zone, 'invoic')).toBe(true);
  await expect(popover(page).getByTestId('lookup-suggestions')).toBeVisible();
  await popover(page)
    .getByTestId('lookup-suggestion')
    .filter({ hasText: /^invoice$/ })
    .click();
  await expect(popover(page).getByTestId('lookup-headword')).toHaveText('invoice');
  await expect(popover(page).getByTestId('srs-saved')).toHaveText('Đã có trong từ vựng');
  // Bấm ra ngoài → đóng
  await page.mouse.click(5, 5);
  await expect(popover(page)).toHaveCount(0);
});

test('Thêm 5 từ trong đề bài vào SRS; tra lại → "Đã có trong từ vựng"', async ({ page }) => {
  test.setTimeout(120_000);
  await toReview(page);
  // 5 từ khác nhau (≥ 6 chữ cái) lấy từ đề bài đang hiển thị
  const words = await page.locator('article [data-lookup]').evaluateAll((els) => {
    const seen = new Set<string>();
    for (const el of els)
      for (const w of (el.textContent ?? '').match(/\b[A-Za-z]{6,}\b/g) ?? [])
        if (!seen.has(w.toLowerCase()) && seen.size < 5) seen.add(w.toLowerCase());
    return [...seen];
  });
  expect(words).toHaveLength(5);
  const created: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/me/srs/cards') && r.request().method() === 'POST') created.push(r.status());
  });
  for (const w of words) {
    const zone = page
      .locator('article [data-lookup]')
      .filter({ hasText: new RegExp(`\\b${w}\\b`, 'i') })
      .first();
    const exact = await zone.evaluate(
      (el, word) => (el.textContent ?? '').match(new RegExp(`\\b${word}\\b`, 'i'))?.[0] ?? word,
      w,
    );
    expect(await selectInZone(page, zone, exact)).toBe(true);
    const card = popover(page).getByTestId('lookup-card');
    await expect(card).toHaveAttribute('data-status', 'success');
    await card.getByTestId('srs-add').click();
    await expect(card.getByTestId('srs-saved')).toBeVisible();
    await closePopover(page);
  }
  if (REAL) {
    await expect.poll(() => created.length).toBe(5);
    expect(created.every((s) => s === 201)).toBe(true);
  } else {
    const cards = await page.evaluate(
      () =>
        Object.keys(
          (JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as { srsCards?: Record<string, unknown> })
            .srsCards ?? {},
        ).length,
    );
    expect(cards).toBe(5);
  }
  // Tải lại → tra lại từ đầu tiên → server báo đã lưu (saved: true)
  await page.reload();
  const first = page
    .locator('article [data-lookup]')
    .filter({ hasText: new RegExp(`\\b${words[0]}\\b`, 'i') })
    .first();
  const exact = await first.evaluate(
    (el, word) => (el.textContent ?? '').match(new RegExp(`\\b${word}\\b`, 'i'))?.[0] ?? word,
    words[0],
  );
  await selectInZone(page, first, exact);
  await expect(popover(page).getByTestId('srs-saved')).toHaveText('Đã có trong từ vựng');
});

test('Câu dài (> 4 từ) → dịch AI (nhãn AI dịch); tải lại → lần 2 dùng bản dịch có sẵn (cache)', async ({ page }) => {
  await toReview(page);
  const zone = page.locator('article [data-lookup]').first();
  // Đoạn dài nhất của đề không chứa ô trống
  const sentence = await zone.evaluate((el) => {
    const parts = (el.textContent ?? '').split(/_{3,}/).map((s) => s.trim().replace(/[.?!]$/, ''));
    return parts.sort((a, b) => b.length - a.length)[0] ?? '';
  });
  expect(sentence.split(/\s+/).length).toBeGreaterThan(4);
  await selectInZone(page, zone, sentence);
  const card = popover(page).getByTestId('lookup-card');
  await expect(popover(page)).toHaveAttribute('data-mode', 'sentence');
  await expect(card).toHaveAttribute('data-status', 'success');
  await expect(card).toHaveAttribute('data-source', 'ai');
  await expect(card.getByTestId('lookup-translation')).not.toBeEmpty();
  await expect(card.getByTestId('lookup-ai-badge')).toHaveText(/AI dịch/);
  // Lần đầu: sinh mới (mock luôn là lần đầu; API thật dùng cache chung ai.translation_cache nên lần chạy trước/dự án khác
  // có thể đã dịch câu này → chỉ ghi nhận)
  if (REAL)
    test
      .info()
      .annotations.push({ type: 'first-lookup-cached', description: (await card.getAttribute('data-cached')) ?? '' });
  else await expect(card).toHaveAttribute('data-cached', 'false');
  await expect(card.getByTestId('srs-add')).toHaveCount(0);
  await closePopover(page);

  await page.reload();
  const again = page.locator('article [data-lookup]').first();
  await selectInZone(page, again, sentence);
  const card2 = popover(page).getByTestId('lookup-card');
  await expect(card2).toHaveAttribute('data-cached', 'true');
  await expect(card2.getByTestId('lookup-cached')).toHaveText('Bản dịch có sẵn');
});

test('Practice: tra từ trong đề khi luyện tập; Exam Mode: nhấp đúp không mở popover', async ({ page }) => {
  await startAsGuest(page);
  await startTestSet(page, PART5, 'practice');
  const stem = page.getByTestId('question-card').locator('[data-lookup]').first();
  const word = await stem.evaluate((el) => (el.textContent ?? '').match(/\b[A-Za-z]{6,}\b/)?.[0] ?? '');
  expect(word).not.toBe('');
  await selectInZone(page, stem, word, 'dblclick');
  await expect(popover(page).getByTestId('lookup-card')).toHaveAttribute('data-status', 'success');
  await closePopover(page);

  // Exam Mode (đề khác – đề Part 5 đang có lượt luyện dở): đoạn văn/đề bài không mở tra từ
  await startTestSet(page, READING, 'exam');
  const examZone = page.getByTestId('attempt-runner').locator('[data-lookup]').first();
  const w2 = await examZone.evaluate((el) => (el.textContent ?? '').match(/\b[A-Za-z]{6,}\b/)?.[0] ?? '');
  expect(w2).not.toBe('');
  await selectInZone(page, examZone, w2, 'dblclick');
  await page.waitForTimeout(600);
  await expect(popover(page)).toHaveCount(0);
});
