import { expect, test } from '@playwright/test';
import { answerCurrent, freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Dashboard đầy đủ + Thống kê (S10): người mới → KPI rỗng hợp lý, dự báo "Ước tính sơ bộ" + cần dữ liệu, cộng đồng nêu lý do;
 * làm đề mini Part 5 (sai vài câu) → điểm ước tính, độ chính xác theo Part (bảng + biểu đồ tải lười), lỗi cần ôn, từ đến hạn,
 * tóm tắt tuần, dự báo có điểm; /toeic/stats có bảng kỹ năng con + phút/tuần. Biểu đồ (recharts) chỉ nạp khi cần.
 */

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

const ANSWERS = ['B', 'A', 'A', 'A', 'B', 'A', 'B', 'B', 'A', 'A'];

test('dashboard: trạng thái người mới → sau một đề mini có điểm, độ chính xác theo Part, lỗi cần ôn, dự báo sơ bộ', async ({ page }) => {
  test.setTimeout(REAL ? 180_000 : 120_000);
  await startAsGuest(page);

  // Người mới
  await expect(page.getByTestId('kpi-streak')).toBeVisible();
  await expect(page.getByTestId('forecast-label')).toHaveText('Ước tính sơ bộ');
  await expect(page.getByTestId('forecast-recommendation')).toContainText('bài chẩn đoán');
  await expect(page.getByTestId('community-card')).toHaveAttribute('data-reason', 'no_estimate');
  await expect(page.getByTestId('score-empty')).toBeVisible();
  await expect(page.getByTestId('dashboard-errors')).toContainText('0');
  await expect(page.getByTestId('dashboard-vocab-start')).toHaveText('Thêm bộ từ');

  // Một đề mini Part 5: 7 câu đầu theo đáp án mẫu (mock: đúng), 3 câu cuối chọn D (sai)
  await startTestSet(page, { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' }, 'exam');
  for (let i = 0; i < 10; i++) {
    await answerCurrent(page, i < 7 ? ANSWERS[i]! : 'D');
    if (i < 9) await page.getByTestId('next-button').click();
  }
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 30_000 });
  // Số câu đúng thực tế (seed API có thể khác đáp án mock) → độ chính xác Part 5 và số lỗi kỳ vọng
  const raw = (await page.getByTestId('raw-score').textContent()) ?? '';
  const correct = Number(/(\d+)\s*\/\s*10/.exec(raw)?.[1] ?? NaN);
  expect(correct).toBeGreaterThanOrEqual(0);
  const wrong = 10 - correct;

  await page.goto('/vi/toeic/dashboard');
  // API S12: điểm ước tính hiện tại / dự báo / phân vị chỉ tính từ bài có thang TỔNG – đề mini Part 5 chỉ có thang Reading 5–495
  // (score_history ghi `part: reading`) → chưa có ước tính tổng (mock S12 bám API). Giao diện S12 (SPEC-ISSUES S142): thẻ KPI hiện
  // điểm Reading gần nhất /495 + nói rõ cần đề có cả Listening và Reading để có điểm tổng
  await expect(page.getByTestId('kpi-errors')).toContainText(String(wrong), { timeout: 20_000 });
  await expect(page.getByTestId('estimate-skill')).toContainText(/Gần nhất: Reading \d+\/495/);
  await expect(page.getByTestId('estimate-skill')).toContainText('cần đề có cả Listening và Reading');
  await expect(page.getByTestId('score-empty')).toContainText('Mới có một điểm ước tính');
  const acc = page.getByTestId('accuracy-table');
  await expect(acc.locator('tr[data-key="part5"]')).toContainText(`${correct * 10}%`);
  await expect(page.getByTestId('chart-accuracy')).toBeVisible();
  await expect(page.getByTestId('dashboard-errors')).toContainText(String(wrong));
  await expect(page.getByTestId('kpi-errors')).toContainText(String(wrong));
  await expect(page.getByTestId('forecast-recommendation')).toContainText('bài chẩn đoán');
  await expect(page.getByTestId('forecast-label')).toHaveText('Ước tính sơ bộ');
  // Cộng đồng: chưa có ước tính tổng → no_estimate
  await expect(page.getByTestId('community-card')).toHaveAttribute('data-reason', 'no_estimate');
  await expect(page.getByTestId('week-summary')).toContainText('1 bài làm');

  // Lỗi cần ôn → sổ lỗi
  await page.getByTestId('dashboard-errors-link').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/errors$/);
  await expect(page.getByTestId('error-entry')).toHaveCount(wrong);

  // Thống kê chi tiết
  await page.goto('/vi/toeic/stats');
  await expect(page.getByTestId('stats-page')).toBeVisible();
  await expect(page.getByTestId('accuracy-table').locator('tr[data-key="part5"]')).toContainText(`${correct * 10}%`);
  await expect(page.getByTestId('subskill-table').locator('tr').first()).toBeVisible();
  await expect(page.getByTestId('stats-errors-by-kind').locator('li')).not.toHaveCount(0);
});
