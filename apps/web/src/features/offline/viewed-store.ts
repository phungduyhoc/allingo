/**
 * "Đề đã xem" lưu cục bộ (localStorage) để trang offline liệt kê khi mất mạng (FR-PWA). Chỉ lưu thông tin hiển thị
 * (tên đề, loại trang, đường dẫn, thời điểm) – KHÔNG lưu câu hỏi/đáp án/bài làm. Tối đa 20 mục, mới nhất trước.
 */

export const VIEWED_KEY = 'allingo.viewed.v1';
export const VIEWED_MAX = 20;

export type ViewedKind = 'attempt' | 'result' | 'review' | 'test_set';

export interface ViewedEntry {
  /** attempt id (hoặc test set id cho kind = test_set) */
  id: string;
  kind: ViewedKind;
  title: string | null;
  /** Đường dẫn không gồm locale (vd. /attempts/<id>/review) */
  href: string;
  mode?: string | null;
  at: number;
}

export function parseViewed(raw: string | null | undefined): ViewedEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (x): x is ViewedEntry =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as ViewedEntry).id === 'string' &&
          typeof (x as ViewedEntry).href === 'string' &&
          (x as ViewedEntry).href.startsWith('/') &&
          !(x as ViewedEntry).href.startsWith('//'),
      )
      .map((x) => ({
        id: x.id,
        kind: x.kind,
        title: typeof x.title === 'string' ? x.title.slice(0, 160) : null,
        href: x.href,
        mode: x.mode ?? null,
        at: typeof x.at === 'number' ? x.at : 0,
      }))
      .slice(0, VIEWED_MAX);
  } catch {
    return [];
  }
}

/** Thêm/cập nhật (bất biến): cùng `id` → thay mục cũ, giữ tên đã biết nếu mục mới không có tên */
export function upsertViewed(list: readonly ViewedEntry[], entry: ViewedEntry, max = VIEWED_MAX): ViewedEntry[] {
  const prev = list.find((x) => x.id === entry.id);
  const merged: ViewedEntry = {
    ...entry,
    title: entry.title ?? prev?.title ?? null,
    mode: entry.mode ?? prev?.mode ?? null,
  };
  return [merged, ...list.filter((x) => x.id !== entry.id)].slice(0, max);
}

export function readViewed(): ViewedEntry[] {
  try {
    return parseViewed(window.localStorage.getItem(VIEWED_KEY));
  } catch {
    return [];
  }
}

export function recordViewed(entry: Omit<ViewedEntry, 'at'> & { at?: number }): void {
  try {
    const next = upsertViewed(readViewed(), { ...entry, at: entry.at ?? Date.now() });
    window.localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* storage không khả dụng → bỏ qua */
  }
}
