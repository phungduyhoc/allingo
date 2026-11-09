import { describe, expect, it } from 'vitest';
import { QUESTION_FIXTURES_ALL, markCount } from '@allingo/schemas';
import { addQuestions, BUILDER_BLUEPRINTS, blueprintErrors, blueprintReport, blueprintsFor, builderSectionCodes, countsByMarks, countUnitLabel, marksOfContent, type BuilderState } from '../src/lib/test-set-builder';
import { catalogLevelOf, describeTestSetCheck, testSetCheckIssues, type ItemCheckInfo, type TestSetShape } from '../src/lib/validate';

/** C3 – soạn đề IELTS trong CMS: blueprint theo câu hỏi (mục), thứ tự part theo registry, kiểm tra tự động cấp bộ đề, module Academic/GT */

const tfng = QUESTION_FIXTURES_ALL.tfng[0]!.content;
const note = QUESTION_FIXTURES_ALL.note_completion[0]!.content;
const mcq = QUESTION_FIXTURES_ALL.mcq_single[0]!.content;

describe('blueprint IELTS', () => {
  it('Reading 13/13/14 và Listening 10×4 = 40 câu hỏi; lọc theo chương trình', () => {
    expect(BUILDER_BLUEPRINTS.ielts_reading_full!.sections).toEqual([
      { sectionCode: 'reading_p1', count: 13 },
      { sectionCode: 'reading_p2', count: 13 },
      { sectionCode: 'reading_p3', count: 14 },
    ]);
    expect(BUILDER_BLUEPRINTS.ielts_listening_full!.sections.reduce((n, s) => n + s.count, 0)).toBe(40);
    expect(blueprintsFor('ielts').map(([k]) => k)).toEqual(['ielts_reading_full', 'ielts_listening_full']);
    expect(blueprintsFor('toeic').map(([k]) => k)).toEqual(['toeic_full_200', 'toeic_mini_60']);
  });
  it('đếm theo mục khi có marksOf: câu TFNG nhiều mệnh đề tính nhiều câu hỏi', () => {
    const state = { items: [{ sectionCode: 'reading_p1', question: 'a' }, { sectionCode: 'reading_p1', question: 'b' }] };
    const marks: Record<string, number> = { a: 5, b: 8 };
    const r = blueprintReport([{ sectionCode: 'reading_p1', count: 13 }], state, (q) => marks[q] ?? 1);
    expect(r.ok).toBe(true);
    const short = blueprintReport([{ sectionCode: 'reading_p1', count: 14 }], state, (q) => marks[q] ?? 1);
    expect(blueprintErrors(short, countUnitLabel('ielts'))).toEqual(['reading_p1: cần 14 câu hỏi (mục), hiện có 13 (thiếu 1).']);
    // không marksOf → đếm câu như trước
    expect(blueprintReport([{ sectionCode: 'reading_p1', count: 2 }], state).ok).toBe(true);
  });
});

describe('trình dựng – chương trình đếm theo mục', () => {
  it('countsByMarks/countUnitLabel theo registry', () => {
    expect(countsByMarks('ielts')).toBe(true);
    expect(countsByMarks('toeic')).toBe(false);
    expect(countsByMarks(null)).toBe(false);
    expect(countUnitLabel('toeic')).toBe('câu');
  });
  it('marksOfContent = markCount; content lỗi → 1', () => {
    expect(marksOfContent(tfng)).toBe(markCount(tfng));
    expect(marksOfContent({ type: 'tfng' })).toBe(1);
    expect(marksOfContent(null)).toBe(1);
  });
  it('Part tự chấm của IELTS cho bộ lọc ngân hàng; TOEIC giữ Part 1–7', () => {
    expect(builderSectionCodes('ielts')).toEqual(['listening_p1', 'listening_p2', 'listening_p3', 'listening_p4', 'reading_p1', 'reading_p2', 'reading_p3']);
    expect(builderSectionCodes('toeic')).toHaveLength(7);
  });
  it('thêm câu: part IELTS chèn theo thứ tự registry (reading_p1 trước reading_p3)', () => {
    const s: BuilderState = { sections: [{ sectionCode: 'reading_p3', durationSec: null }], items: [{ question: 'x', sectionCode: 'reading_p3', groupKey: null, points: 1 }] };
    const r = addQuestions(s, [{ id: 'y', title: 'y', sectionCode: 'reading_p1', status: 'published', difficulty: null, passageId: null }]);
    expect(r.state.sections.map((x) => x.sectionCode)).toEqual(['reading_p1', 'reading_p3']);
    expect(r.state.items.map((i) => i.question)).toEqual(['y', 'x']);
  });
});

describe('kiểm tra tự động bộ đề IELTS (testSetCheckIssues)', () => {
  const shape = (items: TestSetShape['items'], kind: TestSetShape['kind'] = 'full'): TestSetShape => ({ program: 'ielts', kind, sections: [], items });
  const info = (entries: Array<[string, unknown, boolean, string | null]>) => new Map<string, ItemCheckInfo>(entries.map(([id, content, hasAudio, audioKey]) => [id, { content, hasAudio, audioKey }]));

  it('đề Reading full thiếu mục → lỗi tổng 40 và lỗi từng passage (tiếng Việt)', () => {
    const r = testSetCheckIssues(shape([{ question: 'a', sectionCode: 'reading_p1', sortOrder: 1 }]), info([['a', tfng, false, null]]));
    expect(r.errors).toContain(`Đề IELTS Reading đầy đủ cần đúng 40 câu hỏi, hiện có ${markCount(tfng)}.`);
    expect(r.errors.some((m) => m.startsWith('reading_p2: cần đúng 13 câu hỏi (mục), hiện có 0'))).toBe(true);
  });
  it('câu không tải được thông tin → đứt dãy số', () => {
    const r = testSetCheckIssues(shape([{ question: 'a', sectionCode: 'reading_p1', sortOrder: 1 }, { question: 'b', sectionCode: 'reading_p1', sortOrder: 2 }], 'mini'), info([['a', note, false, null]]));
    expect(r.errors).toEqual([`Đánh số câu hỏi bị đứt tại câu số ${markCount(note) + 1} (reading_p1, thứ tự 2): nội dung câu không hợp lệ hoặc không xác định được số mục.`]);
  });
  it('part Listening không audio: mini → cảnh báo; nhiều audio → cảnh báo', () => {
    const noAudio = testSetCheckIssues(shape([{ question: 'a', sectionCode: 'listening_p1', sortOrder: 1 }], 'mini'), info([['a', mcq, false, null]]));
    expect(noAudio).toEqual({ errors: [], warnings: ['listening_p1: part Listening chưa có audio (câu hoặc passage script phải gắn audio).'] });
    const two = testSetCheckIssues(
      shape([{ question: 'a', sectionCode: 'listening_p1', sortOrder: 1 }, { question: 'b', sectionCode: 'listening_p1', sortOrder: 2 }], 'mini'),
      info([['a', mcq, true, 'm1'], ['b', mcq, true, 'm2']]),
    );
    expect(two.warnings).toEqual(['listening_p1: part có 2 audio khác nhau – định dạng thi máy tính phát liên tục một audio mỗi part.']);
  });
  it('describeTestSetCheck đủ mọi mã', () => {
    expect(describeTestSetCheck({ code: 'ielts_mark_total', level: 'error', params: { skill: 'listening', expected: 40, actual: 38 } })).toBe('Đề IELTS Listening đầy đủ cần đúng 40 câu hỏi, hiện có 38.');
  });
});

describe('module IELTS → catalog.test_sets.level', () => {
  it('chỉ IELTS có module', () => {
    expect(catalogLevelOf({ program: 'ielts', ieltsModule: 'general_training' })).toBe('general_training');
    expect(catalogLevelOf({ program: 'ielts', ieltsModule: null })).toBeUndefined();
    expect(catalogLevelOf({ program: 'toeic', ieltsModule: 'academic' })).toBeUndefined();
  });
});
