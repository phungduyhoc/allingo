import { FSRS5Algorithm, FSRS5_DEFAULT_WEIGHTS, FSRS5_MODEL_BOUNDS, clipFSRS5Parameters } from 'ts-fsrs/models/fsrs-5';

/**
 * Tối ưu trọng số FSRS-5 theo người dùng (Sprint 10 – A151).
 *
 * ts-fsrs 6.0.0 KHÔNG kèm optimizer (bộ tối ưu chính thức là `@open-spaced-repetition/binding` – Rust/napi, chưa có trong
 * VERSIONS). Đây là bộ tối ưu nhẹ, thuần TS, xác định:
 *   1. Dựng chuỗi review theo thẻ (đã sắp theo thời gian), bỏ thẻ chỉ có 1 lần ôn.
 *   2. Hàm mất mát = log-loss nhị phân giữa retrievability dự đoán R(t, S) trước mỗi lần ôn (t ≥ 1 ngày) và kết quả
 *      nhớ/quên (rating > 1 ⇒ nhớ) – cùng mục tiêu với FSRS optimizer.
 *   3. Coordinate descent có kẹp biên (`clipFSRS5Parameters`), bước nhân 0,2 → 0,1 → 0,05 → 0,025.
 *   4. Chỉ chấp nhận khi giảm loss ≥ `minImprovement` (mặc định 1 %) so với mặc định – tránh overfit dữ liệu ít.
 * Thay bằng binding chính thức khi có (cùng giao diện `optimizeWeights`).
 */

export const MIN_REVIEWS_FOR_OPTIMIZATION = 1000;
/** Giới hạn số review dùng để tối ưu (mới nhất) – job tuần chạy trong worker, giữ < 1 s/người */
export const MAX_REVIEWS_FOR_OPTIMIZATION = 20_000;

export interface ReviewLogInput {
  card_id: string;
  rating: 1 | 2 | 3 | 4;
  reviewed_at: Date;
}

export interface OptimizeResult {
  /** Trọng số mới (19 số); null = giữ mặc định (không đủ cải thiện) */
  weights: number[] | null;
  loss_default: number;
  loss_optimized: number;
  reviews: number;
  cards: number;
  evaluated_reviews: number;
  iterations: number;
  improved: boolean;
}

const DAY_MS = 86_400_000;
const EPS = 1e-6;

/** Gom log theo thẻ, sắp theo thời gian, bỏ thẻ chỉ có 1 lần ôn */
export function buildHistories(logs: readonly ReviewLogInput[]): Array<Array<{ t: number; g: number }>> {
  const byCard = new Map<string, ReviewLogInput[]>();
  for (const l of logs) {
    const arr = byCard.get(l.card_id);
    if (arr) arr.push(l);
    else byCard.set(l.card_id, [l]);
  }
  const out: Array<Array<{ t: number; g: number }>> = [];
  for (const arr of byCard.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.reviewed_at.getTime() - b.reviewed_at.getTime());
    out.push(arr.map((x, i) => ({ t: i === 0 ? 0 : Math.max(0, Math.floor((x.reviewed_at.getTime() - arr[i - 1]!.reviewed_at.getTime()) / DAY_MS)), g: x.rating })));
  }
  return out;
}

/** Log-loss trung bình của trọng số trên tập chuỗi review; trả cả số review được tính */
export function logLoss(weights: readonly number[], histories: ReadonlyArray<ReadonlyArray<{ t: number; g: number }>>): { loss: number; n: number } {
  const algo = new FSRS5Algorithm([...weights], true, FSRS5_MODEL_BOUNDS);
  let sum = 0;
  let n = 0;
  for (const h of histories) {
    let state: { stability: number; difficulty: number } | null = null;
    for (let i = 0; i < h.length; i++) {
      const { t, g } = h[i]!;
      if (state && i > 0 && t >= 1) {
        const p = Math.min(1 - EPS, Math.max(EPS, algo.forgetting_curve(t, state.stability)));
        const y = g > 1 ? 1 : 0;
        sum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        n++;
      }
      state = algo.next_state(state, i === 0 ? 0 : t, g);
    }
  }
  return { loss: n ? sum / n : 0, n };
}

export function optimizeWeights(
  logs: readonly ReviewLogInput[],
  opts: { minReviews?: number; minImprovement?: number; initial?: readonly number[] | null; maxReviews?: number } = {},
): OptimizeResult | null {
  const minReviews = opts.minReviews ?? MIN_REVIEWS_FOR_OPTIMIZATION;
  if (logs.length < minReviews) return null;
  const recent = logs.length > (opts.maxReviews ?? MAX_REVIEWS_FOR_OPTIMIZATION) ? [...logs].sort((a, b) => b.reviewed_at.getTime() - a.reviewed_at.getTime()).slice(0, opts.maxReviews ?? MAX_REVIEWS_FOR_OPTIMIZATION) : logs;
  const histories = buildHistories(recent);
  const base = logLoss(FSRS5_DEFAULT_WEIGHTS, histories);
  if (base.n === 0) return { weights: null, loss_default: 0, loss_optimized: 0, reviews: logs.length, cards: histories.length, evaluated_reviews: 0, iterations: 0, improved: false };
  let w = clipFSRS5Parameters(opts.initial && opts.initial.length === 19 ? [...opts.initial] : [...FSRS5_DEFAULT_WEIGHTS]);
  let best = logLoss(w, histories).loss;
  let iterations = 0;
  for (const step of [0.2, 0.1, 0.05, 0.025]) {
    let improved = true;
    let rounds = 0;
    while (improved && rounds < 3) {
      improved = false;
      rounds++;
      for (let i = 0; i < 19; i++) {
        for (const dir of [1, -1]) {
          const cand = [...w];
          const delta = Math.abs(cand[i]!) > 0.05 ? cand[i]! * step * dir : step * 0.1 * dir;
          cand[i] = cand[i]! + delta;
          const clipped = clipFSRS5Parameters(cand);
          iterations++;
          const l = logLoss(clipped, histories).loss;
          if (l + 1e-9 < best) {
            best = l;
            w = clipped;
            improved = true;
            break;
          }
        }
      }
    }
  }
  const minImprovement = opts.minImprovement ?? 0.01;
  const gain = base.loss > 0 ? (base.loss - best) / base.loss : 0;
  const accept = gain >= minImprovement;
  return {
    weights: accept ? w.map((x) => Math.round(x * 10_000) / 10_000) : null,
    loss_default: Math.round(base.loss * 1e6) / 1e6,
    loss_optimized: Math.round(best * 1e6) / 1e6,
    reviews: logs.length,
    cards: histories.length,
    evaluated_reviews: base.n,
    iterations,
    improved: accept,
  };
}
