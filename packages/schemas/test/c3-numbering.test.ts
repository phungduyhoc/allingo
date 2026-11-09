import { describe, expect, it } from 'vitest';
import { IELTS_CBT, QUESTION_FIXTURES_ALL, markCount, numberMarks, validateTestSetStructure, type QuestionContent, type SectionSpec } from '../src/index.js';

/** C3/S167 – đánh số "Questions 1–40" liên tục theo mục và đếm cấu trúc đề IELTS theo mục */

const pick = (type: keyof typeof QUESTION_FIXTURES_ALL): QuestionContent => QUESTION_FIXTURES_ALL[type][0]!.content;

describe('numberMarks', () => {
  it('per_item: số bắt đầu = 1 + tổng mục các câu trước', () => {
    const contents = [pick('tfng'), pick('note_completion'), pick('mcq_single')];
    const n = numberMarks(contents, 'per_item');
    const [a, b] = contents.map(markCount);
    expect(n[0]).toEqual({ number_start: 1, mark_count: a });
    expect(n[1]).toEqual({ number_start: 1 + a!, mark_count: b });
    expect(n[2]).toEqual({ number_start: 1 + a! + b!, mark_count: 1 });
  });
  it('per_question (TOEIC): mỗi câu catalog một số – trùng order_no', () => {
    const contents = [pick('tfng'), pick('note_completion'), pick('mcq_single')];
    expect(numberMarks(contents, 'per_question').map((x) => x.number_start)).toEqual([1, 2, 3]);
    expect(numberMarks(contents, 'per_question').every((x) => x.mark_count === 1)).toBe(true);
  });
  it('rỗng → rỗng', () => expect(numberMarks([], 'per_item')).toEqual([]));
});

describe('validateTestSetStructure – marking per_item (IELTS)', () => {
  const sections: SectionSpec[] = [
    { code: 'reading_p1', skill: 'reading', question_count: 13, sort_order: 1 },
    { code: 'reading_p2', skill: 'reading', question_count: 13, sort_order: 2 },
    { code: 'reading_p3', skill: 'reading', question_count: 14, sort_order: 3 },
  ];
  const item = (ref: string, section: string, order: number, marks: number) => ({ question_ref: ref, section_code: section, sort_order: order, marks, group_key: section });
  const full = [item('a', 'reading_p1', 1, 6), item('b', 'reading_p1', 2, 7), item('c', 'reading_p2', 3, 13), item('d', 'reading_p3', 4, 5), item('e', 'reading_p3', 5, 9)];

  it('đề full đếm theo mục: 13/13/14 = 40 → hợp lệ', () => {
    const r = validateTestSetStructure('full', sections, full, { marking: 'per_item' });
    expect(r.issues).toEqual([]);
    expect(r.total).toBe(IELTS_CBT.total_marks);
    expect(r.by_section).toEqual({ reading_p1: 13, reading_p2: 13, reading_p3: 14 });
  });
  it('thiếu mục ở passage 3 → count_mismatch theo mục', () => {
    const r = validateTestSetStructure('full', sections, full.slice(0, 4), { marking: 'per_item' });
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'count_mismatch', section: 'reading_p3', expected: 14, actual: 5 }));
  });
  it('mặc định (per_question) giữ hành vi cũ: đếm câu catalog', () => {
    const r = validateTestSetStructure('full', sections, full);
    expect(r.total).toBe(5);
    expect(r.ok).toBe(false);
  });
});
