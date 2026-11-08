import { expect, type Locator, type Page } from '@playwright/test';
import { REAL } from './helpers';
import { apiCall } from './billing-helpers';

/**
 * Tiện ích E2E Sprint 9 (chẩn đoán, lộ trình, hôm nay, check-in, huy hiệu) – chạy cả mock lẫn API thật (E2E_REAL_API=1).
 * Ngày lộ trình là ngày lịch theo múi giờ người học: test chạy trình duyệt ở Asia/Ho_Chi_Minh và tạo lộ trình cùng múi giờ.
 */

export const TZ = 'Asia/Ho_Chi_Minh';

/** YYYY-MM-DD theo giờ Việt Nam (+ n ngày) */
export function vnDate(addDays = 0): string {
  const d = new Date(Date.now() + 7 * 3_600_000 + addDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Tạo lộ trình nhanh qua API (bỏ qua onboarding/chẩn đoán) – không ngày thi → 8 tuần từ hôm nay */
export async function createPlanViaApi(page: Page, body: Record<string, unknown> = {}): Promise<{ id: string; weeks: { id: string; week_no: number; load_minutes: number; budget_minutes: number; locked: boolean }[] }> {
  const r = await apiCall(page, 'POST', '/me/plan', { program: 'toeic', weekly_minutes: 300, study_days: [...ALL_DAYS], reminder_time: '19:00', timezone: TZ, ...body });
  expect(r.status, JSON.stringify(r.data).slice(0, 300)).toBe(201);
  return r.data as never;
}

/**
 * Làm hết bài chẩn đoán: mỗi màn chọn một đáp án rồi "Tiếp" cho tới màn kết quả. Mock: trả lời ĐÚNG (hook đáp án của mock) để
 * kiểm tra luật lên mức; API thật: chọn A. Trả về số câu đã làm và các mức đã thấy.
 */
export async function completeDiagnostic(page: Page, opts: { max?: number } = {}): Promise<{ answered: number; levels: Set<string>; planned: number }> {
  const levels = new Set<string>();
  let answered = 0;
  let planned = 0;
  // Có thể đã trả lời vài câu trước đó (tiếp tục bài dở) – đếm tiếp từ số câu hiện tại
  let startNo: number | null = null;
  for (let i = 0; i < (opts.max ?? 80); i++) {
    const q = page.getByTestId('diagnostic-question');
    const result = page.getByTestId('diagnostic-result');
    await expect(q.or(result)).toBeVisible({ timeout: 20_000 });
    if (await result.isVisible()) break;
    const qid = (await q.getAttribute('data-question-id'))!;
    const level = await page.getByTestId('diagnostic-level').getAttribute('data-level');
    if (level) levels.add(level);
    planned = Number(await page.getByTestId('diagnostic-progress').getAttribute('data-planned'));
    startNo ??= Number(await page.getByTestId('diagnostic-progress').getAttribute('data-number'));
    await expect(page.getByTestId('diagnostic-progress')).toHaveAttribute('data-number', String(startNo + answered));
    const key = REAL ? null : await page.evaluate((id) => (window as unknown as { __ALLINGO_MOCK__?: { diagnosticKey?: (x: string) => string | null } }).__ALLINGO_MOCK__?.diagnosticKey?.(id) ?? null, qid);
    const option = key ? q.getByTestId(`option-${key}`) : q.locator('[data-testid^="option-"]').first();
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    // Không bao giờ lộ đúng/sai từng câu
    await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
    await page.getByTestId('diagnostic-next').click();
    answered += 1;
    // Đọc DOM không chờ phần tử (câu hỏi có thể biến mất ngay khi màn kết quả hiện)
    await expect
      .poll(
        () =>
          page.evaluate((prev) => {
            if (document.querySelector('[data-testid="diagnostic-result"]')) return 'done';
            const el = document.querySelector('[data-testid="diagnostic-question"]');
            return el && el.getAttribute('data-question-id') !== prev ? 'next' : 'wait';
          }, qid),
        { timeout: 20_000 },
      )
      .not.toBe('wait');
  }
  await expect(page.getByTestId('diagnostic-result')).toBeVisible();
  return { answered: answered + (startNo ?? 1) - 1, levels, planned };
}

/** Task theo loại trong một vùng (danh sách hôm nay / ngày của tuần) */
export const taskOfType = (scope: Locator, type: string) => scope.locator(`[data-testid="plan-task"][data-task-type="${type}"]`);
