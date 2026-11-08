import { expect, test, type Page } from '@playwright/test';
import { adminApi, API } from './billing-helpers';
import { answerCurrent, freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * S11 – kill-switch `ff.ai.explain` (tiêu chí nghiệm thu): admin tắt cờ (`PUT /admin/flags/ff.ai.explain`) →
 *  (1) nút "Giải thích" còn hiện (cờ client cache ≤ 30 s) mà bấm → API 503 `feature_disabled` → thông điệp i18n
 *      `errors.feature_disabled` (toast + tại chỗ) và MỌI nút giải thích ẩn ngay (cờ được tắt trong cache + tải lại);
 *  (2) không thao tác gì → client tự làm mới `GET /flags` → nút biến mất trong < 60 s; bật lại → nút hiện lại < 60 s.
 * API thật: admin demo qua `adminApi()`; mock: `__ALLINGO_MOCK__.setFlag` (như PUT của admin). Cờ luôn được trả về trạng
 * thái ban đầu trong `finally` (cờ là toàn cục – khoảng tắt càng ngắn càng tốt).
 */

const FLAG = 'ff.ai.explain';
const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };
const ANSWERS = ['B', 'A', 'A'];

async function setFlag(page: Page, enabled: boolean): Promise<void> {
  if (REAL) {
    const admin = await adminApi();
    try {
      const res = await admin.put(`admin/flags/${FLAG}`, { data: { enabled } });
      expect(res.status(), await res.text()).toBe(200);
    } finally {
      await admin.dispose();
    }
    return;
  }
  await page.waitForFunction(() => !!(window as unknown as { __ALLINGO_MOCK__?: { setFlag?: unknown } }).__ALLINGO_MOCK__?.setFlag);
  await page.evaluate(([k, v]) => (window as unknown as { __ALLINGO_MOCK__: { setFlag: (k: string, v: boolean) => void } }).__ALLINGO_MOCK__.setFlag(k, v), [FLAG, enabled] as const);
}

/** Gọi explain như người dùng (cookie trang): API thật → page.request; mock → "máy chủ" giả trong trang */
async function explainStatus(page: Page, input: Record<string, unknown>): Promise<{ status: number; data: { error?: { code?: string; details?: Record<string, unknown> } } }> {
  if (REAL) {
    const res = await page.request.post(`${API}/ai/explain`, { data: input, headers: { Origin: 'http://localhost:3000' } });
    return { status: res.status(), data: (await res.json().catch(() => ({}))) as never };
  }
  return page.evaluate(
    async (body) => (window as unknown as { __ALLINGO_MOCK__: { request: (m: string, p: string, b?: unknown) => Promise<{ status: number; data: never }> } }).__ALLINGO_MOCK__.request('POST', '/ai/explain', body),
    input,
  );
}

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('kill-switch ff.ai.explain: 503 → thông điệp i18n + ẩn ngay; tự làm mới → ẩn < 60 s; bật lại → hiện lại', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Cờ toàn cục – chạy một lần (desktop)');
  test.setTimeout(240_000);
  await startAsGuest(page);
  await startTestSet(page, PART5, 'exam');
  for (let i = 0; i < ANSWERS.length; i++) {
    await answerCurrent(page, ANSWERS[i]!);
    await page.getByTestId('next-button').click();
  }
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  const attemptId = new URL(page.url()).pathname.split('/').at(-2)!;
  // Câu chưa có giải thích kèm sẵn (cache dùng chung) → có nút
  const buttons = page.getByTestId('explain-button');
  await expect(buttons.first()).toBeVisible();
  // Ghim câu theo phiên bản (locator có `has: nút` sẽ không còn khớp khi nút đã ẩn)
  const qv = await page.locator('[data-qv]').filter({ has: buttons }).first().getAttribute('data-qv');
  const item = page.locator(`[data-qv="${qv}"]`);

  let restored = false;
  try {
    // (1) Tắt cờ: nút còn trong cache client → bấm → 503 → thông điệp + mọi nút ẩn ngay
    await setFlag(page, false);
    if (await item.getByTestId('explain-button').isVisible()) {
      const t0 = Date.now();
      await item.getByTestId('explain-button').click();
      await expect(item.getByTestId('feature-disabled')).toBeVisible();
      await expect(item.getByTestId('feature-disabled')).toContainText('Tính năng này đang tạm tắt');
      await expect(page.getByText('Tính năng này đang tạm tắt. Vui lòng thử lại sau ít phút.').first()).toBeVisible();
      await expect(buttons).toHaveCount(0, { timeout: 5_000 });
      expect(Date.now() - t0).toBeLessThan(10_000);
    }
    // API vẫn chặn (server là nơi kiểm tra): 503 feature_disabled + message_key i18n
    const r = await explainStatus(page, { question_version_id: qv, attempt_id: attemptId, chosen_option: 'A' });
    expect(r.status).toBe(503);
    expect(r.data.error?.code).toBe('feature_disabled');
    expect(r.data.error?.details).toMatchObject({ flag: FLAG, message_key: 'errors.feature_disabled' });

    // Bật lại → client tự làm mới GET /flags (≤ 30 s) → nút hiện lại (< 60 s), không cần tải lại trang
    await setFlag(page, true);
    restored = true;
    let t = Date.now();
    await expect(buttons.first()).toBeVisible({ timeout: 60_000 });
    const reappearMs = Date.now() - t;
    expect(reappearMs).toBeLessThan(60_000);

    // (2) Tắt lại và KHÔNG thao tác → nút biến mất < 60 s
    await setFlag(page, false);
    restored = false;
    t = Date.now();
    await expect(buttons).toHaveCount(0, { timeout: 60_000 });
    const hideMs = Date.now() - t;
    expect(hideMs).toBeLessThan(60_000);
    test.info().annotations.push({ type: 'kill-switch', description: `ẩn sau ${Math.round(hideMs / 1000)} s, hiện lại sau ${Math.round(reappearMs / 1000)} s` });
  } finally {
    if (!restored) await setFlag(page, true);
  }
  // Bật lại → hiện lại
  await expect(buttons.first()).toBeVisible({ timeout: 60_000 });
});

test('GET /flags: công khai, cache ≤ 30 s, chỉ boolean của khoá công khai', async ({ page }) => {
  test.skip(!REAL, 'Hợp đồng API thật');
  const res = await page.request.get(`${API}/flags`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toMatch(/no-cache/);
  const body = (await res.json()) as { flags: Record<string, unknown>; ttl_sec: number };
  expect(body.ttl_sec).toBe(30);
  expect(Object.keys(body.flags)).toEqual(expect.arrayContaining(['ff.ai.explain', 'ff.ai.tutor', 'ff.billing.checkout', 'ff.learning.study_plan']));
  for (const v of Object.values(body.flags)) expect(typeof v).toBe('boolean');
  expect(Object.keys(body.flags)).not.toContain('ff.growth.beta_gate');
});
