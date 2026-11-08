import { describe, expect, it } from 'vitest';
import type { ErrorLogEntry } from '@allingo/schemas';
import { applyEntryPatch, DEFAULT_ERROR_FILTERS, errorDrillBody, errorFiltersToQuery, errorFiltersToSearch, parseErrorFilters, sortedCounts, sortedSections } from './filters';

const entry = (id: string, extra: Partial<ErrorLogEntry> = {}): ErrorLogEntry => ({
  id,
  kind: 'grammar',
  kind_auto: 'grammar',
  reason_auto: {},
  reason_override: null,
  question: null,
  question_id: null,
  question_version_id: null,
  section_code: 'part5',
  subskill: 'word_form',
  topic: null,
  your_answer: 'A',
  correct_answer: 'B',
  time_spent_ms: 12000,
  occurrences: 1,
  note: null,
  resolved: false,
  resolved_at: null,
  srs_card_id: null,
  attempt_id: null,
  created_at: '2026-11-01T00:00:00.000Z',
  last_seen_at: '2026-11-01T00:00:00.000Z',
  ...extra,
});

describe('bộ lọc sổ lỗi', () => {
  it('đọc URL: giá trị hợp lệ giữ, giá trị lạ → mặc định', () => {
    expect(parseErrorFilters(new URLSearchParams(''))).toEqual(DEFAULT_ERROR_FILTERS);
    expect(parseErrorFilters(new URLSearchParams('kind=trap&part=part2&status=all&days=7&sort=oldest'))).toEqual({ kind: 'trap', part: 'part2', status: 'all', days: 7, sort: 'oldest' });
    expect(parseErrorFilters(new URLSearchParams('kind=hack&part=part9&status=x&days=15&sort=y'))).toEqual(DEFAULT_ERROR_FILTERS);
    expect(parseErrorFilters(new URLSearchParams('days=0')).days).toBe(0);
  });

  it('ghi URL: chỉ giá trị khác mặc định + giữ ?task=', () => {
    expect(errorFiltersToSearch(DEFAULT_ERROR_FILTERS)).toBe('');
    expect(errorFiltersToSearch({ ...DEFAULT_ERROR_FILTERS, kind: 'timeout', days: 0 }, { task: 't1' })).toBe('kind=timeout&days=0&task=t1');
    const round = parseErrorFilters(new URLSearchParams(errorFiltersToSearch({ kind: 'vocabulary', part: 'part7', status: 'resolved', days: 7, sort: 'oldest' })));
    expect(round).toEqual({ kind: 'vocabulary', part: 'part7', status: 'resolved', days: 7, sort: 'oldest' });
  });

  it('query API', () => {
    expect(errorFiltersToQuery({ ...DEFAULT_ERROR_FILTERS, part: 'part5' })).toEqual({ program: 'toeic', kind: null, part: 'part5', status: 'open', days: 30, sort: 'newest', limit: 20 });
  });

  it('drill: đã chọn → entry_ids (≤ 10, bỏ trùng); không chọn → theo loại/Part đang lọc; kèm plan_task_id', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `e${i}`);
    expect(errorDrillBody(DEFAULT_ERROR_FILTERS, [...ids, 'e1']).entry_ids).toHaveLength(10);
    expect(errorDrillBody({ ...DEFAULT_ERROR_FILTERS, kind: 'trap', part: 'part2' }, [])).toEqual({ program: 'toeic', limit: 10, kind: 'trap', part: 'part2' });
    expect(errorDrillBody(DEFAULT_ERROR_FILTERS, ['e1'], 'task-9')).toEqual({ program: 'toeic', entry_ids: ['e1'], plan_task_id: 'task-9' });
  });

  it('phân bố theo loại giảm dần, theo Part đúng thứ tự part1…part7', () => {
    expect(sortedCounts({ grammar: 2, trap: 5, other: 0, vocabulary: 2 })).toEqual([
      ['trap', 5],
      ['grammar', 2],
      ['vocabulary', 2],
    ]);
    expect(sortedSections({ part7: 1, part2: 3, part10: 1, part5: 2 }).map(([k]) => k)).toEqual(['part2', 'part5', 'part7', 'part10']);
  });

  it('cập nhật lạc quan: đổi lý do → kind hiệu lực; đã hiểu rời danh sách "chưa hiểu"; ghi chú rỗng → null', () => {
    const list = [entry('a'), entry('b')];
    expect(applyEntryPatch(list, 'a', { reason_override: 'trap' }, 'open')[0]).toMatchObject({ kind: 'trap', reason_override: 'trap' });
    expect(applyEntryPatch(list, 'a', { reason_override: null }, 'open')[0]).toMatchObject({ kind: 'grammar', reason_override: null });
    expect(applyEntryPatch(list, 'a', { resolved: true }, 'open').map((e) => e.id)).toEqual(['b']);
    const all = applyEntryPatch(list, 'a', { resolved: true }, 'all', '2026-11-08T00:00:00.000Z');
    expect(all[0]).toMatchObject({ resolved: true, resolved_at: '2026-11-08T00:00:00.000Z' });
    expect(applyEntryPatch([entry('c', { resolved: true })], 'c', { resolved: false }, 'resolved')).toEqual([]);
    expect(applyEntryPatch(list, 'b', { note: '   ' }, 'open')[1]?.note).toBeNull();
  });
});
