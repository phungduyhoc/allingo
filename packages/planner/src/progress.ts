import { daysBetween, datesInRange } from './dates.js';
import type { PlanTaskType } from './types.js';

/** Task tối thiểu để tính tiến độ */
export interface ProgressTask {
  id: string;
  due_date: string;
  task_type: PlanTaskType;
  est_minutes: number;
  status: 'pending' | 'done' | 'skipped' | 'expired';
}

export type DayStatus = 'done' | 'partial' | 'pending' | 'rest';

/** Trạng thái từng ngày của tuần (PlanWeek.days): rest = không có việc; done = mọi việc (trừ skipped) xong; partial = có việc xong */
export function dayStatuses<T extends ProgressTask>(start: string, end: string, tasks: readonly T[]): Array<{ date: string; status: DayStatus; tasks: T[] }> {
  return datesInRange(start, end).map((date) => {
    const list = tasks.filter((x) => x.due_date === date);
    const counted = list.filter((x) => x.status !== 'skipped');
    const done = counted.filter((x) => x.status === 'done').length;
    const status: DayStatus = !counted.length ? 'rest' : done === counted.length ? 'done' : done > 0 ? 'partial' : 'pending';
    return { date, status, tasks: list };
  });
}

/** % hoàn thành tuần theo phút (bỏ qua task skipped) */
export function weekProgress(tasks: readonly ProgressTask[]): { total_minutes: number; done_minutes: number; pct: number } {
  const counted = tasks.filter((x) => x.status !== 'skipped');
  const total = counted.reduce((a, x) => a + x.est_minutes, 0);
  const done = counted.filter((x) => x.status === 'done').reduce((a, x) => a + x.est_minutes, 0);
  return { total_minutes: total, done_minutes: done, pct: total ? Math.round((done / total) * 1000) / 10 : 0 };
}

export type ForecastStatus = 'not_started' | 'on_track' | 'slightly_behind' | 'behind';

/** Ngưỡng dự báo theo tỉ lệ phút đã xong / phút đến hạn */
export const FORECAST_THRESHOLDS = { on_track: 0.8, slightly_behind: 0.5 } as const;

/**
 * Dự báo "đúng hướng/chậm" theo QUY TẮC (dự báo điểm bằng mô hình ở GĐ4): so phút đã hoàn thành với phút ĐẾN HẠN (task có ngày
 * < hôm nay, cộng task hôm nay đã xong). ≥ 80 % đúng hướng, ≥ 50 % hơi chậm, còn lại chậm; chưa có gì đến hạn → not_started.
 */
export function forecastStatus(tasks: readonly ProgressTask[], today: string): { status: ForecastStatus; due_minutes: number; done_minutes: number; ratio: number | null } {
  const due = tasks.filter((x) => x.status !== 'skipped' && (x.due_date < today || (x.due_date === today && x.status === 'done')));
  const dueMinutes = due.reduce((a, x) => a + x.est_minutes, 0);
  const doneMinutes = due.filter((x) => x.status === 'done').reduce((a, x) => a + x.est_minutes, 0);
  if (!dueMinutes) return { status: 'not_started', due_minutes: 0, done_minutes: 0, ratio: null };
  const ratio = Math.round((doneMinutes / dueMinutes) * 1000) / 1000;
  const status: ForecastStatus = ratio >= FORECAST_THRESHOLDS.on_track ? 'on_track' : ratio >= FORECAST_THRESHOLDS.slightly_behind ? 'slightly_behind' : 'behind';
  return { status, due_minutes: dueMinutes, done_minutes: doneMinutes, ratio };
}

/** Tiến độ thời gian tới ngày thi (thanh tiến độ) */
export function examProgress(startDate: string, examDate: string | null, today: string): { pct: number | null; days_left: number | null; days_total: number | null } {
  if (!examDate) return { pct: null, days_left: null, days_total: null };
  const total = Math.max(1, daysBetween(startDate, examDate));
  const elapsed = Math.max(0, Math.min(total, daysBetween(startDate, today)));
  return { pct: Math.round((elapsed / total) * 1000) / 10, days_left: Math.max(0, daysBetween(today, examDate)), days_total: total };
}

/** Ưu tiên khi chỉ có ít thời gian: ôn từ vựng → luyện Part → luyện tính giờ → bài học → còn lại (full test không vừa 15′) */
const QUICK_PRIORITY: Partial<Record<PlanTaskType, number>> = { vocab_review: 0, review_errors: 1, part_drill: 2, timed_drill: 3, grammar: 4, lesson: 4, checkin: 5 };

/**
 * Gợi ý "nếu chỉ có 15 phút": chọn tham lam theo ưu tiên trong các task pending (hôm nay trước, rồi quá hạn), tổng ≤ `limit`.
 * Không có task nào vừa → rút gọn task luyện đầu tiên còn lại về `limit` phút (`shortened = true`, vd luyện 5 câu thay 10).
 */
export function quickSuggestion<T extends ProgressTask>(tasks: readonly T[], limit = 15): { minutes: number; items: Array<{ task: T; est_minutes: number; shortened: boolean }> } {
  const pending = tasks.filter((x) => x.status === 'pending' && x.task_type !== 'full_test');
  const ordered = [...pending].sort((a, b) => (QUICK_PRIORITY[a.task_type] ?? 9) - (QUICK_PRIORITY[b.task_type] ?? 9) || b.due_date.localeCompare(a.due_date) || a.est_minutes - b.est_minutes);
  const items: Array<{ task: T; est_minutes: number; shortened: boolean }> = [];
  let used = 0;
  for (const x of ordered) {
    if (x.task_type === 'checkin') continue;
    if (used + x.est_minutes <= limit) {
      items.push({ task: x, est_minutes: x.est_minutes, shortened: false });
      used += x.est_minutes;
    }
  }
  const hasPractice = items.some((x) => x.task.task_type !== 'vocab_review');
  if (!hasPractice) {
    const drill = ordered.find((x) => x.task_type !== 'vocab_review' && x.task_type !== 'checkin' && !items.some((i) => i.task.id === x.id));
    if (drill && limit - used >= 5) {
      items.push({ task: drill, est_minutes: limit - used, shortened: true });
      used = limit;
    }
  }
  return { minutes: used, items };
}
