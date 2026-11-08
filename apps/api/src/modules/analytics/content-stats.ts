/**
 * Thống kê câu hỏi cổ điển (CTT) – thuần, S12 (content.stats_nightly):
 *  - p-value = tỉ lệ trả lời đúng (độ khó thực tế; cao = dễ);
 *  - discrimination = point-biserial r_pb giữa đúng/sai của câu và điểm PHẦN CÒN LẠI của bài (tỉ lệ đúng các câu khác trong cùng
 *    attempt – "corrected item-total", tránh tự tương quan). r_pb là Pearson với biến nhị phân → SQL dùng corr(); hàm TS dưới đây
 *    là tham chiếu để test đối chiếu;
 *  - đề xuất retire/review theo ngưỡng (docs/analytics/events.md §Thống kê câu).
 */
export interface ItemObservation {
  correct: boolean;
  /** Điểm phần còn lại của bài (0–1) */
  rest: number;
}

/** Pearson giữa X (0/1) và Y; null khi thiếu biến thiên hoặc < 2 quan sát */
export function pointBiserial(obs: readonly ItemObservation[]): number | null {
  const n = obs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const o of obs) {
    sx += o.correct ? 1 : 0;
    sy += o.rest;
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const o of obs) {
    const dx = (o.correct ? 1 : 0) - mx;
    const dy = o.rest - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export const STATS_THRESHOLDS = {
  too_hard: 0.2,
  too_easy: 0.95,
  retire_discrimination: 0.1,
  review_discrimination: 0.2,
  review_open_reports: 3,
  retire_confirmed_reports: 5,
} as const;

export type Recommendation = 'retire' | 'review' | 'ok' | 'insufficient_data';

export function recommendQuestion(s: { n: number; p_value: number | null; discrimination: number | null; reports_open: number; reports_confirmed: number }, minN: number): { recommendation: Recommendation; reasons: string[] } {
  const t = STATS_THRESHOLDS;
  const retire: string[] = [];
  const review: string[] = [];
  if (s.reports_confirmed >= t.retire_confirmed_reports) retire.push('many_confirmed_reports');
  if (s.reports_open >= t.review_open_reports) review.push('many_open_reports');
  if (s.n >= minN) {
    if (s.discrimination !== null) {
      if (s.discrimination < 0) retire.push('negative_discrimination');
      else if (s.discrimination < t.retire_discrimination) retire.push('very_low_discrimination');
      else if (s.discrimination < t.review_discrimination) review.push('low_discrimination');
    }
    if (s.p_value !== null && s.p_value < t.too_hard) review.push('too_hard');
    if (s.p_value !== null && s.p_value > t.too_easy) review.push('too_easy');
  }
  if (retire.length) return { recommendation: 'retire', reasons: [...retire, ...review] };
  if (review.length) return { recommendation: 'review', reasons: review };
  return { recommendation: s.n >= minN ? 'ok' : 'insufficient_data', reasons: s.n >= minN ? [] : ['insufficient_data'] };
}

export function round(v: number | null, digits = 3): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
