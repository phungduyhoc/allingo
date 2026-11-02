/**
 * Dự báo điểm v0 (Sprint 10 – A157): hồi quy tuyến tính (OLS) trên điểm ước tính theo thời gian → điểm tại ngày dự báo, khoảng
 * dự báo 80 % (t ≈ z = 1,2816), ngày đạt mục tiêu. Thuần, xác định – test đơn vị. Luôn hiển thị "ước tính sơ bộ"; AI/knowledge
 * tracing ở GĐ4.
 *
 * Chống ngoại suy quá đà: độ dốc co về 0 khi khoảng thời gian dữ liệu ngắn (× span/(span + 14 ngày)) và kẹp ±2 % thang/tuần;
 * nửa khoảng tối thiểu 4 % thang, tối đa 25 % thang; mọi giá trị kẹp trong [min, max] của thang.
 */

export const FORECAST_MODEL_VERSION = 'linreg-v0';
const DAY_MS = 86_400_000;
const Z80 = 1.2816;

export interface ForecastPoint {
  at: number;
  score: number;
}

export interface ForecastInput {
  points: readonly ForecastPoint[];
  now: number;
  horizon: number;
  target: number | null;
  examDate: number | null;
  scale: { min: number; max: number };
}

export type RecommendationCode = 'need_data' | 'keep_going' | 'increase_practice' | 'on_track' | 'target_reached' | 'set_target';

export interface ForecastOutput {
  status: 'ok' | 'insufficient_data';
  predicted: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  current: number | null;
  slopePerWeek: number | null;
  readyAt: number | null;
  onTrack: boolean | null;
  recommendation: RecommendationCode;
  pointsUsed: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Làm tròn theo thang: TOEIC/JLPT/HSK số nguyên (TOEIC bội 5), IELTS 0,5 */
export function roundToScale(v: number, scale: { min: number; max: number }): number {
  if (scale.max <= 9) return Math.round(v * 2) / 2;
  if (scale.max >= 900) return Math.round(v / 5) * 5;
  return Math.round(v);
}

export function forecastLinear(input: ForecastInput): ForecastOutput {
  const pts = [...input.points].filter((p) => Number.isFinite(p.score)).sort((a, b) => a.at - b.at);
  const range = input.scale.max - input.scale.min;
  const minHalf = 0.04 * range;
  const maxHalf = 0.25 * range;
  const n = pts.length;
  if (n === 0) return { status: 'insufficient_data', predicted: null, ciLow: null, ciHigh: null, current: null, slopePerWeek: null, readyAt: null, onTrack: null, recommendation: 'need_data', pointsUsed: 0 };

  const x0 = pts[0]!.at;
  const xs = pts.map((p) => (p.at - x0) / DAY_MS);
  const ys = pts.map((p) => p.score);
  const xm = xs.reduce((a, b) => a + b, 0) / n;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - xm) ** 2, 0);
  let slope = 0;
  if (n >= 2 && sxx > 0) slope = xs.reduce((a, x, i) => a + (x - xm) * (ys[i]! - ym), 0) / sxx;
  const span = xs[n - 1]! - xs[0]!;
  slope *= span / (span + 14);
  const maxPerDay = (0.02 * range) / 7;
  slope = clamp(slope, -maxPerDay, maxPerDay);
  const intercept = ym - slope * xm;
  const xNow = (input.now - x0) / DAY_MS;
  const xH = (Math.max(input.horizon, input.now) - x0) / DAY_MS;
  const current = clamp(intercept + slope * xNow, input.scale.min, input.scale.max);
  const rawPred = intercept + slope * xH;

  let half: number;
  if (n >= 3) {
    const sse = xs.reduce((a, x, i) => a + (ys[i]! - (intercept + slope * x)) ** 2, 0);
    const s = Math.sqrt(sse / (n - 2));
    half = Z80 * s * Math.sqrt(1 + 1 / n + (sxx > 0 ? (xH - xm) ** 2 / sxx : 0));
  } else half = 0.08 * range;
  half = clamp(half, minHalf, maxHalf);
  const predicted = clamp(rawPred, input.scale.min, input.scale.max);
  const ciLow = clamp(rawPred - half, input.scale.min, input.scale.max);
  const ciHigh = clamp(rawPred + half, input.scale.min, input.scale.max);

  let readyAt: number | null = null;
  if (input.target !== null) {
    if (current >= input.target) readyAt = input.now;
    else if (slope > 0) {
      const days = (input.target - current) / slope;
      const at = input.now + Math.ceil(days) * DAY_MS;
      const cap = (input.examDate ?? input.horizon) + 180 * DAY_MS;
      readyAt = at <= cap ? at : null;
    }
  }
  const onTrack = input.target === null ? null : predicted >= input.target;
  const recommendation: RecommendationCode =
    input.target === null ? 'set_target' : current >= input.target ? 'target_reached' : onTrack ? 'on_track' : n < 3 ? 'keep_going' : 'increase_practice';
  return {
    status: 'ok',
    predicted: roundToScale(predicted, input.scale),
    ciLow: roundToScale(ciLow, input.scale),
    ciHigh: roundToScale(ciHigh, input.scale),
    current: roundToScale(current, input.scale),
    slopePerWeek: n >= 2 ? Math.round(slope * 7 * 100) / 100 : null,
    readyAt,
    onTrack,
    recommendation,
    pointsUsed: n,
  };
}

const TEXT: Record<RecommendationCode, { vi: string; en: string }> = {
  need_data: { vi: 'Làm một bài chẩn đoán hoặc đề mini để có điểm ước tính đầu tiên.', en: 'Take a diagnostic or mini test to get your first estimate.' },
  set_target: { vi: 'Đặt điểm mục tiêu và ngày thi để xem dự báo so với mục tiêu.', en: 'Set a target score and exam date to compare the forecast.' },
  target_reached: { vi: 'Điểm ước tính đã đạt mục tiêu – duy trì luyện đề để giữ phong độ.', en: 'Your estimate already meets the target – keep practising to stay there.' },
  on_track: { vi: 'Đúng hướng: giữ nhịp luyện hiện tại để đạt mục tiêu.', en: 'On track: keep your current pace to reach the target.' },
  keep_going: { vi: 'Cần thêm vài bài có điểm để dự báo chính xác hơn.', en: 'A few more scored tests will make the forecast more reliable.' },
  increase_practice: { vi: 'Theo xu hướng hiện tại chưa đạt mục tiêu – tăng thời gian luyện Part yếu.', en: 'At the current trend you may fall short – add practice on weak parts.' },
};

export function recommendationText(code: RecommendationCode, locale: string): string {
  return locale === 'vi' ? TEXT[code].vi : TEXT[code].en;
}
