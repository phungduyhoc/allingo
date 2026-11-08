import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL } from './helpers';
import { ADMIN, apiCall, loginViaUi, logoutViaUi, registerNewUser, currentUserId } from './billing-helpers';
import { setRoleViaApi } from './s12-helpers';
import { buildImportXlsx } from './xlsx-helper';

/**
 * B2 – công cụ sản xuất nội dung trong `/admin/content`: hàng chờ duyệt (lọc, xem trước có tab văn bản + kiểm tra tự động + cờ trùng,
 * phím tắt J/K/A/R/X, duyệt/từ chối/gửi duyệt hàng loạt có lý do, phân công reviewer), nhập Excel (tải mẫu → kiểm tra lỗi theo
 * dòng/cột → xác nhận → câu vào hàng chờ), AI soạn nháp cả đề (tiến độ → kết quả → hàng chờ lọc theo đề nháp → phát hành bị chặn).
 * Mock: dữ liệu hàng chờ seed sẵn; API thật: tạo câu riêng (TAG duy nhất) qua API rồi thao tác trên giao diện.
 */
const TAG = `e2e${Date.now().toString(36)}`;

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

async function openContent(page: Page, tab: 'queue' | 'import' | 'generate') {
  await page.goto(`/vi/admin/content?tab=${tab}`);
  await expect(page.getByTestId(`content-tab-${tab}`)).toHaveAttribute('data-state', 'active');
}

async function applyFilter(page: Page, values: Record<string, string>) {
  const bar = page.getByTestId('queue-filters');
  for (const [k, v] of Object.entries(values)) {
    const el = bar.getByTestId(`filter-${k}`);
    if ((await el.evaluate((e) => e.tagName)) === 'SELECT') await el.selectOption(v);
    else await el.fill(v);
  }
  await bar.getByTestId('filter-apply').click();
}

/** API thật: 3 câu nháp Part 5 (2 câu cùng đề bài → câu sau bị gắn cờ nghi trùng qua job lọc trùng) */
async function seedReal(page: Page): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, stem] of [`Queue ${TAG} the supplier ______ the order yesterday.`, `Queue ${TAG} the courier ______ the parcel on Monday.`, `Queue ${TAG} the courier ______ the parcel on Monday.`].entries()) {
    const r = await apiCall(page, 'POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: { type: 'mcq_single', stem, options: ['confirmed', 'confirms', 'confirming', 'confirm'].map((text, k) => ({ key: 'ABCD'[k], text: `${text} ${i}` })), answer_key: { correct: 'A' }, explanation: { vi: 'Quá khứ đơn.' } } });
    expect(r.status).toBe(201);
    ids.push((r.data as { id: string }).id);
  }
  return ids;
}

test('hàng chờ duyệt: lọc, xem trước, phím tắt, duyệt/từ chối hàng loạt có lý do, phân công', async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  if (REAL) await seedReal(page);
  await openContent(page, 'queue');
  const rows = page.getByTestId('queue-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId('queue-shortcuts')).toContainText('J/K');

  // Lọc câu nghi trùng → mọi hàng có cờ, khung xem trước hiện câu giống
  if (REAL) await applyFilter(page, { q: TAG });
  await applyFilter(page, { duplicate: 'true' });
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  for (const r of await rows.all()) await expect(r).toHaveAttribute('data-duplicate', 'true');
  await expect(page.getByTestId('preview-duplicate')).toHaveAttribute('data-flagged', 'true');
  await expect(page.getByTestId('preview-similar').first()).toBeVisible();
  await applyFilter(page, { duplicate: '' });

  if (!REAL) {
    // Passage bộ đôi trong khung xem trước: tab từng văn bản
    await applyFilter(page, { section: 'part7' });
    await expect(rows).toHaveCount(1);
    const tabs = page.getByTestId('preview-passage-tabs').getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await tabs.nth(1).click();
    await expect(page.getByTestId('preview-passage-tabs').getByTestId('passage-panel-2')).toBeVisible();
    await applyFilter(page, { section: '' });
    // Kiểm tra tự động: lỗi đáp án ngoài phương án hiển thị có nhãn
    await rows.filter({ hasText: 'Okafor' }).getByTestId('queue-row-open').click();
    await expect(page.getByTestId('auto-check-answer_key_not_in_options')).toHaveAttribute('data-level', 'error');
  }

  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(3);
  // Phím tắt J/K đổi câu đang xem (desktop – trên mobile vẫn chạy với bàn phím ngoài)
  await rows.first().getByTestId('queue-row-open').click();
  await expect(rows.first()).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('j');
  await expect(rows.nth(1)).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('k');
  await expect(rows.first()).toHaveAttribute('data-active', 'true');
  // X chọn câu đang xem
  await page.keyboard.press('x');
  await expect(page.getByTestId('queue-selected-count')).toContainText('Đã chọn 1 câu');
  await page.getByTestId('bulk-clear').click();

  // Gửi duyệt hàng loạt các câu nháp / AI đã kiểm (2 câu) → hộp xác nhận → kết quả
  await applyFilter(page, { status: REAL ? 'draft' : 'ai_checked' });
  const pick = rows.nth(0);
  const pick2 = rows.nth(1);
  await pick.getByTestId('queue-row-select').check();
  await pick2.getByTestId('queue-row-select').check();
  await expect(page.getByTestId('queue-selected-count')).toContainText('Đã chọn 2 câu');
  await page.getByTestId('bulk-submit').click();
  const dlg = page.getByTestId('queue-decision');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('queue-decision-confirm').click();
  await expect(page.getByText(/Đã xử lý 2\/2 câu/)).toBeVisible({ timeout: 20_000 });

  // Vòng 1: A duyệt câu đang xem; R từ chối (lý do bắt buộc)
  await applyFilter(page, { status: 'review1' });
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await rows.first().getByTestId('queue-row-open').click();
  await page.keyboard.press('a');
  await expect(page.getByText(/Đã xử lý 1\/1 câu/)).toBeVisible({ timeout: 20_000 });
  await expect(rows).toHaveCount(before - 1);
  await rows.first().getByTestId('queue-row-open').click();
  await page.keyboard.press('r');
  const rej = page.getByTestId('queue-decision');
  await expect(rej).toBeVisible();
  await expect(rej.getByTestId('queue-decision-confirm')).toBeDisabled();
  await rej.getByTestId('queue-decision-reason').fill('Đáp án B cũng đúng');
  await rej.getByTestId('queue-decision-confirm').click();
  await expect(page.getByText(/Đã xử lý 1\/1 câu/).first()).toBeVisible({ timeout: 20_000 });
  await expect(rows).toHaveCount(before - 2);

  // Phân công reviewer cho một câu (teacher/admin)
  await applyFilter(page, { status: '' });
  await rows.first().getByTestId('queue-row-select').check();
  const assignee = page.getByTestId('bulk-assignee');
  const option = await assignee.locator('option').nth(2).getAttribute('value');
  await assignee.selectOption(option ?? '');
  await page.getByTestId('bulk-assign').click();
  await expect(page.getByText(/Đã phân công 1 câu/)).toBeVisible();
  await expect(rows.first().getByTestId('queue-row-assignee')).toBeVisible();
  void isMobile;
});

test('nhập Excel: tải mẫu, kiểm tra lỗi theo dòng/cột, xác nhận nhập vào hàng chờ', async ({ page }) => {
  test.setTimeout(120_000);
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  await openContent(page, 'import');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('import-template').click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  // Dòng 1 tiêu đề, 2–3 ví dụ (bỏ qua), 4 hợp lệ, 5 lỗi (thiếu đề bài + đáp án lạ), 6 trùng dòng 4, 7–8 Part 7 dùng chung passage 2 văn bản
  const base = { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', difficulty: 'B1', option_a: 'unloads', option_b: 'unloading', option_c: 'unload', option_d: 'to unload', correct: 'A' };
  const file = buildImportXlsx([
    { ...base, import_key: 'VD-001', stem: 'Ví dụ 1' },
    { ...base, import_key: 'VD-002', stem: 'Ví dụ 2' },
    { ...base, stem: `The forklift driver at Kestrel Depot ______ the pallets before noon ${TAG}.` },
    { ...base, stem: '', correct: 'E' },
    { ...base, stem: `The forklift driver at Kestrel Depot ______ the pallets before noon ${TAG}.` },
    { ...base, section_code: 'part7', stem: `What is the purpose of the notice? ${TAG}`, passage_key: `PK-${TAG}`, passage_title: 'Notice + E-mail', passage_body: `[Notice]\nThe Orchid Lane museum opens at 8 A.M. ${TAG}.\n\n[E-mail]\nCan I book a tour at 8:30?` },
    { ...base, section_code: 'part7', stem: `What does the writer want to do? ${TAG}`, passage_key: `PK-${TAG}` },
  ]);
  await page.getByTestId('import-file').setInputFiles({ name: 'cau-hoi.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file });
  await page.getByTestId('import-check').click();
  const report = page.getByTestId('import-report');
  await expect(report).toHaveAttribute('data-dry-run', 'true', { timeout: 30_000 });
  await expect(report).toHaveAttribute('data-valid', '3');
  await expect(page.getByTestId('import-errors')).toContainText('2');
  await expect(page.locator('[data-testid="import-issue"][data-row="5"][data-column="correct"]')).toContainText('Giá trị không hợp lệ: E');
  await expect(page.locator('[data-testid="import-issue"][data-row="5"][data-column="stem"]')).toContainText('Bắt buộc nhập');
  await expect(page.locator('[data-testid="import-issue"][data-row="6"][data-column="stem"]')).toContainText('Trùng dòng 4');
  await page.getByTestId('import-confirm').click();
  await expect(report).toHaveAttribute('data-created', '3', { timeout: 30_000 });
  await expect(page.getByTestId('import-committed')).toContainText('Đã nhập 3 câu');
  await page.getByTestId('import-open-queue').click();
  await expect(page.getByTestId('content-tab-queue')).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('queue-row').first()).toBeVisible();
});

test('AI soạn nháp cả đề: tiến độ → kết quả → hàng chờ lọc theo đề nháp → phát hành bị chặn khi chưa duyệt', async ({ page }) => {
  test.setTimeout(150_000);
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  await openContent(page, 'generate');
  for (const p of ['part6', 'part7']) await page.getByTestId(`draft-count-${p}`).fill('');
  await page.getByTestId('draft-count-part5').fill('2');
  await expect(page.getByTestId('draft-total')).toContainText('Tổng 2 câu');
  await page.getByTestId('draft-title').fill(`Đề nháp ${TAG}`);
  await page.getByTestId('draft-topic-travel').click();
  await expect(page.getByTestId('draft-topic-travel')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('draft-start').click();
  const job = page.getByTestId('draft-job');
  await expect(job).toHaveAttribute('data-status', 'completed', { timeout: 60_000 });
  await expect(page.getByTestId('draft-result')).toHaveAttribute('data-created', '2');
  await page.getByTestId('draft-publish').click();
  await expect(page.getByText(/Chưa phát hành được: 2 câu/)).toBeVisible();
  await page.getByTestId('draft-open-queue').click();
  await expect(page.getByTestId('queue-test-set')).toBeVisible();
  const rows = page.getByTestId('queue-row');
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) await expect(r).toHaveAttribute('data-source', 'ai');
});

test('biên tập viên (editor): chỉ thấy công cụ nội dung; học viên bị chặn', async ({ page, isMobile }) => {
  test.skip(!REAL, 'Cấp vai trò editor qua API superadmin – chỉ API thật');
  test.skip(isMobile, 'Một lần (desktop)');
  test.setTimeout(120_000);
  await registerNewUser(page, 'editor');
  await page.goto('/vi/admin/content');
  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  const id = await currentUserId(page);
  await setRoleViaApi(id, 'editor', 'grant');
  // JWT mới mang vai trò: đăng xuất → đăng nhập lại
  const email = (await apiCall(page, 'GET', '/me')).data as { email: string };
  await logoutViaUi(page);
  await loginViaUi(page, email.email);
  await expect(page.getByTestId('nav-content-admin')).toBeVisible();
  await page.goto('/vi/admin/content');
  await expect(page.getByTestId('admin-ops')).toHaveAttribute('data-content-only', 'true');
  await expect(page.getByTestId('content-tab-queue')).toBeVisible();
  await expect(page.getByTestId('content-tab-import')).toBeVisible();
  await expect(page.getByTestId('content-tab-reports')).toHaveCount(0);
  await expect(page.getByTestId('admin-nav-users')).toHaveCount(0);
  // Editor không phân công được reviewer (ẩn ô phân công)
  await expect(page.getByTestId('bulk-assignee')).toHaveCount(0);
});
