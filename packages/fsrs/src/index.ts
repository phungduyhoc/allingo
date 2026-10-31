import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRSParameters, type Grade } from 'ts-fsrs';

/**
 * @allingo/fsrs – bọc ts-fsrs để lịch ôn tập không phụ thuộc trực tiếp vào thư viện ở module nghiệp vụ.
 * Trạng thái thẻ ánh xạ learn.srs_cards (state, stability, difficulty, due_at, reps, lapses).
 */

export type SrsState = 'new' | 'learning' | 'review' | 'relearning';
export type SrsRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

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
  /** Bước học hiện tại trong learning/relearning (ts-fsrs v6) */
  learning_steps: number;
}

export interface SrsReviewOutcome {
  card: SrsCardState;
  review: { rating: SrsRating; reviewed_at: Date; elapsed_days: number; scheduled_days: number };
}

const STATE_TO_TS: Record<SrsState, State> = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning };
const TS_TO_STATE: Record<State, SrsState> = { [State.New]: 'new', [State.Learning]: 'learning', [State.Review]: 'review', [State.Relearning]: 'relearning' };
const RATING: Record<SrsRating, Grade> = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };

export interface SrsOptions {
  /** Tỷ lệ nhớ mong muốn (mặc định 0.9) */
  request_retention?: number;
  maximum_interval?: number;
  /** Tham số w tối ưu theo người dùng (19 số) – null = mặc định FSRS */
  w?: number[] | null;
  enable_fuzz?: boolean;
}

export function createScheduler(opts: SrsOptions = {}) {
  const params: FSRSParameters = generatorParameters({
    request_retention: opts.request_retention ?? 0.9,
    maximum_interval: opts.maximum_interval ?? 365,
    enable_fuzz: opts.enable_fuzz ?? false,
    ...(opts.w ? { w: opts.w } : {}),
  });
  return fsrs(params);
}

export function newCardState(now = new Date()): SrsCardState {
  const c = createEmptyCard(now);
  return fromTsCard(c);
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
    stability: c.stability,
    difficulty: c.difficulty,
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
  const elapsedDays = card.last_review_at ? Math.max(0, (now.getTime() - card.last_review_at.getTime()) / 86_400_000) : 0;
  return {
    card: fromTsCard(result.card),
    review: { rating, reviewed_at: now, elapsed_days: Math.round(elapsedDays * 100) / 100, scheduled_days: result.log.scheduled_days },
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
