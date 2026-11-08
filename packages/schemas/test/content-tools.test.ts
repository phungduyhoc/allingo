import { describe, expect, it } from 'vitest';
import {
  allocateDifficulty,
  checkBlueprintCounts,
  draftTestInputSchema,
  isExampleRow,
  missingImportColumns,
  parseImportRow,
  planGroups,
  reviewBulkInputSchema,
  reviewQueueQuerySchema,
  runAutoChecks,
  splitMergedPassage,
  IMPORT_COLUMNS,
} from '../src/index.js';

const mcq = (over: Record<string, unknown> = {}) => ({ type: 'mcq_single', stem: 'The team ______ the report yesterday.', options: ['A', 'B', 'C', 'D'].map((key, i) => ({ key, text: ['reviewed', 'reviews', 'reviewing', 'review'][i]! })), answer_key: { correct: 'A' }, explanation: { vi: 'Quá khứ đơn.' }, ...over });
const codes = (r: Array<{ code: string }>) => r.map((x) => x.code).sort();

describe('B2 – runAutoChecks', () => {
  it('câu Part 5 hợp lệ → không lỗi', () => {
    expect(runAutoChecks({ program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: mcq(), has_passage: false, section_rules: {} })).toEqual([]);
  });
  it('đáp án ngoài phương án, phương án trùng, thiếu đề bài, thiếu giải thích', () => {
    const r = runAutoChecks({ program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: mcq({ stem: '', answer_key: { correct: 'E' }, explanation: undefined, options: [{ key: 'A', text: 'x' }, { key: 'B', text: 'x' }, { key: 'C', text: 'y' }, { key: 'D', text: 'z' }] }), has_passage: false });
    expect(codes(r)).toEqual(['answer_key_not_in_options', 'duplicate_options', 'explanation_missing', 'stem_missing']);
    expect(r.find((x) => x.code === 'answer_key_not_in_options')).toMatchObject({ level: 'error', params: { key: 'E' } });
  });
  it('Part 2: 3 phương án chuẩn, không bắt buộc đề bài chữ; thiếu audio → cảnh báo', () => {
    const r = runAutoChecks({ program: 'toeic', section_code: 'part2', question_type: 'mcq_single', content: mcq({ stem: '' }), has_passage: false, section_rules: { audio_once: true } });
    expect(codes(r)).toEqual(['audio_missing', 'option_count']);
    expect(r.every((x) => x.level === 'warning')).toBe(true);
  });
  it('Part có group_size cần passage; audio nhóm (passage) đủ cho Part 3; Part 1 cần ảnh', () => {
    expect(codes(runAutoChecks({ program: 'toeic', section_code: 'part7', question_type: 'mcq_single', content: mcq(), has_passage: false, section_rules: { group_size: [2, 3] } }))).toEqual(['passage_missing']);
    expect(runAutoChecks({ program: 'toeic', section_code: 'part3', question_type: 'mcq_single', content: mcq(), has_passage: true, passage_has_audio: true, section_rules: { audio_once: true, group_size: 3 } })).toEqual([]);
    expect(codes(runAutoChecks({ program: 'toeic', section_code: 'part1', question_type: 'mcq_single', content: mcq({ stem: '' }), has_passage: false, section_rules: { has_image: true } }))).toEqual(['image_missing']);
  });
  it('nội dung sai schema / lệch dạng câu', () => {
    expect(codes(runAutoChecks({ program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: { type: 'mcq_single' }, has_passage: false }))).toEqual(['content_invalid']);
    expect(codes(runAutoChecks({ program: 'toeic', section_code: 'part5', question_type: 'mcq_multi', content: mcq(), has_passage: false }))).toContain('type_mismatch');
  });
});

describe('B2 – blueprint soạn đề', () => {
  it('allocateDifficulty: đúng tổng, tỉ lệ theo phần dư lớn nhất, tất định', () => {
    const a = allocateDifficulty(10, { A2: 30, B1: 50, B2: 20 });
    expect(a).toHaveLength(10);
    expect(a.filter((x) => x === 'A2')).toHaveLength(3);
    expect(a.filter((x) => x === 'B1')).toHaveLength(5);
    expect(a.filter((x) => x === 'B2')).toHaveLength(2);
    expect(allocateDifficulty(7, { A2: 1, B1: 1, B2: 1 })).toEqual(allocateDifficulty(7, { A2: 1, B1: 1, B2: 1 }));
    expect(allocateDifficulty(7, { A2: 1, B1: 1, B2: 1 })).toHaveLength(7);
    expect(allocateDifficulty(3, undefined)).toEqual(['B1', 'B1', 'B1']);
    expect(allocateDifficulty(0, { B1: 1 })).toEqual([]);
  });
  it('planGroups: chia nhóm passage hoặc null khi không chia được', () => {
    expect(planGroups(9, [3])).toEqual([3, 3, 3]);
    expect(planGroups(10, [3])).toBeNull();
    expect(planGroups(7, [2, 3, 4, 5])).toEqual([5, 2]);
    const g = planGroups(12, [2, 3, 4, 5])!;
    expect(g.reduce((s, x) => s + x, 0)).toBe(12);
    expect(g).toHaveLength(3);
    expect(planGroups(4, [4])).toEqual([4]);
  });
  it('checkBlueprintCounts: thiếu/thừa/Part ngoài blueprint', () => {
    const r = checkBlueprintCounts([{ section_code: 'part5', count: 2 }, { section_code: 'part6', count: 1 }], [{ section_code: 'part5' }, { section_code: 'part5' }, { section_code: 'part6' }, { section_code: 'part6' }, { section_code: 'part7' }]);
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([
      { section_code: 'part5', required: 2, actual: 2, diff: 0 },
      { section_code: 'part6', required: 1, actual: 2, diff: 1 },
    ]);
    expect(r.extra_sections).toEqual(['part7']);
    expect(checkBlueprintCounts([{ section_code: 'part5', count: 1 }], [{ section_code: 'part5' }]).ok).toBe(true);
  });
  it('splitMergedPassage: ≥ 2 nhãn [Tiêu đề] → văn bản; mốc số không phải nhãn', () => {
    expect(splitMergedPassage('[E-mail]\nHello [1] team.\n\n[Notice]\nOpen at 9.')).toEqual([
      { title: 'E-mail', body: 'Hello [1] team.' },
      { title: 'Notice', body: 'Open at 9.' },
    ]);
    expect(splitMergedPassage('Only one text with [131] blank.')).toEqual([]);
    expect(splitMergedPassage('[E-mail]\nOnly one')).toEqual([]);
    expect(splitMergedPassage('[131]\nnot a heading\n[132]\nnot either')).toEqual([]);
  });
  it('draftTestInputSchema: mặc định toeic/mini, topics []', () => {
    const v = draftTestInputSchema.parse({ blueprint: { sections: [{ section_code: 'part5', count: 3 }] } });
    expect(v).toMatchObject({ program: 'toeic', kind: 'mini', blueprint: { topics: [] } });
    expect(draftTestInputSchema.safeParse({ blueprint: { sections: [] } }).success).toBe(false);
  });
});

describe('B2 – mẫu nhập Excel', () => {
  const row = (over: Record<string, string> = {}) => ({ import_key: 'k1', program: 'toeic', section_code: 'part5', question_type: 'mcq_single', difficulty: 'B1', stem: 'The shipment ______ on Monday.', option_a: 'arrived', option_b: 'arriving', option_c: 'arrives', option_d: '', correct: 'A', explanation_vi: 'Quá khứ.', tags: 'tense|time', ...over });
  it('dòng hợp lệ → mcq_single (C giữ, D rỗng bỏ), tags tách |', () => {
    const r = parseImportRow(4, row());
    expect(r.issues).toEqual([]);
    expect(r.value).toMatchObject({ row: 4, import_key: 'k1', program: 'toeic', section_code: 'part5', difficulty: 'B1', passage: null });
    expect((r.value!.content as { options: unknown[] }).options).toHaveLength(3);
    expect((r.value!.content as { tags: string[] }).tags).toEqual(['tense', 'time']);
  });
  it('lỗi theo cột: đáp án ngoài phương án, giá trị lạ, thiếu bắt buộc, passage thiếu khoá', () => {
    const r = parseImportRow(5, row({ correct: 'D', difficulty: 'Z9', stem: '', program: 'toefl', passage_body: 'x' }));
    expect(r.value).toBeNull();
    expect(r.issues.map((i) => `${i.column}:${i.code}`).sort()).toEqual(['correct:answer_not_in_options', 'difficulty:invalid_value', 'passage_key:required', 'program:invalid_value', 'stem:required']);
    expect(parseImportRow(6, row({ question_type: 'gap_fill' })).issues[0]).toMatchObject({ column: 'question_type', code: 'unsupported_type' });
    expect(parseImportRow(7, row({ correct: 'E' })).issues[0]).toMatchObject({ column: 'correct', code: 'invalid_value' });
  });
  it('TOEIC Part 2 không cần đề bài chữ', () => {
    expect(parseImportRow(8, row({ section_code: 'part2', stem: '' })).issues).toEqual([]);
  });
  it('cột bắt buộc + dòng ví dụ', () => {
    expect(missingImportColumns(['program', 'stem'])).toEqual(['section_code', 'question_type', 'option_a', 'option_b', 'correct']);
    expect(missingImportColumns(IMPORT_COLUMNS.map((c) => c.key))).toEqual([]);
    expect(isExampleRow({ import_key: 'vd-001' })).toBe(true);
    expect(isExampleRow({ import_key: 'X-1' })).toBe(false);
  });
});

describe('B2 – Zod đầu vào API', () => {
  it('bulk: lý do bắt buộc khi reject/needs_change', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(reviewBulkInputSchema.safeParse({ question_ids: [id], action: 'reject' }).success).toBe(false);
    expect(reviewBulkInputSchema.safeParse({ question_ids: [id], action: 'reject', notes: 'sai đáp án' }).success).toBe(true);
    expect(reviewBulkInputSchema.safeParse({ question_ids: [id], action: 'approve' }).success).toBe(true);
  });
  it('queue query: boolean từ chuỗi, me/none, mặc định sắp xếp', () => {
    expect(reviewQueueQuerySchema.parse({ duplicate: 'true', assignee: 'none', created_by: 'me' })).toMatchObject({ duplicate: true, assignee: 'none', created_by: 'me', sort: 'created_at', order: 'desc', limit: 30 });
    expect(reviewQueueQuerySchema.safeParse({ assignee: 'someone' }).success).toBe(false);
  });
});
