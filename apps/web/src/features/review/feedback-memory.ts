/**
 * Nhớ đánh giá 👍/👎/Sai của người học cho từng kết quả AI (theo `ai_task_id`) – chỉ là tiện ích hiển thị trên thiết bị,
 * nguồn thật là `ai.feedback` ở server (gửi lại cùng ai_task_id = cập nhật).
 *
 * Giải thích trúng cache nhận `ai_task_id` MỚI mỗi lần (API ghi một ai_task cache_hit), còn giải thích kèm trong Review
 * có `ai_task_id = null` → ngoài chỉ mục theo ai_task_id còn chỉ mục phụ theo khoá nội dung
 * (question_version × chosen_option × locale × prompt_version) để tải lại trang vẫn thấy lựa chọn cũ và
 * đổi đánh giá thì gửi lại cho ĐÚNG ai_task_id đã đánh giá (cập nhật, không tạo phản hồi mới).
 */

export type FeedbackRating = 'helpful' | 'not_helpful' | 'wrong';
export const FEEDBACK_RATINGS: readonly FeedbackRating[] = ['helpful', 'not_helpful', 'wrong'];

export interface FeedbackRecord {
  ai_task_id: string;
  rating: FeedbackRating;
  comment?: string;
  /** ms epoch – dùng để cắt bớt bản ghi cũ */
  at: number;
}

export interface FeedbackStore {
  tasks: Record<string, FeedbackRecord>;
  /** khoá nội dung → ai_task_id đã đánh giá */
  keys: Record<string, string>;
}

export const FEEDBACK_STORAGE_KEY = 'allingo.ai-feedback.v1';
export const FEEDBACK_MAX_RECORDS = 300;

export const emptyFeedbackStore = (): FeedbackStore => ({ tasks: {}, keys: {} });

/** Khoá nội dung của một giải thích (null khi thiếu phiên bản câu) */
export function explanationKey(questionVersionId: string | null | undefined, chosenOption: string | null | undefined, locale: string | null | undefined, promptVersionId: string | null | undefined): string | null {
  if (!questionVersionId) return null;
  return [questionVersionId, chosenOption ?? '', locale ?? '', promptVersionId ?? ''].join('|');
}

export function readFeedback(store: FeedbackStore, aiTaskId: string | null | undefined, key: string | null | undefined): FeedbackRecord | null {
  if (aiTaskId && store.tasks[aiTaskId]) return store.tasks[aiTaskId];
  const viaKey = key ? store.keys[key] : undefined;
  return viaKey ? (store.tasks[viaKey] ?? null) : null;
}

/** Ghi (bất biến): thêm/cập nhật bản ghi, gắn khoá nội dung, giữ tối đa FEEDBACK_MAX_RECORDS bản mới nhất */
export function writeFeedback(store: FeedbackStore, record: FeedbackRecord, key: string | null | undefined, max = FEEDBACK_MAX_RECORDS): FeedbackStore {
  const tasks = { ...store.tasks, [record.ai_task_id]: record };
  const keys = { ...store.keys };
  if (key) keys[key] = record.ai_task_id;
  const ids = Object.keys(tasks);
  if (ids.length > max) {
    const keep = new Set(
      ids
        .sort((a, b) => tasks[b]!.at - tasks[a]!.at)
        .slice(0, max),
    );
    for (const id of ids) if (!keep.has(id)) delete tasks[id];
    for (const [k, id] of Object.entries(keys)) if (!keep.has(id)) delete keys[k];
  }
  return { tasks, keys };
}

const isRating = (v: unknown): v is FeedbackRating => typeof v === 'string' && (FEEDBACK_RATINGS as readonly string[]).includes(v);

/** Đọc từ chuỗi JSON đã lưu; hỏng/sai dạng → kho rỗng (bỏ bản ghi lỗi) */
export function parseFeedbackStore(raw: string | null | undefined): FeedbackStore {
  if (!raw) return emptyFeedbackStore();
  try {
    const v = JSON.parse(raw) as { tasks?: Record<string, unknown>; keys?: Record<string, unknown> };
    const out = emptyFeedbackStore();
    for (const [id, r] of Object.entries(v.tasks ?? {})) {
      const rec = r as Partial<FeedbackRecord>;
      if (rec && rec.ai_task_id === id && isRating(rec.rating)) out.tasks[id] = { ai_task_id: id, rating: rec.rating, at: typeof rec.at === 'number' ? rec.at : 0, ...(typeof rec.comment === 'string' && rec.comment ? { comment: rec.comment } : {}) };
    }
    for (const [k, id] of Object.entries(v.keys ?? {})) if (typeof id === 'string' && out.tasks[id]) out.keys[k] = id;
    return out;
  } catch {
    return emptyFeedbackStore();
  }
}

// ----------------------------------------------------------------------------- kho dùng chung trong trình duyệt

let cache: FeedbackStore | null = null;
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: FeedbackStore = emptyFeedbackStore();

function load(): FeedbackStore {
  try {
    return parseFeedbackStore(window.localStorage.getItem(FEEDBACK_STORAGE_KEY));
  } catch {
    return emptyFeedbackStore();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== FEEDBACK_STORAGE_KEY) return;
    cache = null;
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): FeedbackStore {
  cache ??= load();
  return cache;
}

function save(record: FeedbackRecord, key: string | null | undefined): void {
  cache = writeFeedback(getSnapshot(), record, key);
  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* localStorage không khả dụng → chỉ nhớ trong phiên */
  }
  for (const l of listeners) l();
}

/** Kho cho useSyncExternalStore (đồng bộ giữa các thẻ giải thích và giữa các tab qua sự kiện storage) */
export const feedbackStore = {
  subscribe,
  getSnapshot,
  getServerSnapshot: (): FeedbackStore => SERVER_SNAPSHOT,
  save,
} as const;
