import { describe, expect, it } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, Rating, type Grade } from 'ts-fsrs';
import { FSRS5_DEFAULT_WEIGHTS } from 'ts-fsrs/models/fsrs-5';
import {
  DEFAULT_WEIGHTS,
  FSRS_MODEL_VERSION,
  buildHistories,
  fromStored,
  isMastered,
  logLoss,
  newCardState,
  optimizeWeights,
  previewIntervals,
  retrievability,
  reviewCard,
  sanitizeWeights,
  type ReviewLogInput,
  type SrsCardState,
  type SrsRating,
} from '../src/index.js';

const MIN = 60_000;
const DAY = 86_400_000;

/** Vector mẫu (FSRS-5 mặc định, retention 0,9, không fuzz, bước học 1m / học lại 10m) – ôn lại 1 giờ sau mỗi hạn */
const VECTOR: Array<{ rating: SrsRating; state: string; due: string; s: number; d: number; reps: number; lapses: number }> = [
  { rating: 3, state: 'review', due: '2026-11-05T01:00:00.000Z', s: 3.173, d: 5.2824, reps: 1, lapses: 0 },
  { rating: 3, state: 'review', due: '2026-11-16T02:00:00.000Z', s: 10.7389, d: 5.273, reps: 2, lapses: 0 },
  { rating: 1, state: 'relearning', due: '2026-11-16T03:10:00.000Z', s: 2.1858, d: 6.7906, reps: 3, lapses: 1 },
  { rating: 3, state: 'review', due: '2026-11-19T04:10:00.000Z', s: 3.0531, d: 6.7742, reps: 4, lapses: 1 },
  { rating: 4, state: 'review', due: '2026-12-09T05:10:00.000Z', s: 19.7859, d: 6.2368, reps: 5, lapses: 1 },
  { rating: 2, state: 'review', due: '2027-01-06T06:10:00.000Z', s: 27.5554, d: 6.8308, reps: 6, lapses: 1 },
  { rating: 3, state: 'review', due: '2027-03-14T07:10:00.000Z', s: 67.0691, d: 6.8142, reps: 7, lapses: 1 },
];

describe('@allingo/fsrs – lịch FSRS-5', () => {
  const t0 = new Date('2026-11-02T01:00:00Z');

  it('dùng 19 trọng số mặc định FSRS-5 (w2 = S0 của Good)', () => {
    expect(FSRS_MODEL_VERSION).toBe('fsrs-5');
    expect(DEFAULT_WEIGHTS).toHaveLength(19);
    expect([...DEFAULT_WEIGHTS]).toEqual([...FSRS5_DEFAULT_WEIGHTS]);
    const { card } = reviewCard(newCardState(t0), 3, t0);
    expect(card.stability).toBeCloseTo(DEFAULT_WEIGHTS[2]!, 6);
  });

  it('khớp vector mẫu từng bước (state, due, S, D, reps, lapses)', () => {
    let c = newCardState(t0);
    let now = t0;
    for (const v of VECTOR) {
      c = reviewCard(c, v.rating, now).card;
      expect(c.state).toBe(v.state);
      expect(c.due_at.toISOString()).toBe(v.due);
      expect(c.stability!).toBeCloseTo(v.s, 3);
      expect(c.difficulty!).toBeCloseTo(v.d, 3);
      expect(c.reps).toBe(v.reps);
      expect(c.lapses).toBe(v.lapses);
      now = new Date(c.due_at.getTime() + 3600_000);
    }
  });

  it('Again → quay lại trong phiên (1 phút); Hard < 2 phút; Good → ≥ 1 ngày; Again rồi Good → đúng 1 ngày', () => {
    const c = newCardState(t0);
    const p = previewIntervals(c, t0);
    expect(p[1].getTime() - t0.getTime()).toBe(MIN);
    expect(p[2].getTime() - t0.getTime()).toBeLessThan(2 * MIN);
    expect(p[3].getTime() - t0.getTime()).toBeGreaterThanOrEqual(DAY);
    expect(p[4].getTime()).toBeGreaterThan(p[3].getTime());
    const again = reviewCard(c, 1, t0).card;
    expect(again.state).toBe('learning');
    const t1 = new Date(t0.getTime() + MIN);
    const good = reviewCard(again, 3, t1).card;
    expect(good.due_at.getTime() - t1.getTime()).toBe(DAY);
  });

  it('Again khi đang review → lapses + 1, relearning 10 phút', () => {
    let c = newCardState(t0);
    let now = t0;
    for (let i = 0; i < 3; i++) {
      c = reviewCard(c, 3, now).card;
      now = new Date(c.due_at.getTime() + 1000);
    }
    const again = reviewCard(c, 1, now).card;
    expect(again.lapses).toBe(c.lapses + 1);
    expect(again.state).toBe('relearning');
    expect(again.due_at.getTime() - now.getTime()).toBe(10 * MIN);
  });

  it('fromStored (chỉ cột DDL) mô phỏng 7 ngày khớp ts-fsrs giữ Card đầy đủ', () => {
    const params = generatorParameters({ w: [...FSRS5_DEFAULT_WEIGHTS], enable_fuzz: false, learning_steps: ['1m'], relearning_steps: ['10m'], maximum_interval: 365, request_retention: 0.9 });
    const ref = fsrs(params);
    const ratings: Grade[] = [Rating.Good, Rating.Again, Rating.Hard, Rating.Easy];
    for (let k = 0; k < 20; k++) {
      let refCard = createEmptyCard(t0);
      let stored: SrsCardState = newCardState(t0);
      let now = t0;
      const end = t0.getTime() + 7 * DAY;
      let i = 0;
      while (now.getTime() < end) {
        const g = ratings[(k * 7 + i * 3) % 4]!;
        refCard = ref.next(refCard, now, g).card;
        // Lưu DB chỉ giữ các cột DDL rồi dựng lại
        const next = reviewCard(stored, g, now).card;
        stored = fromStored({ state: next.state, stability: next.stability, difficulty: next.difficulty, due_at: next.due_at, last_review_at: next.last_review_at, reps: next.reps, lapses: next.lapses });
        expect(stored.due_at.getTime()).toBe(refCard.due.getTime());
        expect(stored.stability!).toBeCloseTo(refCard.stability, 6);
        now = new Date(Math.max(stored.due_at.getTime(), now.getTime() + MIN));
        i++;
      }
    }
  });

  it('retrievability giảm theo thời gian; isMastered theo stability ≥ 21', () => {
    const c = reviewCard(newCardState(t0), 3, t0).card;
    const r1 = retrievability(c, new Date(t0.getTime() + DAY));
    const r2 = retrievability(c, new Date(t0.getTime() + 30 * DAY));
    expect(r1).toBeGreaterThan(r2);
    expect(isMastered(c)).toBe(false);
    expect(isMastered({ state: 'review', stability: 25 })).toBe(true);
    expect(isMastered({ state: 'learning', stability: 25 })).toBe(false);
  });

  it('trọng số người dùng thay đổi lịch; trọng số sai dạng → mặc định', () => {
    const w = [...DEFAULT_WEIGHTS];
    w[2] = 6;
    const p1 = previewIntervals(newCardState(t0), t0, { w });
    const p0 = previewIntervals(newCardState(t0), t0);
    expect(p1[3].getTime()).toBeGreaterThan(p0[3].getTime());
    expect(sanitizeWeights([1, 2, 3])).toBeNull();
    expect(sanitizeWeights([...DEFAULT_WEIGHTS.slice(0, 18), Number.NaN])).toBeNull();
    const pBad = previewIntervals(newCardState(t0), t0, { w: [1, 2] });
    expect(pBad[3].getTime()).toBe(p0[3].getTime());
  });
});

describe('@allingo/fsrs – tối ưu trọng số', () => {
  /** Dữ liệu tổng hợp: người học quên nhanh hơn mặc định (nhớ thật theo S_true = 0,35 × S mặc định) – xác định bằng LCG */
  function synthetic(cards: number, reviewsPerCard: number): ReviewLogInput[] {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const logs: ReviewLogInput[] = [];
    const start = Date.UTC(2026, 0, 1);
    for (let c = 0; c < cards; c++) {
      let card = newCardState(new Date(start));
      let now = new Date(start + c * 3_600_000);
      for (let r = 0; r < reviewsPerCard; r++) {
        let rating: SrsRating = 3;
        if (r > 0 && card.stability) {
          const days = (now.getTime() - (card.last_review_at?.getTime() ?? now.getTime())) / DAY;
          const pTrue = Math.pow(1 + (19 / 81) * (days / (card.stability * 0.35)), -0.5);
          rating = rnd() < pTrue ? 3 : 1;
        }
        logs.push({ card_id: `c${c}`, rating, reviewed_at: now });
        card = reviewCard(card, rating, now).card;
        now = new Date(card.due_at.getTime() + Math.max(DAY, (card.due_at.getTime() - now.getTime()) * 0.2));
      }
    }
    return logs;
  }

  it('< 1.000 review → không tối ưu (null)', () => {
    expect(optimizeWeights(synthetic(50, 5))).toBeNull();
  });

  it('buildHistories bỏ thẻ 1 lần ôn, tính t theo ngày', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const h = buildHistories([
      { card_id: 'a', rating: 3, reviewed_at: d },
      { card_id: 'a', rating: 3, reviewed_at: new Date(d.getTime() + 3 * DAY + 5000) },
      { card_id: 'b', rating: 3, reviewed_at: d },
    ]);
    expect(h).toEqual([[{ t: 0, g: 3 }, { t: 3, g: 3 }]]);
  });

  it('dữ liệu quên nhanh → trọng số mới giảm loss ≥ 1 %, xác định (chạy 2 lần cùng kết quả)', () => {
    const logs = synthetic(220, 6);
    expect(logs.length).toBeGreaterThanOrEqual(1000);
    const r = optimizeWeights(logs)!;
    expect(r.improved).toBe(true);
    expect(r.weights).toHaveLength(19);
    expect(r.loss_optimized).toBeLessThan(r.loss_default * 0.99);
    // S0 Good nhỏ hơn mặc định (người học quên nhanh hơn)
    expect(r.weights![2]!).toBeLessThan(DEFAULT_WEIGHTS[2]!);
    const again = optimizeWeights(logs)!;
    expect(again.weights).toEqual(r.weights);
    const h = buildHistories(logs);
    expect(logLoss(r.weights!, h).loss).toBeLessThan(logLoss(DEFAULT_WEIGHTS, h).loss);
  });
});
