import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRSParameters, type Grade } from 'ts-fsrs';
import { FSRS5_DEFAULT_WEIGHTS, clipFSRS5Parameters } from 'ts-fsrs/models/fsrs-5';

/**
 * @allingo/fsrs – bọc ts-fsrs để lịch ôn tập không phụ thuộc trực tiếp vào thư viện ở module nghiệp vụ (Sprint 0 → Sprint 10).
 * Trạng thái thẻ ánh xạ learn.srs_cards (state, stability, difficulty, due_at, last_review_at, reps, lapses).
 *
 * Sprint 10:
 *  - Tham số mặc định **FSRS-5** (19 trọng số `FSRS5_DEFAULT_WEIGHTS`; ts-fsrs v6 tự chuyển sang 21 số với w19 = 0, w20 = 0,5 –
 *    tức đường quên FSRS-5), tỉ lệ nhớ mục tiêu 0,9, khoảng tối đa 365 ngày, không fuzz (lịch xác định, test được).
 *  - Bước học 1 bước `1m` (Again/Hard → thẻ quay lại trong phiên; Good → ra khỏi phiên, ≥ 1 ngày) và bước học lại `10m`.
 *    Vì chỉ có 1 bước nên `learning_steps` luôn = 0 → không cần cột riêng trong DDL; `scheduled_days` suy ra từ
 *    due_at − last_review_at (`fromStored`). Đổi sang nhiều bước phải thêm cột `learning_steps` (A150).
 *  - Trọng số theo người dùng (tối ưu sau ≥ 1.000 review – `optimizer.ts`) truyền qua `SrsOptions.w`.
 */

export type SrsState = 'new' | 'learning' | 'review' | 'relearning';
export type SrsRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

/** Phiên bản mô hình lưu cùng tham số người dùng (learn.enrollments.fsrs_params.model) */
export const FSRS_MODEL_VERSION = 'fsrs-5';
/** 19 trọng số mặc định FSRS-5 */
export const DEFAULT_WEIGHTS: readonly number[] = Object.freeze([...FSRS5_DEFAULT_WEIGHTS]);
export const DEFAULT_REQUEST_RETENTION = 0.9;
export const DEFAULT_MAXIMUM_INTERVAL = 365;
export const LEARNING_STEPS = ['1m'] as const;
export const RELEARNING_STEPS = ['10m'] as const;
/** Ngưỡng "đã thuộc" (stability ≥ 21 ngày, thẻ ở trạng thái review) – thống kê từ vựng đã thuộc/đang học */
export const MASTERED_STABILITY_DAYS = 21;

export interface SrsCardState {
  state: SrsState;
  stability: number | null;
  difficulty: number | null;
  due_at: Date;
  last_review_at: Date | null;
  reps: number;
  lapses: number;
  /** Số ngày giữa hai lần ôn (ts-fsrs scheduled_days) */
  scheduled_days: number;
  /** Bước học hiện tại trong learning/relearning (ts-fsrs v6) – luôn 0 với cấu hình 1 bước */
  learning_steps: number;
}

/** Cột của learn.srs_cards cần để dựng lại trạng thái FSRS */
export interface StoredSrsCard {
  state: SrsState;
  stability: number | null;
  difficulty: number | null;
  due_at: Date;
  last_review_at: Date | null;
  reps: number;
  lapses: number;
}

export interface SrsReviewOutcome {
  card: SrsCardState;
  review: { rating: SrsRating; reviewed_at: Date; elapsed_days: number; scheduled_days: number; state_before: SrsState };
}

const STATE_TO_TS: Record<SrsState, State> = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning };
const TS_TO_STATE: Record<State, SrsState> = { [State.New]: 'new', [State.Learning]: 'learning', [State.Review]: 'review', [State.Relearning]: 'relearning' };
const RATING: Record<SrsRating, Grade> = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };
const DAY_MS = 86_400_000;

export interface SrsOptions {
  /** Tỷ lệ nhớ mong muốn (mặc định 0.9) */
  request_retention?: number;
  maximum_interval?: number;
  /** Trọng số tối ưu theo người dùng (19 số FSRS-5) – null/không hợp lệ = mặc định */
  w?: readonly number[] | null;
  enable_fuzz?: boolean;
}

/** Trọng số hợp lệ (19 số hữu hạn) đã kẹp theo biên FSRS-5; không hợp lệ → null */
export function sanitizeWeights(w: readonly unknown[] | null | undefined): number[] | null {
  if (!Array.isArray(w) || w.length !== 19 || !w.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return clipFSRS5Parameters(w as number[]);
}

const schedulerCache = new Map<string, ReturnType<typeof fsrs>>();

export function createScheduler(opts: SrsOptions = {}) {
  const w = sanitizeWeights(opts.w ?? null) ?? [...DEFAULT_WEIGHTS];
  const key = JSON.stringify([opts.request_retention ?? DEFAULT_REQUEST_RETENTION, opts.maximum_interval ?? DEFAULT_MAXIMUM_INTERVAL, opts.enable_fuzz ?? false, w]);
  const hit = schedulerCache.get(key);
  if (hit) return hit;
  const params: FSRSParameters = generatorParameters({
    request_retention: opts.request_retention ?? DEFAULT_REQUEST_RETENTION,
    maximum_interval: opts.maximum_interval ?? DEFAULT_MAXIMUM_INTERVAL,
    enable_fuzz: opts.enable_fuzz ?? false,
    w,
    learning_steps: [...LEARNING_STEPS],
    relearning_steps: [...RELEARNING_STEPS],
  });
  const s = fsrs(params);
  if (schedulerCache.size > 500) schedulerCache.clear();
  schedulerCache.set(key, s);
  return s;
}

export function newCardState(now = new Date()): SrsCardState {
  return fromTsCard(createEmptyCard(now));
}

/** Dựng trạng thái FSRS từ cột DB (scheduled_days = số ngày due − last_review cho thẻ review, 0 khi learning/new) */
export function fromStored(row: StoredSrsCard): SrsCardState {
  const scheduled = row.state === 'review' && row.last_review_at ? Math.max(0, Math.round((row.due_at.getTime() - row.last_review_at.getTime()) / DAY_MS)) : 0;
  return { ...row, scheduled_days: scheduled, learning_steps: 0 };
}

function toTsCard(s: SrsCardState): Card {
  return {
    due: s.due_at,
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: STATE_TO_TS[s.state],
    last_review: s.last_review_at ?? undefined,
  };
}

function fromTsCard(c: Card): SrsCardState {
  return {
    state: TS_TO_STATE[c.state],
    stability: c.state === State.New ? null : c.stability,
    difficulty: c.state === State.New ? null : c.difficulty,
    due_at: c.due,
    last_review_at: c.last_review ?? null,
    reps: c.reps,
    lapses: c.lapses,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
  };
}

/** Ôn một thẻ với rating 1–4 tại thời điểm `now` → trạng thái mới + log review */
export function reviewCard(card: SrsCardState, rating: SrsRating, now = new Date(), opts?: SrsOptions): SrsReviewOutcome {
  const scheduler = createScheduler(opts);
  const result = scheduler.next(toTsCard(card), now, RATING[rating]);
  const elapsedDays = card.last_review_at ? Math.max(0, (now.getTime() - card.last_review_at.getTime()) / DAY_MS) : 0;
  return {
    card: fromTsCard(result.card),
    review: { rating, reviewed_at: now, elapsed_days: Math.round(elapsedDays * 100) / 100, scheduled_days: result.log.scheduled_days, state_before: card.state },
  };
}

/** Xem trước ngày đến hạn cho cả 4 rating (hiện trên nút Again/Hard/Good/Easy) */
export function previewIntervals(card: SrsCardState, now = new Date(), opts?: SrsOptions): Record<SrsRating, Date> {
  const scheduler = createScheduler(opts);
  const out = {} as Record<SrsRating, Date>;
  for (const r of [1, 2, 3, 4] as const) out[r] = scheduler.next(toTsCard(card), now, RATING[r]).card.due;
  return out;
}

/** Xác suất còn nhớ tại thời điểm now (retrievability) */
export function retrievability(card: SrsCardState, now = new Date(), opts?: SrsOptions): number {
  if (card.state === 'new' || !card.stability) return 0;
  const scheduler = createScheduler(opts);
  return scheduler.retrievability(toTsCard(card), now);
}

/** "Đã thuộc": thẻ review có stability ≥ 21 ngày */
export function isMastered(card: Pick<SrsCardState, 'state' | 'stability'>): boolean {
  return card.state === 'review' && (card.stability ?? 0) >= MASTERED_STABILITY_DAYS;
}

export * from './optimizer.js';
