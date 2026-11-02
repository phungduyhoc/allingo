import { addDays, weekdayOf } from '@allingo/planner';

/**
 * Hàm thuần cho thống kê dashboard (Sprint 10) – test đơn vị: cộng breakdown, so sánh độ chính xác hai cửa sổ, percentile
 * ẩn danh, nhóm mục tiêu, tuần (thứ Hai) theo giờ người học.
 */

export type Cell = { correct: number; total: number };
export type Breakdown = Record<string, Cell | undefined>;

export function sumCells(list: ReadonlyArray<Breakdown | null | undefined>): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const b of list) {
    for (const [k, v] of Object.entries(b ?? {})) {
      if (!v || typeof v.total !== 'number') continue;
      const cur = (out[k] ??= { correct: 0, total: 0 });
      cur.correct += Number(v.correct) || 0;
      cur.total += Number(v.total) || 0;
    }
  }
  return out;
}

/** Độ chính xác (%) làm tròn 1 chữ số; total = 0 → null */
export function accuracyPct(c: Cell): number | null {
  return c.total > 0 ? Math.round((c.correct / c.total) * 1000) / 10 : null;
}

export interface AccuracyCompare {
  current: { correct: number; total: number; accuracy: number | null };
  previous: { correct: number; total: number; accuracy: number | null };
  /** Điểm phần trăm (current − previous); null khi một trong hai không có dữ liệu */
  delta: number | null;
}

export function compareAccuracy(current: Record<string, Cell>, previous: Record<string, Cell>): Record<string, AccuracyCompare> {
  const out: Record<string, AccuracyCompare> = {};
  for (const k of [...new Set([...Object.keys(current), ...Object.keys(previous)])].sort()) {
    const c = current[k] ?? { correct: 0, total: 0 };
    const p = previous[k] ?? { correct: 0, total: 0 };
    const ca = accuracyPct(c);
    const pa = accuracyPct(p);
    out[k] = { current: { ...c, accuracy: ca }, previous: { ...p, accuracy: pa }, delta: ca !== null && pa !== null ? Math.round((ca - pa) * 10) / 10 : null };
  }
  return out;
}

/** Percentile (0–100, 1 chữ số) của `value` trong mẫu: % thấp hơn + ½ % bằng (mid-rank) */
export function percentileOf(value: number, sample: readonly number[]): number | null {
  if (!sample.length) return null;
  let below = 0;
  let equal = 0;
  for (const s of sample) {
    if (s < value) below++;
    else if (s === value) equal++;
  }
  return Math.round(((below + equal / 2) / sample.length) * 1000) / 10;
}

/** Nhóm mục tiêu ẩn danh: TOEIC theo trăm (600–695 → "600-695"), IELTS theo 0,5 band, còn lại theo chục; không mục tiêu → null */
export function targetBucket(program: string, target: number | null): { label: string; lo: number; hi: number } | null {
  if (target === null || !Number.isFinite(target)) return null;
  if (program === 'ielts') {
    const lo = Math.floor(target * 2) / 2;
    return { label: lo.toFixed(1), lo, hi: lo + 0.5 };
  }
  const step = program === 'toeic' ? 100 : 10;
  const lo = Math.floor(target / step) * step;
  return { label: `${lo}-${lo + step - (program === 'toeic' ? 5 : 1)}`, lo, hi: lo + step };
}

/** Thứ Hai của tuần chứa ngày `iso` (YYYY-MM-DD) */
export function mondayOf(iso: string): string {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return addDays(iso, -order.indexOf(weekdayOf(iso)));
}

/** n thứ Hai gần nhất (cũ → mới) kết thúc ở tuần chứa `today` */
export function lastWeekStarts(today: string, n = 8): string[] {
  const cur = mondayOf(today);
  return Array.from({ length: n }, (_, i) => addDays(cur, -7 * (n - 1 - i)));
}

/** Tối thiểu số người trong nhóm để công bố percentile (ẩn danh) */
export const COHORT_MIN_SIZE = 10;
