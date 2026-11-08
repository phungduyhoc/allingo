import { ERROR_DRILL_MAX, ERROR_KINDS, type ErrorKind, type ErrorLogEntry, type ErrorPatch } from '@allingo/schemas/api/learning-s10';
import type { ErrorDrillBody, ErrorQuery } from '@/lib/s10-api';

/**
 * Bộ lọc sổ lỗi (S10) – thuần, có test. Trạng thái lọc nằm trên URL (`?kind=&part=&status=&days=&sort=`) để chia sẻ/tải lại
 * giữ nguyên; giá trị lạ → mặc định. `days` = cửa sổ theo lần sai gần nhất (7 / 30 / 0 = mọi lúc – spec FR-EL).
 */

export const ERROR_STATUSES = ['open', 'resolved', 'all'] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];
export const ERROR_WINDOWS = [7, 30, 0] as const;
export type ErrorWindow = (typeof ERROR_WINDOWS)[number];
export const TOEIC_PARTS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] as const;

export interface ErrorFilters {
  kind: ErrorKind | null;
  part: string | null;
  status: ErrorStatus;
  days: ErrorWindow;
  sort: 'newest' | 'oldest';
}

export const DEFAULT_ERROR_FILTERS: ErrorFilters = { kind: null, part: null, status: 'open', days: 30, sort: 'newest' };

const isKind = (v: string | null): v is ErrorKind => !!v && (ERROR_KINDS as readonly string[]).includes(v);

export function parseErrorFilters(sp: Pick<URLSearchParams, 'get'>): ErrorFilters {
  const kind = sp.get('kind');
  const part = sp.get('part');
  const status = sp.get('status');
  const days = Number(sp.get('days') ?? NaN);
  const sort = sp.get('sort');
  return {
    kind: isKind(kind) ? kind : null,
    part: part && /^part[1-7]$/.test(part) ? part : null,
    status: (ERROR_STATUSES as readonly string[]).includes(status ?? '') ? (status as ErrorStatus) : DEFAULT_ERROR_FILTERS.status,
    days: (ERROR_WINDOWS as readonly number[]).includes(days) ? (days as ErrorWindow) : DEFAULT_ERROR_FILTERS.days,
    sort: sort === 'oldest' ? 'oldest' : 'newest',
  };
}

/** Chuỗi query (không dấu "?") – chỉ ghi giá trị khác mặc định; giữ tham số khác (vd `task`) nếu truyền `keep` */
export function errorFiltersToSearch(f: ErrorFilters, keep: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  if (f.kind) p.set('kind', f.kind);
  if (f.part) p.set('part', f.part);
  if (f.status !== DEFAULT_ERROR_FILTERS.status) p.set('status', f.status);
  if (f.days !== DEFAULT_ERROR_FILTERS.days) p.set('days', String(f.days));
  if (f.sort !== DEFAULT_ERROR_FILTERS.sort) p.set('sort', f.sort);
  for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
  return p.toString();
}

export function errorFiltersToQuery(f: ErrorFilters, program = 'toeic'): ErrorQuery {
  return { program, kind: f.kind, part: f.part, status: f.status, days: f.days, sort: f.sort, limit: 20 };
}

/**
 * Thân "Làm lại câu sai": đã chọn (≤ 10, chỉ lỗi chưa hiểu) → `entry_ids`; không chọn → 10 lỗi chưa hiểu cũ nhất theo loại/Part
 * đang lọc (server chọn). Kèm `plan_task_id` khi mở từ task `review_errors`.
 */
export function errorDrillBody(f: ErrorFilters, selected: readonly string[], planTaskId?: string | null, program = 'toeic'): ErrorDrillBody {
  const ids = [...new Set(selected)].slice(0, ERROR_DRILL_MAX);
  const base: ErrorDrillBody = ids.length ? { program, entry_ids: ids } : { program, limit: ERROR_DRILL_MAX, ...(f.kind ? { kind: f.kind } : {}), ...(f.part ? { part: f.part } : {}) };
  return planTaskId ? { ...base, plan_task_id: planTaskId } : base;
}

/** Phân bố theo loại → [loại, số] giảm dần (bỏ 0) */
export function sortedCounts(dist: Record<string, number>): Array<[string, number]> {
  return Object.entries(dist)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Theo Part → thứ tự part1…part7 (khác → cuối) */
export function sortedSections(bySection: Record<string, number>): Array<[string, number]> {
  const order = (k: string) => {
    const i = (TOEIC_PARTS as readonly string[]).indexOf(k);
    return i < 0 ? 99 : i;
  };
  return Object.entries(bySection)
    .filter(([, n]) => n > 0)
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
}

/**
 * Cập nhật lạc quan một mục trong danh sách đang xem: đổi lý do → `kind` hiệu lực = override ?? kind_auto; đánh dấu hiểu/mở lại
 * → mục rời danh sách nếu không còn khớp bộ lọc trạng thái.
 */
export function applyEntryPatch(entries: readonly ErrorLogEntry[], id: string, patch: ErrorPatch, status: ErrorStatus, now = new Date().toISOString()): ErrorLogEntry[] {
  const out: ErrorLogEntry[] = [];
  for (const e of entries) {
    if (e.id !== id) {
      out.push(e);
      continue;
    }
    const next: ErrorLogEntry = { ...e };
    if (patch.reason_override !== undefined) {
      next.reason_override = patch.reason_override;
      next.kind = patch.reason_override ?? e.kind_auto;
    }
    if (patch.note !== undefined) next.note = patch.note && patch.note.trim() ? patch.note.trim() : null;
    if (patch.resolved !== undefined) {
      next.resolved = patch.resolved;
      next.resolved_at = patch.resolved ? now : null;
    }
    if ((status === 'open' && next.resolved) || (status === 'resolved' && !next.resolved)) continue;
    out.push(next);
  }
  return out;
}
