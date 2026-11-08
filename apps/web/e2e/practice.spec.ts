import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Sprint 2 – Luyện theo Part + tìm theo từ khoá; đầu-cuối CMS soạn → duyệt 2 lớp → phát hành → web hiển thị.
 * Phần CMS chỉ chạy khi có CMS + API thật: E2E_REAL_API=1 E2E_CMS_URL=http://localhost:3001 (tài khoản seed CMS).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e.cleared')) return;
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('allingo.')) window.localStorage.removeItem(k);
    window.sessionStorage.setItem('e2e.cleared', '1');
  });
});

async function startAsGuest(page: Page) {
  await page.goto('/vi');
  await page.getByRole('button', { name: 'Luyện thử miễn phí' }).first().click();
  await expect(page).toHaveURL(/dashboard/);
}

test('trang Luyện tập: từ khoá không khớp báo không tìm thấy; Part 5 không từ khoá tạo lượt luyện', async ({ page }) => {
  await startAsGuest(page);
  await page.goto('/vi/toeic/practice');
  await page.getByTestId('practice-keyword').fill('zzqqxxnotfound');
  await page.getByTestId('practice-start').click();
  await expect(page.getByTestId('practice-error')).toContainText('Không tìm thấy');
  await page.getByTestId('practice-keyword').fill('');
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('option-A')).toBeVisible();
});

test('Luyện tập (drill): chọn đáp án → hiện đúng/sai, đáp án đúng và giải thích ngay; khoá đổi đáp án; tải lại vẫn còn', async ({ page }) => {
  await startAsGuest(page);
  // Gợi ý luyện từ màn Kết quả mở trang với ?section= → chọn sẵn Part
  await page.goto('/vi/toeic/practice?section=part6');
  await expect(page.getByTestId('practice-section')).toHaveValue('part6');
  await expect(page.getByTestId('practice-preset')).toBeVisible();
  await page.getByTestId('practice-section').selectOption('part5');
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('attempt-runner')).toHaveAttribute('data-mode', 'drill');
  // Không tính giờ, không đáp án trước khi chọn
  await expect(page.getByTestId('exam-clock')).toHaveCount(0);
  const card = page.getByTestId('question-card');
  await expect(card.getByTestId('practice-feedback')).toHaveCount(0);

  await card.getByTestId('option-A').click();
  const feedback = card.getByTestId('practice-feedback');
  await expect(feedback).toBeVisible();
  await expect(feedback).toHaveAttribute('data-correct', /^(true|false)$/);
  await expect(card.getByTestId('practice-correct-answer')).toContainText('Đáp án đúng:');
  // Đúng → A tô xanh; sai → A tô đỏ và đáp án đúng tô xanh
  const isCorrect = (await feedback.getAttribute('data-correct')) === 'true';
  await expect(card.getByTestId('option-A')).toHaveAttribute('data-state', isCorrect ? 'correct' : 'wrong');
  // Khoá: không đổi được đáp án (chuột lẫn phím tắt)
  await expect(card.getByTestId('option-B')).toBeDisabled();
  await page.keyboard.press('2');
  await expect(card.getByTestId('option-A')).toHaveAttribute('aria-checked', 'true');

  // Câu sau: phím tắt chọn đáp án cũng hiện phản hồi ngay
  await page.getByTestId('next-button').click();
  await expect(page.getByTestId('question-card')).toContainText('Câu 2/');
  await page.keyboard.press('3');
  await expect(page.getByTestId('question-card').getByTestId('practice-feedback')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('question-card')).toContainText('Câu 2/');
  await expect(page.getByTestId('question-card').getByTestId('practice-feedback')).toBeVisible();
  await expect(page.getByTestId('question-card').getByTestId('option-C')).toHaveAttribute('aria-checked', 'true');
});

const CMS = process.env.E2E_CMS_URL;
const CMS_PASSWORD = process.env.E2E_CMS_PASSWORD ?? 'Allingo@2026';

async function cmsLogin(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post(`${CMS}/api/users/login`, { data: { email, password: CMS_PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return ((await r.json()) as { token: string }).token;
}

async function cmsPatch(request: APIRequestContext, token: string, id: string, data: Record<string, unknown>) {
  const r = await request.patch(`${CMS}/api/questions/${id}`, { headers: { Authorization: `JWT ${token}` }, data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return ((await r.json()) as { doc: { status: string } }).doc;
}

test('CMS: editor soạn → AI kiểm tra → teacher duyệt 1 → admin duyệt 2 → web tìm thấy câu', async ({ page, request }) => {
  test.skip(!CMS || process.env.E2E_REAL_API !== '1', 'cần E2E_CMS_URL + E2E_REAL_API=1');
  const keyword = `ledger${Date.now().toString(36)}`;
  const editor = await cmsLogin(request, 'editor@allingo.dev');
  const created = await request.post(`${CMS}/api/questions`, {
    headers: { Authorization: `JWT ${editor}` },
    data: {
      program: 'toeic',
      sectionCode: 'part5',
      questionType: 'mcq_single',
      difficulty: 'B1',
      source: 'human',
      content: {
        type: 'mcq_single',
        stem: `The quarterly ${keyword} must be ______ to the auditors by Thursday.`,
        options: [
          { key: 'A', text: 'submit' },
          { key: 'B', text: 'submitted' },
          { key: 'C', text: 'submitting' },
          { key: 'D', text: 'submission' },
        ],
        answer_key: { correct: 'B' },
        explanation: { vi: 'Bị động "must be + V3".', en: 'Passive "must be + V3".' },
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = ((await created.json()) as { doc: { id: string } }).doc.id;

  const ai = await request.post(`${CMS}/api/questions/${id}/ai-check`, { headers: { Authorization: `JWT ${editor}` } });
  expect(ai.ok(), await ai.text()).toBeTruthy();
  expect(((await ai.json()) as { status: string }).status).toBe('ai_checked');
  expect((await cmsPatch(request, editor, id, { status: 'review1' })).status).toBe('review1');
  const teacher = await cmsLogin(request, 'teacher@allingo.dev');
  expect((await cmsPatch(request, teacher, id, { status: 'review2' })).status).toBe('review2');
  const admin = await cmsLogin(request, 'admin@allingo.dev');
  expect((await cmsPatch(request, admin, id, { status: 'published' })).status).toBe('published');

  await startAsGuest(page);
  await page.goto('/vi/toeic/practice');
  await page.getByTestId('practice-keyword').fill(keyword);
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  // Tìm kiếm có dung sai chính tả (Meilisearch) → câu của các lần chạy trước (`ledger<khác>`) có thể đứng trước: duyệt tối đa 10 câu
  await expect(page.getByTestId('question-card')).toBeVisible();
  for (let i = 0; i < 10 && !(await page.getByText(keyword).isVisible()); i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
  }
  await expect(page.getByText(keyword)).toBeVisible();
});
