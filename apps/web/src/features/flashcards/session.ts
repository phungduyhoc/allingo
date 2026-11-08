import type { SrsCard } from '@allingo/schemas';

/**
 * Phiên ôn thẻ (S10) – reducer thuần, có test. Thẻ đang xem = `queue[0]`. Chấm điểm cập nhật lạc quan (người học không phải
 * chờ mạng), lượt chấm gửi `POST /me/srs/review` ngay với `reviewed_at` cố định (idempotent khi thử lại). Quy tắc:
 *  - Again (1) → thẻ quay lại TRONG phiên sau `AGAIN_GAP` thẻ khác (API: thẻ đến hạn lại sau 1 phút – "learn ahead" như Anki ≤ 20′);
 *    lịch xem trước (`preview`) của thẻ quay lại đã cũ → xoá, web tải lại từ `GET /me/srs/due` khi tới lượt.
 *  - Server trả `in_session: true` cho lượt khác Again (vd Hard ở thẻ đang học) → thêm vào cuối hàng đợi.
 *  - 429 `srs_new_cards` (hết hạn mức thẻ mới hôm nay) → hoàn tác lượt chấm đó, bỏ mọi thẻ mới còn lại, ghi giờ reset.
 *  - Lỗi mạng/5xx → giữ lượt trong `failed` để "Thử lại" (cùng `reviewed_at`).
 * Phiên kết thúc khi hàng đợi rỗng VÀ không còn lượt đang gửi (`sessionStatus`).
 */

export type Rating = 1 | 2 | 3 | 4;
export type Side = 'front' | 'back';
export type ReviewMode = 'flashcard' | 'dictation';

/** Số thẻ khác xen giữa trước khi thẻ "Again" quay lại */
export const AGAIN_GAP = 3;
export const SESSION_SIZES = [10, 20, 30] as const;

export interface PendingReview {
  card_id: string;
  rating: Rating;
  reviewed_at: string;
  review_mode: ReviewMode;
  /** Thẻ ở trạng thái `new` lúc chấm (để hoàn tác khi 429 hạn mức thẻ mới) */
  was_new: boolean;
}

export interface SessionState {
  queue: string[];
  cards: Record<string, SrsCard>;
  side: Side;
  /** Số lượt chấm đã ghi nhận (kể cả thẻ lặp lại) */
  reviewed: number;
  ratings: Record<Rating, number>;
  /** Thẻ đã xem ít nhất một lần (theo thứ tự) */
  seen: string[];
  /** Thẻ đã bị chấm Again ít nhất một lần */
  again: string[];
  /** Lượt đang gửi lên server */
  inflight: PendingReview[];
  /** Lượt gửi lỗi (mạng/5xx) chờ thử lại */
  failed: PendingReview[];
  newLimit: { reached: boolean; resetAt: string | null };
  /** Thẻ mới đã học trong phiên (được server chấp nhận) */
  learnedNew: number;
  started: boolean;
}

export type SessionAction =
  | { type: 'start'; cards: SrsCard[] }
  | { type: 'flip' }
  | { type: 'rate'; rating: Rating; at: string; mode?: ReviewMode }
  | { type: 'server_ok'; review: PendingReview; card: SrsCard | null }
  | { type: 'server_quota'; review: PendingReview; resetAt: string | null }
  | { type: 'server_error'; review: PendingReview }
  | { type: 'retry'; reviews: PendingReview[] }
  | { type: 'previews'; previews: Record<string, NonNullable<SrsCard['preview']>> };

export function initialSession(): SessionState {
  return { queue: [], cards: {}, side: 'front', reviewed: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0 }, seen: [], again: [], inflight: [], failed: [], newLimit: { reached: false, resetAt: null }, learnedNew: 0, started: false };
}

const sameReview = (a: PendingReview, b: PendingReview) => a.card_id === b.card_id && a.reviewed_at === b.reviewed_at;
const without = (list: PendingReview[], r: PendingReview) => list.filter((x) => !sameReview(x, r));

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'start': {
      const cards: Record<string, SrsCard> = {};
      const queue: string[] = [];
      for (const c of action.cards) {
        if (cards[c.id]) continue;
        cards[c.id] = c;
        queue.push(c.id);
      }
      return { ...initialSession(), cards, queue, started: true };
    }
    case 'flip':
      return state.queue.length ? { ...state, side: 'back' } : state;
    case 'rate': {
      const id = state.queue[0];
      if (!id) return state;
      const card = state.cards[id]!;
      const rest = state.queue.slice(1);
      let queue = rest;
      let cards = state.cards;
      if (action.rating === 1) {
        const pos = Math.min(AGAIN_GAP, rest.length);
        queue = [...rest.slice(0, pos), id, ...rest.slice(pos)];
        // Lịch xem trước đã cũ sau lượt chấm → bỏ (tải lại khi thẻ quay lại)
        const { preview: _stale, ...fresh } = card;
        cards = { ...cards, [id]: fresh };
      }
      const review: PendingReview = { card_id: id, rating: action.rating, reviewed_at: action.at, review_mode: action.mode ?? 'flashcard', was_new: card.state === 'new' };
      return {
        ...state,
        queue,
        cards,
        side: 'front',
        reviewed: state.reviewed + 1,
        ratings: { ...state.ratings, [action.rating]: state.ratings[action.rating] + 1 },
        seen: state.seen.includes(id) ? state.seen : [...state.seen, id],
        again: action.rating === 1 && !state.again.includes(id) ? [...state.again, id] : state.again,
        inflight: [...state.inflight, review],
      };
    }
    case 'server_ok': {
      const next = { ...state, inflight: without(state.inflight, action.review), failed: without(state.failed, action.review) };
      if (!action.card) return next;
      const id = action.card.id;
      const prev = state.cards[id];
      // Giữ preview hiện có nếu thẻ chưa bị chấm lại (server không trả preview ở POST review)
      next.cards = { ...state.cards, [id]: { ...action.card, preview: prev?.preview && action.review.rating !== 1 ? prev.preview : undefined } };
      if (action.review.was_new && !action.card.duplicate) next.learnedNew = state.learnedNew + 1;
      if (action.card.in_session && action.review.rating !== 1 && !next.queue.includes(id)) next.queue = [...next.queue, id];
      return next;
    }
    case 'server_quota': {
      const r = action.review;
      // Hoàn tác lượt bị từ chối + bỏ mọi thẻ mới còn trong hàng đợi (hạn mức thẻ mới đã hết)
      const queue = state.queue.filter((cid) => cid !== r.card_id && state.cards[cid]?.state !== 'new');
      const seenElsewhere = state.inflight.some((x) => x.card_id === r.card_id && !sameReview(x, r));
      return {
        ...state,
        queue,
        side: queue[0] === state.queue[0] ? state.side : 'front',
        inflight: without(state.inflight, r),
        failed: without(state.failed, r),
        reviewed: Math.max(0, state.reviewed - 1),
        ratings: { ...state.ratings, [r.rating]: Math.max(0, state.ratings[r.rating] - 1) },
        seen: seenElsewhere ? state.seen : state.seen.filter((x) => x !== r.card_id),
        again: r.rating === 1 && !seenElsewhere ? state.again.filter((x) => x !== r.card_id) : state.again,
        newLimit: { reached: true, resetAt: action.resetAt ?? state.newLimit.resetAt },
      };
    }
    case 'server_error':
      return { ...state, inflight: without(state.inflight, action.review), failed: state.failed.some((x) => sameReview(x, action.review)) ? state.failed : [...state.failed, action.review] };
    case 'retry': {
      const ids = action.reviews;
      return { ...state, failed: state.failed.filter((x) => !ids.some((y) => sameReview(x, y))), inflight: [...state.inflight, ...ids.filter((y) => !state.inflight.some((x) => sameReview(x, y)))] };
    }
    case 'previews': {
      let changed = false;
      const cards = { ...state.cards };
      for (const [id, p] of Object.entries(action.previews)) {
        const c = cards[id];
        if (c && !c.preview) {
          cards[id] = { ...c, preview: p };
          changed = true;
        }
      }
      return changed ? { ...state, cards } : state;
    }
    default:
      return state;
  }
}

export type SessionStatus = 'idle' | 'active' | 'saving' | 'done';

export function sessionStatus(s: SessionState): SessionStatus {
  if (!s.started) return 'idle';
  if (s.queue.length) return 'active';
  return s.inflight.length ? 'saving' : 'done';
}

export function currentCard(s: SessionState): SrsCard | null {
  const id = s.queue[0];
  return id ? (s.cards[id] ?? null) : null;
}

/** Tổng kết phiên: số thẻ, lượt, % nhớ (Good + Easy trên tổng lượt chấm), thẻ Again */
export function sessionSummary(s: SessionState): { cards: number; reviews: number; recall: number | null; again: number; learnedNew: number; ratings: Record<Rating, number> } {
  const good = s.ratings[3] + s.ratings[4];
  return { cards: s.seen.length, reviews: s.reviewed, recall: s.reviewed ? Math.round((good / s.reviewed) * 100) : null, again: s.again.length, learnedNew: s.learnedNew, ratings: s.ratings };
}

/** Tiến độ: thẻ đã xem xong (không còn trong hàng đợi) / tổng thẻ của phiên */
export function sessionProgress(s: SessionState): { done: number; total: number } {
  const total = Object.keys(s.cards).length;
  const remaining = new Set(s.queue).size;
  return { done: Math.max(0, total - remaining), total };
}

// ----------------------------------------------------------------------------- khoảng lịch xem trước

export type IntervalUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

/** Khoảng tới lần ôn kế (ISO `preview.*` − bây giờ) → {value, unit} để dịch "1 phút", "3 ngày"… (làm tròn, tối thiểu 1) */
export function intervalOf(dueIso: string | undefined | null, now: number = Date.now()): { value: number; unit: IntervalUnit } | null {
  if (!dueIso) return null;
  const t = Date.parse(dueIso);
  if (!Number.isFinite(t)) return null;
  // Ngưỡng theo giá trị đã làm tròn (vd 23 giờ 59 phút → "1 ngày", không "24 giờ")
  const min = Math.max(0, (t - now) / 60_000);
  if (min < 59.5) return { value: Math.max(1, Math.round(min)), unit: 'minute' };
  const h = min / 60;
  if (h < 23.5) return { value: Math.round(h), unit: 'hour' };
  const d = h / 24;
  if (d < 29.5) return { value: Math.round(d), unit: 'day' };
  if (d < 364.5) return { value: Math.round(d / 30), unit: 'month' };
  return { value: Math.round((d / 365) * 10) / 10, unit: 'year' };
}

// ----------------------------------------------------------------------------- phím tắt

export type KeyAction = { type: 'flip' } | { type: 'rate'; rating: Rating } | { type: 'speak' } | null;

/**
 * Phím tắt phiên ôn: Space/Enter lật thẻ; 1–4 chấm (chỉ khi đã lật); S hoặc P phát âm. Đang gõ trong ô (dictation, ghi chú) →
 * chỉ Enter được xử lý ở ô đó (trả null ở đây) để chữ số/khoảng trắng gõ được bình thường. Bỏ qua khi có phím bổ trợ.
 */
export function keyToAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean }, side: Side, typing: boolean): KeyAction {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing) return null;
  const k = e.key;
  if (k === ' ' || k === 'Spacebar' || k === 'Enter') return side === 'front' ? { type: 'flip' } : null;
  if (side === 'back' && (k === '1' || k === '2' || k === '3' || k === '4')) return { type: 'rate', rating: Number(k) as Rating };
  if (k === 's' || k === 'S' || k === 'p' || k === 'P') return { type: 'speak' };
  return null;
}

// ----------------------------------------------------------------------------- gõ lại từ (dictation mini)

/** Chuẩn hoá để so khớp chữ gõ: chữ thường, bỏ dấu câu đầu/cuối, gộp khoảng trắng, nháy cong → thẳng */
export function normalizeTyped(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export type DictationResult = 'correct' | 'close' | 'wrong';

/** Đúng hoàn toàn / gần đúng (sai ≤ 1 ký tự với từ ≥ 5 chữ) / sai */
export function checkDictation(typed: string, answer: string): DictationResult {
  const a = normalizeTyped(typed);
  const b = normalizeTyped(answer);
  if (!a) return 'wrong';
  if (a === b) return 'correct';
  return b.length >= 5 && levenshtein(a, b) <= 1 ? 'close' : 'wrong';
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Đánh giá gợi ý sau khi gõ (người học vẫn tự chọn): đúng → Good, gần đúng → Hard, sai → Again */
export function suggestedRating(r: DictationResult): Rating {
  return r === 'correct' ? 3 : r === 'close' ? 2 : 1;
}
