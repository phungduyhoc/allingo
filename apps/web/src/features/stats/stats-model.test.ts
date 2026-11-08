import { describe, expect, it } from 'vitest';
import type { Stats } from '@allingo/schemas';
import { accuracyRows, forecastView, latestSkillScore, percentileValue, scoreSeries, weekSummary } from './stats-model';

const cell = (correct: number, total: number, accuracy: number | null) => ({ correct, total, accuracy });

describe('mô hình thống kê', () => {
  it('độ chính xác theo Part: % từ API (0–100), thứ tự part1…part7, chênh lệch', () => {
    const rows = accuracyRows({ part7: { current: cell(3, 4, 75), previous: cell(0, 0, null), delta: null }, part2: { current: cell(1, 4, 25), previous: cell(2, 4, 50), delta: -25 }, part5: { current: cell(2, 3, null), previous: cell(1, 2, null), delta: null } });
    expect(rows.map((r) => r.key)).toEqual(['part2', 'part5', 'part7']);
    expect(rows[0]).toEqual({ key: 'part2', current: 25, previous: 50, delta: -25, total: 4 });
    expect(rows[1]).toMatchObject({ current: 67, previous: 50, delta: 17 });
    expect(rows[2]).toMatchObject({ current: 75, previous: null, delta: null });
    expect(accuracyRows(undefined)).toEqual([]);
  });

  it('điểm theo thời gian: ưu tiên score_history (sắp theo thời điểm), fallback trend_30d', () => {
    const s = { trend_30d: [{ date: '2026-11-01', score: 400 }], score_history: [{ date: '2026-11-03', at: '2026-11-03T02:00:00Z', score: 500, listening: 250, reading: 250, kind: 'mini', mode: 'exam', attempt_id: 'b' }, { date: '2026-11-02', at: '2026-11-02T02:00:00Z', score: 450, listening: null, reading: null, kind: null, mode: 'exam', attempt_id: 'a' }] } as unknown as Stats;
    expect(scoreSeries(s).map((p) => p.score)).toEqual([450, 500]);
    expect(scoreSeries({ trend_30d: [{ date: '2026-11-01', score: 400 }] })).toEqual([{ date: '2026-11-01', at: '2026-11-01', score: 400, listening: null, reading: null, kind: null }]);
  });

  it('tóm tắt tuần + phân vị cộng đồng chỉ khi reason = ok', () => {
    const s = { minutes_this_week: 5, xp: { total: 10, this_week: 7 }, minutes_by_week: [{ week_start: '2026-10-26', minutes: 30, attempts: 2, reviews: 10 }, { week_start: '2026-11-02', minutes: 45, attempts: 3, reviews: 20 }], errors: { open: 4, resolved: 1, by_kind: {} } } as unknown as Stats;
    expect(weekSummary(s)).toEqual({ minutes: 45, minutesDelta: 15, attempts: 3, reviews: 20, xp: 7, errorsOpen: 4 });
    expect(percentileValue({ percentile: 62.5, cohort_size: 20, target_bucket: '600-795', reason: 'ok' })).toBe(63);
    expect(percentileValue({ percentile: null, cohort_size: 3, target_bucket: null, reason: 'cohort_too_small' })).toBeNull();
    expect(percentileValue(undefined)).toBeNull();
  });

  it('dự báo: thiếu dữ liệu → mã khuyến nghị; ok → điểm + khoảng', () => {
    const base = { recommendation: 'x', computed_at: 'x', label: 'preliminary_estimate', model_version: 'linreg-v0', target: 700, exam_date: null, horizon_date: '2026-12-08', points_used: 0, scale: { min: 10, max: 990 }, current_estimate: null, slope_per_week: null, ci_low: null, ci_high: null, ready_date: null, on_track: null } as const;
    expect(forecastView({ ...base, predicted_score: null, status: 'insufficient_data', recommendation_code: 'need_data' })).toEqual({ kind: 'insufficient', code: 'need_data' });
    expect(forecastView({ ...base, predicted_score: 650, ci_low: 600, ci_high: 700, on_track: false, status: 'ok', recommendation_code: 'increase_practice', points_used: 3 })).toMatchObject({ kind: 'ok', predicted: 650, low: 600, high: 700, onTrack: false, target: 700 });
  });
});

describe('S12 (SPEC-ISSUES S142): điểm kỹ năng sau đề mini một kỹ năng', () => {
  const pt = (at: string, part: 'total' | 'listening' | 'reading' | undefined, score: number) => ({ date: at.slice(0, 10), at, score, listening: null, reading: null, kind: 'mini', mode: 'exam', attempt_id: '00000000-0000-4000-8000-000000000001', ...(part ? { part } : {}) });
  it('lấy điểm Listening/Reading gần nhất; không có `part` (API cũ) → null', () => {
    expect(latestSkillScore({ score_history: [pt('2026-11-01T01:00:00Z', 'reading', 310.4), pt('2026-11-03T01:00:00Z', 'listening', 285)] })).toEqual({ part: 'listening', score: 285, at: '2026-11-03T01:00:00Z' });
    expect(latestSkillScore({ score_history: [pt('2026-11-01T01:00:00Z', 'total', 620)] })).toBeNull();
    expect(latestSkillScore({ score_history: [pt('2026-11-01T01:00:00Z', undefined, 300)] })).toBeNull();
    expect(latestSkillScore({ score_history: [] })).toBeNull();
  });
});
