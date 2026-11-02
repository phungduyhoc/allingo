import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 5 – giao diện AI: giải thích SSE trong Review (chữ hiện dần → nội dung có cấu trúc, "Giải thích có sẵn" khi cache,
 * đánh giá 👍/👎/Sai + ghi chú nhớ theo ai_task_id), lỗi AI + thử lại, vượt hạn mức (429 → còn 0 lượt, giờ reset giờ VN,
 * CTA nâng cấp → /pricing), chẩn đoán AI trên màn kết quả (Free: thẻ khoá; Pro: tạo bằng SSE → tải lại vẫn hiện).
 *
 * Mock: đề mini Part 5 `toeic-p5-mini-01` (10 câu), đề mini L&R `toeic-lr-mini-01` (20 câu) để có > 10 lượt giải thích.
 * API thật: đề Reading full `toeic-reading-full-01` (100 câu – nhiều câu chưa có cache giải thích); tài khoản Pro demo
 * `learner_pro@allingo.dev` / `Allingo@2026` (seed demo; mock tự tạo cùng thông tin đăng nhập).
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
const EXPLAIN_SET = { mock: 'toeic-p5-mini-01', real: 'toeic-reading-full-01' };
const QUOTA_SET = { mock: 'toeic-lr-mini-01', real: 'toeic-reading-full-01' };
const PRO = { email: 'learner_pro@allingo.dev', password: 'Allingo@2026' };
const FREE_EXPLAIN_LIMIT = 10;

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function submitNow(page: Page): Promise<void> {
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByTestId('result-page')).toBeVisible();
}

/** API thật: điền đáp án ngẫu nhiên cho mọi câu (mở rộng tập khoá cache question_version × chosen_option chưa ai hỏi) */
async function randomAnswersViaApi(req: APIRequestContext, attemptId: string): Promise<void> {
  const res = await req.get(`${API}/attempts/${attemptId}`);
  expect(res.ok()).toBe(true);
  const attempt = (await res.json()) as { questions: { question_id: string; question_type: string }[] };
  const keys = ['A', 'B', 'C', 'D'];
  const answers = attempt.questions
    .filter((q) => q.question_type === 'mcq_single')
    .map((q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: keys[Math.floor(Math.random() * keys.length)] } }));
  for (let i = 0; i < answers.length; i += 100) {
    const put = await req.put(`${API}/attempts/${attemptId}/answers`, { data: { answers: answers.slice(i, i + 100) } });
    expect(put.status()).toBeLessThan(300);
  }
}

/** Thẻ Review đầu tiên CHƯA có giải thích cache (còn nút "Giải thích") → bấm sẽ sinh mới (SSE) */
async function firstUncachedItem(page: Page): Promise<string | null> {
  await expect(page.locator('article[data-testid^="review-item-"]').first()).toBeVisible();
  const item = page.locator('article[data-testid^="review-item-"]').filter({ has: page.getByTestId('explain-button') }).first();
  if ((await item.count()) === 0) return null;
  return item.getAttribute('data-testid');
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/vi/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/);
}

test('Review → Giải thích (stream) → 👍 + ghi chú → tải lại: "Giải thích có sẵn", lựa chọn được nhớ, đổi đánh giá = cập nhật', async ({ page }) => {
  test.setTimeout(120_000);
  await startAsGuest(page);
  // Dashboard: "Còn x lượt giải thích hôm nay" từ /me/entitlements
  await expect(page.getByTestId('quota-left-ai_explain')).toContainText(`Còn ${FREE_EXPLAIN_LIMIT} lượt giải thích hôm nay`);
  await expect(page.getByTestId('quota-left-ai_explain').getByTestId('quota-reset')).toContainText('(giờ Việt Nam)');

  const attemptId = await startTestSet(page, EXPLAIN_SET, 'exam');
  if (REAL) await randomAnswersViaApi(page.request, attemptId);
  await submitNow(page);
  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  const meter = page.getByTestId('quota-left-ai_explain');
  await expect(meter).toBeVisible();
  const before = Number(await meter.getAttribute('data-remaining'));

  const testId = await firstUncachedItem(page);
  expect(testId, 'cần một câu chưa có giải thích cache').not.toBeNull();
  const card = page.getByTestId(testId!);
  // API thật đi qua mạng (quan sát được request); mock chạy trong trình duyệt → kiểm tra bằng trạng thái mock (localStorage)
  const explainResponse = REAL ? page.waitForResponse((r) => r.url().endsWith('/ai/explain') && r.request().method() === 'POST') : null;
  const feedbackBodies: { ai_task_id: string; rating: string; comment?: string }[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/ai/feedback') && r.method() === 'POST') feedbackBodies.push(r.postDataJSON() as (typeof feedbackBodies)[number]);
  });
  await card.getByTestId('explain-button').click();
  const panel = card.getByTestId('explanation');
  if (REAL) {
    // API thật (MockProvider stream rất nhanh): xác nhận phản hồi là SSE start → delta → result → done
    const res = (await explainResponse)!;
    expect(res.headers()['content-type']).toContain('text/event-stream');
    const body = await res.text();
    for (const ev of ['event: start', 'event: delta', 'event: result', 'event: done']) expect(body).toContain(ev);
  } else {
    // Mock: delta là mảnh JSON của structured output → chữ (why_correct…) hiện dần trước khi có result
    await expect(panel).toHaveAttribute('data-status', 'streaming');
    await expect.poll(async () => ((await card.getByTestId('explain-stream').textContent()) ?? '').trim().length, { intervals: [50] }).toBeGreaterThan(10);
    expect((await card.getByTestId('explain-stream').textContent()) ?? '').not.toContain('{');
  }
  await expect(panel).toHaveAttribute('data-status', 'done');
  await expect(panel).toHaveAttribute('data-cached', 'false');
  await expect(panel).toContainText('Vì sao đáp án đúng');
  await expect(panel).toContainText('Dấu hiệu nhận biết');
  // Sinh mới trừ một lượt (server); thanh hạn mức làm mới từ /me/entitlements
  await expect(meter).toHaveAttribute('data-remaining', String(before - 1));

  // 👍 → cảm ơn; ghi chú tuỳ chọn gửi lại cùng ai_task_id
  await card.getByTestId('feedback-helpful').click();
  await expect(card.getByTestId('feedback-helpful')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByTestId('feedback-status')).toHaveText('Cảm ơn phản hồi của bạn.');
  await card.getByTestId('feedback-note-toggle').click();
  await card.getByTestId('feedback-note').fill('Giải thích rõ, thêm ví dụ thì tốt hơn.');
  await card.getByTestId('feedback-note-submit').click();
  await expect(card.getByTestId('feedback-status')).toHaveText('Đã gửi ghi chú. Cảm ơn bạn!');

  // Tải lại: Review kèm giải thích cache → hiện ngay, nhãn "Giải thích có sẵn", 👍 vẫn được chọn
  await page.reload();
  const again = page.getByTestId(testId!);
  await expect(again.getByTestId('explanation')).toHaveAttribute('data-cached', 'true');
  await expect(again.getByTestId('explain-cached-badge')).toHaveText('Giải thích có sẵn');
  await expect(again.getByTestId('feedback-helpful')).toHaveAttribute('aria-pressed', 'true');
  // Đổi sang "Sai" → gửi lại cho CÙNG ai_task_id (API cập nhật, updated: true), giữ ghi chú
  await again.getByTestId('feedback-wrong').click();
  await expect(again.getByTestId('feedback-wrong')).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByTestId('feedback-status')).toHaveText('Đã cập nhật đánh giá.');
  if (REAL) {
    await expect.poll(() => feedbackBodies.length).toBe(3);
    expect(new Set(feedbackBodies.map((b) => b.ai_task_id)).size).toBe(1);
    expect(feedbackBodies.map((b) => b.rating)).toEqual(['helpful', 'helpful', 'wrong']);
    expect(feedbackBodies[2]!.comment).toBe('Giải thích rõ, thêm ví dụ thì tốt hơn.');
  } else {
    // ai.feedback giả lập: đúng MỘT bản ghi (cập nhật, không tạo mới) với đánh giá mới + ghi chú cũ
    const fb = await page.evaluate(() => (JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as { feedback?: Record<string, { rating: string; comment: string | null }> }).feedback ?? {});
    expect(Object.values(fb)).toEqual([expect.objectContaining({ rating: 'wrong', comment: 'Giải thích rõ, thêm ví dụ thì tốt hơn.' })]);
  }
  // Nhớ lựa chọn theo ai_task_id trên thiết bị
  const memory = await page.evaluate(() => (JSON.parse(window.localStorage.getItem('allingo.ai-feedback.v1') ?? '{}') as { tasks?: Record<string, { rating: string }> }).tasks ?? {});
  expect(Object.values(memory).map((r) => r.rating)).toEqual(['wrong']);
  // Lượt trúng cache không trừ hạn mức
  await expect(page.getByTestId('quota-left-ai_explain')).toHaveAttribute('data-remaining', String(before - 1));
});

test('Lỗi AI giữa luồng (error ai_timeout) → thông báo i18n + Thử lại thành công (mock)', async ({ page }) => {
  test.skip(REAL, 'Cần kịch bản lỗi của mock (window.__ALLINGO_MOCK_AI_FAIL__)');
  await startAsGuest(page);
  await startTestSet(page, EXPLAIN_SET, 'exam');
  await submitNow(page);
  await page.getByTestId('review-link').click();
  const card = page.getByTestId('review-item-1');
  await page.evaluate(() => {
    (window as unknown as { __ALLINGO_MOCK_AI_FAIL__: string }).__ALLINGO_MOCK_AI_FAIL__ = 'ai_timeout';
  });
  await card.getByTestId('explain-button').click();
  await expect(card.getByTestId('explain-error')).toHaveAttribute('data-code', 'ai_timeout');
  await expect(card.getByTestId('explain-error')).toContainText('AI phản hồi quá lâu');
  // Quota đã hoàn → vẫn còn đủ 10 lượt
  await expect(page.getByTestId('quota-left-ai_explain')).toHaveAttribute('data-remaining', String(FREE_EXPLAIN_LIMIT));
  await card.getByTestId('explain-retry').click();
  await expect(card.getByTestId('explanation')).toHaveAttribute('data-status', 'done');
  await expect(card.getByTestId('explanation')).toContainText('Vì sao đáp án đúng');
});

test('Vượt hạn mức giải thích (lần 11 trong ngày) → 429: còn 0 lượt, giờ reset (giờ VN), CTA nâng cấp → /pricing', async ({ page }) => {
  test.setTimeout(180_000);
  await startAsGuest(page);
  // Practice: đề L&R mock không có màn "Bắt đầu nghe" chặn nút nộp; giải thích được phép (không phải Exam Mode)
  const attemptId = await startTestSet(page, QUOTA_SET, REAL ? 'exam' : 'practice');
  if (REAL) await randomAnswersViaApi(page.request, attemptId);
  await submitNow(page);
  await page.getByTestId('review-link').click();
  await expect(page.locator('article[data-testid^="review-item-"]').first()).toBeVisible();

  if (REAL) {
    // Dùng hết 10 lượt bằng API (cùng cookie phiên khách) cho các câu chưa có cache – lượt trúng cache không bị tính
    const review = (await (await page.request.get(`${API}/attempts/${attemptId}/review`)).json()) as {
      items: { question: { question_version_id: string; order_no: number }; your_answer: { selected?: string } | null; explanation: unknown }[];
    };
    const uncached = review.items.filter((i) => !i.explanation);
    // Chừa lại câu cuối cùng chưa cache để bấm trên giao diện
    const ui = uncached.pop();
    test.skip(!ui || uncached.length < FREE_EXPLAIN_LIMIT, 'Không đủ câu chưa có cache giải thích trên API thật (đã dùng hết qua các lần chạy trước)');
    let consumed = 0;
    for (const it of uncached) {
      const r = await page.request.post(`${API}/ai/explain`, { data: { question_version_id: it.question.question_version_id, chosen_option: it.your_answer?.selected, attempt_id: attemptId } });
      if (r.status() === 429) break;
      expect(r.status()).toBe(200);
      if ((r.headers()['content-type'] ?? '').includes('text/event-stream')) consumed++;
      if (consumed >= FREE_EXPLAIN_LIMIT) break;
    }
    expect(consumed).toBe(FREE_EXPLAIN_LIMIT);
    // 429 đúng hợp đồng: details.quota.remaining = 0 + resets_at (00:00 giờ VN)
    const over = await page.request.post(`${API}/ai/explain`, { data: { question_version_id: ui!.question.question_version_id, chosen_option: ui!.your_answer?.selected, attempt_id: attemptId } });
    expect(over.status()).toBe(429);
    const body = (await over.json()) as { error: { code: string; details: { quota: { remaining: number; limit: number; resets_at: string }; upgrade: boolean } } };
    expect(body.error.code).toBe('quota_exceeded');
    expect(body.error.details.quota).toMatchObject({ remaining: 0, limit: FREE_EXPLAIN_LIMIT });
    expect(new Date(body.error.details.quota.resets_at).getUTCHours()).toBe(17); // 00:00 Asia/Ho_Chi_Minh
    await page.reload();
    const card = page.getByTestId(`review-item-${ui!.question.order_no}`);
    await card.getByTestId('explain-button').click();
    await expectQuotaNotice(page, card);
    return;
  }

  // Mock: 10 lượt giải thích qua giao diện (mỗi câu một lượt sinh mới) rồi lượt 11 → 429
  const meter = page.getByTestId('quota-left-ai_explain');
  for (let n = 1; n <= FREE_EXPLAIN_LIMIT; n++) {
    const card = page.getByTestId(`review-item-${n}`);
    await card.getByTestId('explain-button').click();
    await expect(card.getByTestId('explanation')).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  }
  await expect(meter).toHaveAttribute('data-remaining', '0');
  await expect(meter).toContainText('Hết lượt giải thích hôm nay');
  const eleventh = page.getByTestId(`review-item-${FREE_EXPLAIN_LIMIT + 1}`);
  await eleventh.getByTestId('explain-button').click();
  await expectQuotaNotice(page, eleventh);
});

async function expectQuotaNotice(page: Page, card: ReturnType<Page['getByTestId']>): Promise<void> {
  const notice = card.getByTestId('explain-quota');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-remaining', '0');
  await expect(notice).toContainText('Hết lượt giải thích AI hôm nay');
  await expect(notice).toContainText(`${FREE_EXPLAIN_LIMIT}/${FREE_EXPLAIN_LIMIT}`);
  await expect(notice.getByTestId('quota-reset')).toHaveText('Lượt mới lúc 00:00 ngày mai (giờ Việt Nam)');
  // Toast chung cho 429 (một cái mỗi lúc) có nút Nâng cấp
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Hết lượt giải thích AI hôm nay' })).toBeVisible();
  await notice.getByTestId('upgrade-cta').click();
  await expect(page).toHaveURL(/\/vi\/pricing$/);
  await expect(page.getByTestId('pricing-page')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bảng giá');
}

test('Kết quả – Free: "Phân tích của AI" là thẻ khoá + CTA nâng cấp; chẩn đoán quy tắc S3 vẫn hiện', async ({ page }) => {
  await startAsGuest(page);
  await startTestSet(page, EXPLAIN_SET, 'exam');
  await submitNow(page);
  await expect(page.getByTestId('diagnosis-card')).toBeVisible();
  const ai = page.getByTestId('ai-diagnosis');
  await expect(ai).toHaveAttribute('data-state', 'locked');
  await expect(ai.getByTestId('ai-diagnosis-locked')).toContainText('Phân tích của AI dành cho gói Pro');
  await expect(ai.getByTestId('ai-diagnosis-generate')).toHaveCount(0);
  await expect(ai.getByTestId('upgrade-cta')).toHaveAttribute('href', '/vi/pricing');
});

test('Kết quả – Pro: tạo phân tích AI (SSE) → dạng sai, bằng chứng, 3 bước, câu tự kiểm tra → tải lại vẫn hiện', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PRO.email, PRO.password);
  if (REAL) {
    // Dọn bài đang làm của tài khoản demo (lần chạy trước bị ngắt): bài Exam chưa nộp khoá mọi AI (403 exam_mode_locked)
    const list = (await (await page.request.get(`${API}/me/attempts?status=in_progress&limit=100`)).json()) as { data: { id: string }[] };
    for (const a of list.data) await page.request.post(`${API}/attempts/${a.id}/submit`);
  }
  await startTestSet(page, EXPLAIN_SET, 'exam');
  for (const key of ['A', 'B', 'C']) {
    await page.getByTestId('question-card').getByTestId(`option-${key}`).click();
    await page.getByTestId('next-button').click();
  }
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await submitNow(page);

  const ai = page.getByTestId('ai-diagnosis');
  await expect(page.getByTestId('diagnosis-card')).toBeVisible();
  await expect(ai).toHaveAttribute('data-state', 'idle');
  await ai.getByTestId('ai-diagnosis-generate').click();
  if (!REAL) await expect(ai).toHaveAttribute('data-state', 'streaming');
  await expect(ai).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(ai.getByTestId('ai-diagnosis-top-error')).not.toBeEmpty();
  await expect(ai.getByTestId('ai-diagnosis-evidence').locator('li').first()).toBeVisible();
  await expect(ai.getByTestId('ai-diagnosis-why')).not.toBeEmpty();
  await expect(ai.getByTestId('ai-diagnosis-steps').locator('li')).toHaveCount(3);
  await expect(ai.getByTestId('ai-diagnosis-encouragement')).not.toBeEmpty();
  await ai.getByTestId('ai-check-option-0').click();
  await expect(ai.getByTestId('ai-check-feedback')).toBeVisible();

  const top = await ai.getByTestId('ai-diagnosis-top-error').textContent();
  await page.reload();
  const again = page.getByTestId('ai-diagnosis');
  await expect(again).toHaveAttribute('data-state', 'ready');
  await expect(again.getByTestId('ai-diagnosis-top-error')).toHaveText(top ?? '');
  await expect(again.getByTestId('ai-diagnosis-cached')).toBeVisible();
  await expect(again.getByTestId('ai-diagnosis-steps').locator('li')).toHaveCount(3);
});

test('Trang đề thi: "Đề đầy đủ còn y lượt tháng này" (Free)', async ({ page }) => {
  await startAsGuest(page);
  await page.goto('/vi/toeic/test-sets');
  const meter = page.getByTestId('quota-left-full_test');
  await expect(meter).toContainText(/Đề đầy đủ còn \d+ lượt tháng này/);
  await expect(meter.getByTestId('quota-reset')).toContainText('(giờ Việt Nam)');
});
