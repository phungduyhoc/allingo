/**
 * Bộ lọc màn Xem lại (giữ trên URL: ?filter=wrong|flagged&section=part5) → tham số API
 * `GET /attempts/{id}/review?only_wrong=&flagged=&section=`; điều hướng "Câu sai trước/tiếp theo".
 * Hàm thuần để test bằng Vitest.
 */

export const REVIEW_FILTERS = ['all', 'wrong', 'flagged'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export interface ReviewFilters {
  filter: ReviewFilter;
  section: string | null;
}

export interface ReviewApiQuery {
  only_wrong?: boolean;
  flagged?: boolean;
  section?: string;
}

const SECTION_RE = /^[a-z0-9_]{1,32}$/;

export function parseReviewFilters(params: Pick<URLSearchParams, 'get'> | null | undefined): ReviewFilters {
  const f = params?.get('filter');
  const s = params?.get('section');
  return {
    filter: f && (REVIEW_FILTERS as readonly string[]).includes(f) ? (f as ReviewFilter) : 'all',
    section: s && SECTION_RE.test(s) ? s : null,
  };
}

/** Chuỗi query (không có "?"), bỏ giá trị mặc định để URL gọn */
export function reviewFiltersToSearch(f: ReviewFilters): string {
  const qs = new URLSearchParams();
  if (f.filter !== 'all') qs.set('filter', f.filter);
  if (f.section) qs.set('section', f.section);
  return qs.toString();
}

export function reviewApiQuery(f: ReviewFilters): ReviewApiQuery {
  const q: ReviewApiQuery = {};
  if (f.filter === 'wrong') q.only_wrong = true;
  if (f.filter === 'flagged') q.flagged = true;
  if (f.section) q.section = f.section;
  return q;
}

export type ReviewFilterAction = { type: 'filter'; filter: ReviewFilter } | { type: 'section'; section: string | null } | { type: 'reset' };

export function reviewFiltersReducer(state: ReviewFilters, action: ReviewFilterAction): ReviewFilters {
  switch (action.type) {
    case 'filter':
      return { ...state, filter: action.filter };
    case 'section':
      return { ...state, section: action.section && SECTION_RE.test(action.section) ? action.section : null };
    case 'reset':
      return { filter: 'all', section: null };
  }
}

/** Chỉ số (trong danh sách đang hiển thị) của các câu sai */
export function wrongIndices(items: ReadonlyArray<{ is_correct: boolean | null }>): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.is_correct === false) out.push(i);
  });
  return out;
}

/**
 * Câu sai kế tiếp/trước so với vị trí `cursor` (chỉ số câu đang xem, null = chưa điều hướng). Không quay vòng:
 * hết danh sách → null (nút bị vô hiệu).
 */
export function stepWrong(wrong: readonly number[], cursor: number | null, dir: 1 | -1): number | null {
  if (!wrong.length) return null;
  if (cursor === null) return dir === 1 ? wrong[0]! : wrong[wrong.length - 1]!;
  if (dir === 1) return wrong.find((i) => i > cursor) ?? null;
  for (let k = wrong.length - 1; k >= 0; k--) if (wrong[k]! < cursor) return wrong[k]!;
  return null;
}

/** Vị trí 1-based của câu sai đang xem trong danh sách câu sai (0 khi chưa điều hướng/không phải câu sai) */
export function wrongPosition(wrong: readonly number[], cursor: number | null): number {
  return cursor === null ? 0 : wrong.indexOf(cursor) + 1;
}
