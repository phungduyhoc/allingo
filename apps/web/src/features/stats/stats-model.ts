import type { Forecast, Stats } from '@allingo/schemas';

/**
 * Mô hình hiển thị thống kê (S10) – thuần, có test. Chuyển `GET /me/stats` (trường S10 tuỳ chọn – API cũ/mock thiếu thì rỗng)
 * thành chuỗi điểm, bảng độ chính xác theo Part (30 ngày vs 30 ngày trước), phút/tuần, KPI, tóm tắt tuần; và trạng thái dự báo.
 */

const PART_ORDER = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'];
const partIndex = (k: string) => {
  const i = PART_ORDER.indexOf(k);
  return i < 0 ? 99 : i;
};

export interface AccuracyRow {
  key: string;
  /** % (0–100, làm tròn) hoặc null khi chưa có câu */
  current: number | null;
  previous: number | null;
  /** Điểm % thay đổi (current − previous) */
  delta: number | null;
  total: number;
}

/** API trả `accuracy` theo % (0–100, 1 chữ số thập phân – analytics/stats-calc `accuracyPct`); thiếu → tính từ correct/total */
const pctOf = (c: { correct: number; total: number; accuracy: number | null }): number | null => {
  if (c.accuracy !== null && c.accuracy !== undefined && Number.isFinite(c.accuracy)) return Math.round(c.accuracy);
  return c.total > 0 ? Math.round((c.correct / c.total) * 100) : null;
};

export function accuracyRows(by: NonNullable<Stats['accuracy']>['by_section'] | undefined, order: 'part' | 'total' = 'part'): AccuracyRow[] {
  const rows = Object.entries(by ?? {}).map(([key, c]) => {
    const current = pctOf(c.current);
    const previous = pctOf(c.previous);
    return { key, current, previous, delta: current !== null && previous !== null ? current - previous : null, total: c.current.total };
  });
  return order === 'part' ? rows.sort((a, b) => partIndex(a.key) - partIndex(b.key) || a.key.localeCompare(b.key)) : rows.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export interface ScorePoint {
  date: string;
  at: string;
  score: number;
  listening: number | null;
  reading: number | null;
  kind: string | null;
}

/** Điểm theo thời gian: ưu tiên `score_history` (S10), không có → `trend_30d` (S0) */
export function scoreSeries(s: Pick<Stats, 'score_history' | 'trend_30d'>): ScorePoint[] {
  if (s.score_history?.length) return [...s.score_history].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ date: p.date, at: p.at, score: p.score, listening: p.listening, reading: p.reading, kind: p.kind }));
  return (s.trend_30d ?? []).map((p) => ({ date: p.date, at: p.date, score: p.score, listening: null, reading: null, kind: null }));
}

/**
 * S12 (SPEC-ISSUES S142): điểm kỹ năng gần nhất (mini một kỹ năng – thang 5–495) khi chưa có điểm tổng. API S12 gắn `part`
 * (`total | listening | reading`) cho từng điểm; API cũ thiếu `part` → không đoán (null).
 */
export function latestSkillScore(s: Pick<Stats, 'score_history'>): { part: 'listening' | 'reading'; score: number; at: string } | null {
  const skill = (s.score_history ?? []).filter((p) => p.part === 'listening' || p.part === 'reading');
  if (!skill.length) return null;
  const last = [...skill].sort((a, b) => b.at.localeCompare(a.at))[0]!;
  return { part: last.part as 'listening' | 'reading', score: Math.round(last.score), at: last.at };
}

export function weekSeries(s: Pick<Stats, 'minutes_by_week'>): Array<{ week: string; minutes: number; attempts: number; reviews: number }> {
  return (s.minutes_by_week ?? []).map((w) => ({ week: w.week_start, minutes: w.minutes, attempts: w.attempts, reviews: w.reviews }));
}

export interface WeekSummary {
  minutes: number;
  minutesDelta: number | null;
  attempts: number;
  reviews: number;
  xp: number;
  errorsOpen: number;
}

/** Tóm tắt tuần này từ thống kê (không có notes system_summary qua API → dựng từ số liệu) */
export function weekSummary(s: Stats): WeekSummary {
  const weeks = s.minutes_by_week ?? [];
  const cur = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  return {
    minutes: cur?.minutes ?? s.minutes_this_week,
    minutesDelta: cur && prev ? cur.minutes - prev.minutes : null,
    attempts: cur?.attempts ?? 0,
    reviews: cur?.reviews ?? s.vocab?.reviews_7d ?? 0,
    xp: s.xp.this_week,
    errorsOpen: s.errors?.open ?? 0,
  };
}

/** Phân vị cộng đồng (0–100, API `percentileOf`) – chỉ khi `reason = ok` */
export function percentileValue(c: Stats['community']): number | null {
  if (!c || c.reason !== 'ok' || c.percentile === null || !Number.isFinite(c.percentile)) return null;
  return Math.max(0, Math.min(100, Math.round(c.percentile)));
}

export type ForecastView =
  | { kind: 'insufficient'; code: Forecast['recommendation_code'] }
  | { kind: 'ok'; predicted: number; low: number | null; high: number | null; target: number | null; onTrack: boolean | null; readyDate: string | null; horizon: string; code: Forecast['recommendation_code']; slope: number | null; current: number | null };

export function forecastView(f: Forecast): ForecastView {
  if (f.status !== 'ok' || f.predicted_score === null) return { kind: 'insufficient', code: f.recommendation_code };
  return { kind: 'ok', predicted: f.predicted_score, low: f.ci_low, high: f.ci_high, target: f.target, onTrack: f.on_track, readyDate: f.ready_date, horizon: f.horizon_date, code: f.recommendation_code, slope: f.slope_per_week, current: f.current_estimate };
}
