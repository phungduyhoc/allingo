import { QUESTION_FIXTURES, QUESTION_TYPE_CODES } from '@allingo/schemas';
import { describe, expect, it } from 'vitest';
import { findUnpublishedItems, validateMcqAnswerKeys, validateQuestionContent, validateTestSetStructure } from '../src/lib/validate';

describe('validateQuestionContent', () => {
  it('chấp nhận fixture của cả 26 dạng câu (C2: +14 dạng IELTS) và trả về giá trị đã chuẩn hoá', () => {
    for (const type of QUESTION_TYPE_CODES) {
      const res = validateQuestionContent(type, QUESTION_FIXTURES[type].content);
      expect(res.ok, type).toBe(true);
      if (res.ok) expect(res.value.type).toBe(type);
    }
  });

  it('báo lỗi tiếng Việt khi content.type lệch questionType', () => {
    const res = validateQuestionContent('fill_blank', QUESTION_FIXTURES.mcq_single.content);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('không khớp');
  });

  it('liệt kê đường dẫn lỗi Zod (options tối thiểu 2, answer_key bắt buộc)', () => {
    const res = validateQuestionContent('mcq_single', { type: 'mcq_single', stem: 'x', options: [{ key: 'A', text: 'a' }] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((i) => i.startsWith('options'))).toBe(true);
      expect(res.issues.some((i) => i.startsWith('answer_key'))).toBe(true);
    }
  });

  it('từ chối questionType không hợp lệ và content không phải object', () => {
    expect(validateQuestionContent('unknown', {}).ok).toBe(false);
    expect(validateQuestionContent('mcq_single', 'abc').ok).toBe(false);
  });

  it('điền default (tags, listen_policy) khi thiếu', () => {
    const res = validateQuestionContent('dictation', { type: 'dictation', stem: 'Listen', media: {}, answer_key: { text: 'hello world' } });
    expect(res.ok).toBe(true);
    if (res.ok && res.value.type === 'dictation') {
      expect(res.value.tags).toEqual([]);
      expect(res.value.media.listen_policy).toBe('free');
      expect(res.value.answer_key.pass_ratio).toBe(0.9);
    }
  });
});

describe('validateMcqAnswerKeys', () => {
  it('đáp án đúng phải nằm trong options', () => {
    const res = validateQuestionContent('mcq_single', { ...QUESTION_FIXTURES.mcq_single.content, answer_key: { correct: 'Z' } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(validateMcqAnswerKeys(res.value)).toContain('"Z"');
    const ok = validateQuestionContent('mcq_multi', QUESTION_FIXTURES.mcq_multi.content);
    if (ok.ok) expect(validateMcqAnswerKeys(ok.value)).toBeNull();
  });
});

describe('validateTestSetStructure', () => {
  const counts = { part1: 6, part2: 25, part3: 39, part4: 30, part5: 30, part6: 16, part7: 54 };
  const fullItems = Object.entries(counts).flatMap(([sectionCode, n]) => Array.from({ length: n }, (_, i) => ({ question: `q-${sectionCode}-${i}`, sectionCode, sortOrder: i + 1 })));
  const fullSections = Object.keys(counts).map((sectionCode) => ({ sectionCode }));

  it('TOEIC full đủ 200 câu đúng phân bổ → hợp lệ', () => {
    expect(validateTestSetStructure({ program: 'toeic', kind: 'full', sections: fullSections, items: fullItems })).toEqual([]);
  });

  it('TOEIC full thiếu part hoặc sai số câu → lỗi nêu rõ part', () => {
    const errors = validateTestSetStructure({ program: 'toeic', kind: 'full', sections: fullSections.slice(0, 6), items: fullItems.filter((i) => i.sectionCode !== 'part7').slice(1) });
    expect(errors.some((e) => e.includes('thiếu phần part7'))).toBe(true);
    expect(errors.some((e) => e.includes('part1 cần đúng 6'))).toBe(true);
  });

  it('mini chỉ cần ≥ 1 câu; 0 câu → lỗi; sortOrder trùng → lỗi', () => {
    expect(validateTestSetStructure({ program: 'toeic', kind: 'mini', sections: [{ sectionCode: 'part5' }], items: [{ question: 'a', sectionCode: 'part5', sortOrder: 1 }] })).toEqual([]);
    expect(validateTestSetStructure({ program: 'toeic', kind: 'mini', sections: [{ sectionCode: 'part5' }], items: [] }).length).toBeGreaterThan(0);
    const dup = validateTestSetStructure({
      program: 'toeic',
      kind: 'part_drill',
      sections: [{ sectionCode: 'part5' }],
      items: [
        { question: 'a', sectionCode: 'part5', sortOrder: 1 },
        { question: 'b', sectionCode: 'part5', sortOrder: 1 },
      ],
    });
    expect(dup.some((e) => e.includes('sortOrder 1 trùng'))).toBe(true);
  });

  it('item thuộc section chưa khai báo → lỗi', () => {
    const errors = validateTestSetStructure({ program: 'toeic', kind: 'mini', sections: [{ sectionCode: 'part5' }], items: [{ question: 'a', sectionCode: 'part6', sortOrder: 1 }] });
    expect(errors[0]).toContain('chưa khai báo');
  });
});

describe('findUnpublishedItems', () => {
  it('phát hiện câu chưa published hoặc không tồn tại', () => {
    const status = new Map([
      ['q1', 'published'],
      ['q2', 'review2'],
    ]);
    const bad = findUnpublishedItems(
      [
        { question: 'q1', sectionCode: 'part5', sortOrder: 1 },
        { question: { id: 'q2' }, sectionCode: 'part5', sortOrder: 2 },
        { question: 'q3', sectionCode: 'part5', sortOrder: 3 },
      ],
      status,
    );
    expect(bad.map((b) => b.questionId)).toEqual(['q2', 'q3']);
  });
});

describe('normalizeReference', () => {
  it('chấp nhận name dạng chuỗi lẫn LocalizedText {vi,en} như API thật trả về', async () => {
    const { normalizeReference } = await import('../src/lib/reference.js');
    const out = normalizeReference({
      programs: [{ code: 'toeic', name: { en: 'TOEIC', vi: 'TOEIC' } }],
      sections: [
        { program: 'toeic', code: 'part5', name: { en: 'Incomplete Sentences', vi: 'Hoàn thành câu' }, level: 1 },
        { program: 'toeic', code: 'part6', name: 'Text Completion', level: null },
      ],
      topics: [{ code: 'finance' }],
    });
    expect(out.sections).toEqual([
      { program: 'toeic', code: 'part5', name: 'Hoàn thành câu', level: '1' },
      { program: 'toeic', code: 'part6', name: 'Text Completion', level: null },
    ]);
    expect(out.topics[0]).toEqual({ code: 'finance', name: 'finance' });
    expect(out.question_types).toEqual([]);
  });
});
