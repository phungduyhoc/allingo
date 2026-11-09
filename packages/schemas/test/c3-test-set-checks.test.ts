import { describe, expect, it } from 'vitest';
import { runTestSetChecks, type SectionSpec, type TestSetCheckItem } from '../src/index.js';

/** C3 – kiểm tra tự động cấp bộ đề IELTS: tổng 40 mục, số mục từng part/passage, đánh số liên tục, audio mỗi part Listening */

const reading: SectionSpec[] = [
  { code: 'reading_p1', skill: 'reading', question_count: 13, sort_order: 1 },
  { code: 'reading_p2', skill: 'reading', question_count: 13, sort_order: 2 },
  { code: 'reading_p3', skill: 'reading', question_count: 14, sort_order: 3 },
];
const listening: SectionSpec[] = ['listening_p1', 'listening_p2', 'listening_p3', 'listening_p4'].map((code, i) => ({ code, skill: 'listening', question_count: 10, sort_order: i + 1 }));

let order = 0;
const item = (section: string, marks: number | null, extra: Partial<TestSetCheckItem> = {}): TestSetCheckItem => ({ section_code: section, sort_order: ++order, marks, group_key: section, ...extra });

const readingFull = () => [item('reading_p1', 6), item('reading_p1', 7), item('reading_p2', 13), item('reading_p3', 5), item('reading_p3', 9)];
const listeningFull = () =>
  listening.flatMap((s) => [item(s.code, 4, { has_audio: true, audio_key: `a-${s.code}` }), item(s.code, 6, { has_audio: true, audio_key: `a-${s.code}` })]);

describe('runTestSetChecks – IELTS', () => {
  it('Reading full 13/13/14 = 40 mục, đánh số liền → không lỗi', () => {
    expect(runTestSetChecks({ program: 'ielts', kind: 'full', sections: reading, items: readingFull() })).toEqual([]);
  });
  it('Listening full 4 part × 10, mỗi part một audio → không lỗi', () => {
    expect(runTestSetChecks({ program: 'ielts', kind: 'full', sections: listening, items: listeningFull() })).toEqual([]);
  });
  it('thiếu mục: báo tổng ≠ 40 và part lệch số mục', () => {
    const items = readingFull().slice(0, 4);
    const r = runTestSetChecks({ program: 'ielts', kind: 'full', sections: reading, items });
    expect(r).toContainEqual({ code: 'ielts_mark_total', level: 'error', params: { skill: 'reading', expected: 40, actual: 31 } });
    expect(r).toContainEqual({ code: 'ielts_section_marks', level: 'error', params: { section: 'reading_p3', expected: 14, actual: 5 } });
  });
  it('câu thiếu số mục → numbering_gap tại số câu đầu tiên của câu đó', () => {
    const items = readingFull();
    items[1] = { ...items[1]!, marks: null };
    const r = runTestSetChecks({ program: 'ielts', kind: 'full', sections: reading, items });
    expect(r).toContainEqual({ code: 'numbering_gap', level: 'error', params: { section: 'reading_p1', sort_order: items[1].sort_order, number: 7 } });
  });
  it('part Listening thiếu audio: full → lỗi; mini → cảnh báo', () => {
    const items = listeningFull().map((it) => (it.section_code === 'listening_p3' ? { ...it, has_audio: false, audio_key: null } : it));
    expect(runTestSetChecks({ program: 'ielts', kind: 'full', sections: listening, items })).toContainEqual({ code: 'listening_part_audio_missing', level: 'error', params: { section: 'listening_p3' } });
    const mini = items.filter((it) => it.section_code === 'listening_p3');
    expect(runTestSetChecks({ program: 'ielts', kind: 'mini', sections: listening, items: mini })).toEqual([{ code: 'listening_part_audio_missing', level: 'warning', params: { section: 'listening_p3' } }]);
  });
  it('part Listening có nhiều audio khác nhau → cảnh báo (phát liên tục một audio mỗi part)', () => {
    const items = listeningFull().map((it, i) => (i === 1 ? { ...it, audio_key: 'khac' } : it));
    expect(runTestSetChecks({ program: 'ielts', kind: 'full', sections: listening, items })).toContainEqual({ code: 'listening_part_multiple_audio', level: 'warning', params: { section: 'listening_p1', count: 2 } });
  });
  it('đề mini IELTS không áp tổng 40 mục', () => {
    expect(runTestSetChecks({ program: 'ielts', kind: 'mini', sections: reading, items: [item('reading_p1', 5)] })).toEqual([]);
  });
  it('dùng registry khi sections không khai báo section', () => {
    const r = runTestSetChecks({ program: 'ielts', kind: 'mini', sections: [], items: [item('listening_p1', 3)] });
    expect(r).toEqual([{ code: 'listening_part_audio_missing', level: 'warning', params: { section: 'listening_p1' } }]);
  });
});

describe('runTestSetChecks – TOEIC (per_question)', () => {
  it('không đòi số mục (marks bỏ trống vẫn hợp lệ); Part Listening thiếu audio vẫn được báo', () => {
    const sections: SectionSpec[] = [{ code: 'part5', skill: 'reading', question_count: 30, sort_order: 5 }, { code: 'part1', skill: 'listening', question_count: 6, sort_order: 1 }];
    expect(runTestSetChecks({ program: 'toeic', kind: 'mini', sections, items: [item('part5', null)] })).toEqual([]);
    expect(runTestSetChecks({ program: 'toeic', kind: 'mini', sections, items: [item('part1', null)] })).toEqual([{ code: 'listening_part_audio_missing', level: 'warning', params: { section: 'part1' } }]);
  });
});
