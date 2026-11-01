import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  AUTO_GRADABLE_TYPES,
  QUESTION_FIXTURES,
  QUESTION_TYPE_CODES,
  answerInputSchema,
  correctAnswerOf,
  emptyAnswer,
  grade,
  hasSecretFields,
  isAnswered,
  levenshtein,
  normalizeText,
  questionContentSchema,
  toPublicContent,
  type QuestionContent,
  type QuestionContentInput,
  type QuestionContentOf,
  type QuestionTypeCode,
} from '../src/index.js';

const parse = (c: QuestionContentInput): QuestionContent => questionContentSchema.parse(c);
const fx = <T extends QuestionTypeCode>(t: T): QuestionContentOf<T> => QUESTION_FIXTURES[t].content as QuestionContentOf<T>;

describe('questionContentSchema', () => {
  it.each(QUESTION_TYPE_CODES)('fixture %s hợp lệ với Zod', (type) => {
    const f = QUESTION_FIXTURES[type];
    expect(questionContentSchema.parse(f.content).type).toBe(type);
    expect(answerInputSchema.parse(f.correct_answer).type).toBe(type);
    expect(answerInputSchema.parse(f.wrong_answer).type).toBe(type);
  });

  it('từ chối type lạ', () => {
    expect(questionContentSchema.safeParse({ type: 'unknown', stem: 'x' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('grade(): quy tắc chung', () => {
  it.each(QUESTION_TYPE_CODES)('%s: answer null → chưa làm (0 hoặc null), không có error', (type) => {
    const r = grade(fx(type), null);
    if (AUTO_GRADABLE_TYPES.has(type)) {
      expect(r).toMatchObject({ is_correct: false, score: 0, auto: true, needs_manual: false });
    } else {
      expect(r).toMatchObject({ is_correct: null, score: null, auto: false, needs_manual: true });
    }
    expect(r.error).toBeUndefined();
    expect(grade(fx(type), undefined)).toEqual(r);
  });

  it.each(QUESTION_TYPE_CODES)('%s: answer sai dạng → answer_type_mismatch, score 0, không ném', (type) => {
    const other = type === 'essay' ? ({ type: 'mcq_single', selected: 'A' } as const) : ({ type: 'essay', text: 'x' } as const);
    const r = grade(fx(type), other);
    expect(r).toMatchObject({ is_correct: false, score: 0, error: 'answer_type_mismatch' });
    expect(r.correct_answer).toEqual(correctAnswerOf(fx(type)));
  });

  it('answer đúng type nhưng payload hỏng → ném ZodError', () => {
    expect(() => grade(fx('mcq_single'), { type: 'mcq_single', selected: 123 as unknown as string })).toThrow(ZodError);
    expect(() => grade(fx('speaking'), { type: 'speaking', recording_id: 'not-a-uuid' })).toThrow(ZodError);
    expect(() => grade(fx('handwriting'), { type: 'handwriting', strokes: [[[0, 0]]] })).toThrow(ZodError);
  });

  it.each([...AUTO_GRADABLE_TYPES])('%s: emptyAnswer → 0 điểm', (type) => {
    expect(grade(fx(type), emptyAnswer(type)).score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('grade(): mcq_single', () => {
  const c = fx('mcq_single');
  it('đúng → 1', () => expect(grade(c, { type: 'mcq_single', selected: 'B' })).toMatchObject({ is_correct: true, score: 1, correct_answer: 'B' }));
  it('sai → 0', () => expect(grade(c, { type: 'mcq_single', selected: 'C' })).toMatchObject({ is_correct: false, score: 0 }));
  it('chưa chọn (null) → 0', () => expect(grade(c, { type: 'mcq_single', selected: null })).toMatchObject({ is_correct: false, score: 0 }));
});

describe('grade(): mcq_multi', () => {
  const partial = parse({ ...fx('mcq_multi'), answer_key: { correct: ['B', 'C'], scoring: 'partial' } });
  const aon = parse({ ...fx('mcq_multi'), answer_key: { correct: ['B', 'C'], scoring: 'all_or_nothing' } });
  const lenient = parse({ ...fx('mcq_multi'), answer_key: { correct: ['B', 'C'], scoring: 'partial', penalize_extra: false } });

  it('đúng toàn bộ (thứ tự bất kỳ) → 1', () => {
    expect(grade(partial, { type: 'mcq_multi', selected: ['C', 'B'] })).toMatchObject({ is_correct: true, score: 1 });
    expect(grade(aon, { type: 'mcq_multi', selected: ['C', 'B'] })).toMatchObject({ is_correct: true, score: 1 });
  });
  it('partial: thiếu một → 0.5, details theo lựa chọn đúng', () => {
    const r = grade(partial, { type: 'mcq_multi', selected: ['B'] });
    expect(r).toMatchObject({ is_correct: false, score: 0.5, details: { B: true, C: false } });
  });
  it('partial + penalize_extra (mặc định): chọn thừa lựa chọn sai → 0', () => {
    expect(grade(partial, { type: 'mcq_multi', selected: ['B', 'C', 'A'] })).toMatchObject({ is_correct: false, score: 0 });
    expect(grade(partial, { type: 'mcq_multi', selected: ['B', 'A'] })).toMatchObject({ is_correct: false, score: 0 });
  });
  it('partial + penalize_extra=false: chỉ đếm lựa chọn đúng', () => {
    expect(grade(lenient, { type: 'mcq_multi', selected: ['B', 'A'] }).score).toBe(0.5);
    expect(grade(lenient, { type: 'mcq_multi', selected: ['B', 'C', 'A'] })).toMatchObject({ is_correct: false, score: 1 });
  });
  it('all_or_nothing: thiếu hoặc thừa → 0', () => {
    expect(grade(aon, { type: 'mcq_multi', selected: ['B'] }).score).toBe(0);
    expect(grade(aon, { type: 'mcq_multi', selected: ['B', 'C', 'D'] }).score).toBe(0);
  });
  it('sai hoàn toàn → 0', () => expect(grade(partial, { type: 'mcq_multi', selected: ['A', 'D'] }).score).toBe(0));
});

describe('grade(): fill_blank', () => {
  const c = fx('fill_blank');
  it('đúng: không phân biệt hoa thường, trim, gộp khoảng trắng, nhiều đáp án/ô', () => {
    expect(grade(c, { type: 'fill_blank', blanks: { b1: '  EIGHT ', b2: ' six' } })).toMatchObject({ is_correct: true, score: 1, details: { b1: true, b2: true } });
    expect(grade(c, { type: 'fill_blank', blanks: { b1: '8:00', b2: '6:00' } }).is_correct).toBe(true);
  });
  it('sai hoàn toàn → 0', () => expect(grade(c, { type: 'fill_blank', blanks: { b1: '9', b2: '5' } })).toMatchObject({ is_correct: false, score: 0 }));
  it('partial (mặc định): 1/2 ô đúng → score 0.5, is_correct false', () => {
    expect(grade(c, { type: 'fill_blank', blanks: { b1: '8' } })).toMatchObject({ is_correct: false, score: 0.5, details: { b1: true, b2: false } });
  });
  it('scoring all_or_nothing: 1/2 ô → 0', () => {
    const aon = parse({ ...c, answer_key: { ordered: true, scoring: 'all_or_nothing' } });
    expect(grade(aon, { type: 'fill_blank', blanks: { b1: '8' } }).score).toBe(0);
    expect(grade(aon, { type: 'fill_blank', blanks: { b1: '8', b2: '6' } }).score).toBe(1);
  });
  it('case_sensitive và max_words', () => {
    const cs = parse({ type: 'fill_blank', stem: '{{b1}}', blanks: [{ id: 'b1', accepted: ['New York'], case_sensitive: true, max_words: 2 }] });
    expect(grade(cs, { type: 'fill_blank', blanks: { b1: 'new york' } }).is_correct).toBe(false);
    expect(grade(cs, { type: 'fill_blank', blanks: { b1: 'New  York ' } }).is_correct).toBe(true);
    expect(grade(cs, { type: 'fill_blank', blanks: { b1: 'the New York' } }).is_correct).toBe(false);
  });
  it('ignore_punctuation: "U.S.A." = "USA"; ô trống → sai', () => {
    const ip = parse({ type: 'fill_blank', stem: '{{b1}}', blanks: [{ id: 'b1', accepted: ['U.S.A.'], ignore_punctuation: true }] });
    expect(grade(ip, { type: 'fill_blank', blanks: { b1: 'u s a' } }).is_correct).toBe(true);
    expect(grade(ip, { type: 'fill_blank', blanks: { b1: '' } }).is_correct).toBe(false);
    const np = parse({ type: 'fill_blank', stem: '{{b1}}', blanks: [{ id: 'b1', accepted: ['U.S.A.'] }] });
    expect(grade(np, { type: 'fill_blank', blanks: { b1: 'USA' } }).is_correct).toBe(false);
  });
  it('ordered=false: điền hoán vị vẫn đúng, không được dùng một ô hai lần', () => {
    const any = parse({
      type: 'fill_blank',
      stem: '{{b1}} {{b2}}',
      blanks: [
        { id: 'b1', accepted: ['tea'] },
        { id: 'b2', accepted: ['coffee'] },
      ],
      answer_key: { ordered: false },
    });
    expect(grade(any, { type: 'fill_blank', blanks: { b1: 'coffee', b2: 'tea' } })).toMatchObject({ is_correct: true, score: 1 });
    expect(grade(any, { type: 'fill_blank', blanks: { b1: 'tea', b2: 'tea' } })).toMatchObject({ is_correct: false, score: 0.5, details: { b1: true, b2: false } });
  });
});

describe('grade(): matching', () => {
  const c = fx('matching');
  it('đúng → 1', () => expect(grade(c, { type: 'matching', pairs: { L1: 'R2', L2: 'R1', L3: 'R3' } })).toMatchObject({ is_correct: true, score: 1 }));
  it('sai → 0', () => expect(grade(c, { type: 'matching', pairs: { L1: 'R1', L2: 'R3', L3: 'R2' } })).toMatchObject({ is_correct: false, score: 0 }));
  it('partial: 2/3 cặp đúng → 0.667, cặp thiếu = sai', () => {
    expect(grade(c, { type: 'matching', pairs: { L1: 'R2', L2: 'R1' } })).toMatchObject({ score: 0.667, details: { L1: true, L2: true, L3: false } });
  });
  it('allow_reuse=false: mục bên phải dùng lặp → các cặp đó sai', () => {
    expect(grade(c, { type: 'matching', pairs: { L1: 'R2', L2: 'R1', L3: 'R1' } })).toMatchObject({ score: 0.333, details: { L1: true, L2: false, L3: false } });
  });
  it('allow_reuse=true: dùng lặp hợp lệ; all_or_nothing', () => {
    const reuse = parse({ ...c, allow_reuse: true, answer_key: { pairs: { L1: 'R2', L2: 'R2', L3: 'R3' }, scoring: 'all_or_nothing' } });
    expect(grade(reuse, { type: 'matching', pairs: { L1: 'R2', L2: 'R2', L3: 'R3' } }).score).toBe(1);
    expect(grade(reuse, { type: 'matching', pairs: { L1: 'R2', L2: 'R2' } }).score).toBe(0);
  });
});

describe('grade(): drag_drop', () => {
  const c = fx('drag_drop');
  it('đúng → 1', () => expect(grade(c, { type: 'drag_drop', placements: { s1: 'i3', s2: 'i2' } })).toMatchObject({ is_correct: true, score: 1 }));
  it('sai → 0 (slot thừa bị bỏ qua)', () => expect(grade(c, { type: 'drag_drop', placements: { s1: 'i2', s2: 'i3', s9: 'i1' } })).toMatchObject({ is_correct: false, score: 0 }));
  it('partial: 1/2 slot → 0.5', () => expect(grade(c, { type: 'drag_drop', placements: { s1: 'i3' } })).toMatchObject({ score: 0.5, details: { s1: true, s2: false } }));
  it('all_or_nothing', () => {
    const aon = parse({ ...c, answer_key: { placements: { s1: 'i3', s2: 'i2' }, scoring: 'all_or_nothing' } });
    expect(grade(aon, { type: 'drag_drop', placements: { s1: 'i3' } }).score).toBe(0);
  });
});

describe('grade(): map_label', () => {
  const c = fx('map_label');
  it('đúng → 1', () => expect(grade(c, { type: 'map_label', positions: { p1: 'A', p2: 'B', p3: 'C' } })).toMatchObject({ is_correct: true, score: 1 }));
  it('sai → 0', () => expect(grade(c, { type: 'map_label', positions: { p1: 'C', p2: 'A', p3: 'B' } })).toMatchObject({ is_correct: false, score: 0 }));
  it('partial: 2/3 → 0.667', () => expect(grade(c, { type: 'map_label', positions: { p1: 'A', p2: 'B', p3: 'A' } })).toMatchObject({ score: 0.667 }));
  it('all_or_nothing', () => {
    const aon = parse({ ...c, answer_key: { positions: { p1: 'A', p2: 'B', p3: 'C' }, scoring: 'all_or_nothing' } });
    expect(grade(aon, { type: 'map_label', positions: { p1: 'A', p2: 'B' } }).score).toBe(0);
  });
});

describe('grade(): tfng', () => {
  const c = fx('tfng');
  it('đúng → 1', () => expect(grade(c, { type: 'tfng', values: { s1: 'true', s2: 'false', s3: 'not_given' } })).toMatchObject({ is_correct: true, score: 1 }));
  it('sai → 0', () => expect(grade(c, { type: 'tfng', values: { s1: 'false', s2: 'true', s3: 'true' } })).toMatchObject({ is_correct: false, score: 0 }));
  it('partial: 2/3 → 0.667, câu bỏ trống = sai', () => {
    expect(grade(c, { type: 'tfng', values: { s1: 'true', s2: 'false' } })).toMatchObject({ score: 0.667, details: { s1: true, s2: true, s3: false } });
  });
  it('all_or_nothing', () => {
    const aon = parse({ ...c, answer_key: { values: { s1: 'true', s2: 'false', s3: 'not_given' }, scoring: 'all_or_nothing' } });
    expect(grade(aon, { type: 'tfng', values: { s1: 'true', s2: 'false' } }).score).toBe(0);
  });
});

describe('grade(): ordering', () => {
  const base = fx('ordering');
  const exact = parse({ ...base, answer_key: { order: ['c', 'a', 'b', 'd'], scoring: 'exact' } });
  const partial = parse({ ...base, answer_key: { order: ['c', 'a', 'b', 'd'], scoring: 'partial' } });
  const adj = parse({ ...base, answer_key: { order: ['c', 'a', 'b', 'd'], scoring: 'adjacent_pairs' } });

  it('đúng thứ tự → 1 ở mọi chế độ', () => {
    for (const c of [exact, partial, adj]) expect(grade(c, { type: 'ordering', order: ['c', 'a', 'b', 'd'] })).toMatchObject({ is_correct: true, score: 1 });
  });
  it('exact: sai một vị trí → 0; thiếu phần tử → 0', () => {
    expect(grade(exact, { type: 'ordering', order: ['c', 'a', 'd', 'b'] }).score).toBe(0);
    expect(grade(exact, { type: 'ordering', order: ['c', 'a', 'b'] })).toMatchObject({ is_correct: false, score: 0 });
  });
  it('partial: tỷ lệ phần tử đúng vị trí', () => {
    expect(grade(partial, { type: 'ordering', order: ['c', 'a', 'd', 'b'] })).toMatchObject({ is_correct: false, score: 0.5, details: { c: true, a: true, b: false, d: false } });
    expect(grade(partial, { type: 'ordering', order: ['d', 'b', 'a', 'c'] }).score).toBe(0);
  });
  it('adjacent_pairs: tỷ lệ cặp kề đúng', () => {
    expect(grade(adj, { type: 'ordering', order: ['c', 'a', 'd', 'b'] }).score).toBe(0.333);
    expect(grade(adj, { type: 'ordering', order: ['a', 'b', 'd', 'c'] }).score).toBe(0.667);
    expect(grade(adj, { type: 'ordering', order: ['d', 'c', 'b', 'a'] }).score).toBe(0);
  });
});

describe('grade(): dictation', () => {
  const c = fx('dictation'); // tolerance 1, pass_ratio 0.9, ignore_punctuation
  it('đúng chính xác → 1', () => expect(grade(c, { type: 'dictation', text: 'The shipment will arrive on Thursday morning.' })).toMatchObject({ is_correct: true, score: 1 }));
  it('chịu lỗi chính tả ≤ 1 ký tự/token, bỏ dấu câu, hoa thường', () => {
    expect(grade(c, { type: 'dictation', text: 'the shipmant will arrive on thursday mornin!' })).toMatchObject({ is_correct: true, score: 1 });
  });
  it('thiếu từ → score theo tỷ lệ token, is_correct theo pass_ratio', () => {
    const r = grade(c, { type: 'dictation', text: 'The shipment will arrive' });
    expect(r).toMatchObject({ is_correct: false, score: 0.571 });
    expect(r.details).toEqual({ '0': true, '1': true, '2': true, '3': true, '4': false, '5': false, '6': false });
  });
  it('thừa một từ ở giữa vẫn khớp nhờ cửa sổ ±1', () => {
    expect(grade(c, { type: 'dictation', text: 'The shipment will surely arrive on Thursday morning' }).score).toBe(1);
  });
  it('sai hoàn toàn → 0; chuỗi rỗng → 0', () => {
    expect(grade(c, { type: 'dictation', text: 'a package comes tomorrow' }).score).toBe(0);
    expect(grade(c, { type: 'dictation', text: '' })).toMatchObject({ is_correct: false, score: 0 });
  });
  it('tolerance 0 + pass_ratio 1: một lỗi chính tả → không đạt', () => {
    const strict = parse({ ...c, answer_key: { text: 'keep your receipt', max_edit_distance_per_token: 0, pass_ratio: 1 } });
    expect(grade(strict, { type: 'dictation', text: 'keep your recipt' })).toMatchObject({ is_correct: false, score: 0.667 });
    expect(grade(strict, { type: 'dictation', text: 'Keep your receipt' }).is_correct).toBe(true);
  });
  it('ignore_punctuation=false: dấu câu là một phần của token', () => {
    const p = parse({ ...c, answer_key: { text: 'Yes, sir.', max_edit_distance_per_token: 0, ignore_punctuation: false, pass_ratio: 1 } });
    expect(grade(p, { type: 'dictation', text: 'yes sir' }).score).toBe(0);
    expect(grade(p, { type: 'dictation', text: 'yes, sir.' }).score).toBe(1);
  });
  it('token người học lặp lại không được dùng cho hai token đáp án', () => {
    const p = parse({ ...c, answer_key: { text: 'go go away', max_edit_distance_per_token: 0, pass_ratio: 1 } });
    expect(grade(p, { type: 'dictation', text: 'go away' }).score).toBe(0.667);
  });
});

// ---------------------------------------------------------------------------
describe('grade(): essay / speaking / handwriting (chấm thủ công)', () => {
  it.each(['essay', 'speaking', 'handwriting'] as const)('%s: answer hợp lệ → needs_manual, is_correct/score null', (type) => {
    const f = QUESTION_FIXTURES[type];
    expect(grade(f.content, f.correct_answer)).toMatchObject({ is_correct: null, score: null, auto: false, needs_manual: true });
    expect(grade(f.content, f.wrong_answer)).toMatchObject({ is_correct: null, score: null, auto: false, needs_manual: true });
  });
  it('essay: payload hỏng → ném ZodError', () => {
    expect(() => grade(fx('essay'), { type: 'essay', text: 42 as unknown as string })).toThrow(ZodError);
  });
  it('correct_answer: model_answer nếu có, else null; handwriting trả target', () => {
    expect(grade(fx('essay'), { type: 'essay', text: 'x' }).correct_answer).toBeNull();
    const withModel = parse({ ...fx('essay'), answer_key: { model_answer: 'Sample essay.' } });
    expect(correctAnswerOf(withModel)).toBe('Sample essay.');
    expect(correctAnswerOf(fx('speaking'))).toBeNull();
    expect(correctAnswerOf(fx('handwriting'))).toEqual({ target: '书', stroke_count: 4 });
    expect(correctAnswerOf(parse({ ...fx('handwriting'), answer_key: {} }))).toEqual({ target: '书', stroke_count: null });
  });
});

describe('correctAnswerOf', () => {
  it('đủ 12 dạng, khớp với grade().correct_answer', () => {
    for (const type of QUESTION_TYPE_CODES) {
      const f = QUESTION_FIXTURES[type];
      expect(correctAnswerOf(f.content)).toEqual(grade(f.content, f.correct_answer).correct_answer);
    }
    expect(correctAnswerOf(fx('mcq_single'))).toBe('B');
    expect(correctAnswerOf(fx('fill_blank'))).toEqual({ b1: ['8', 'eight', '8:00'], b2: ['6', 'six', '6:00'] });
    expect(correctAnswerOf(fx('dictation'))).toBe('The shipment will arrive on Thursday morning.');
  });
});

// ---------------------------------------------------------------------------
describe('toPublicContent', () => {
  it.each(QUESTION_TYPE_CODES)('%s không còn answer_key/explanation/evidence', (type) => {
    const pub = toPublicContent(QUESTION_FIXTURES[type].content);
    expect(hasSecretFields(pub)).toBe(false);
    expect((pub as { type: string }).type).toBe(type);
  });
});

describe('tiện ích', () => {
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'ab')).toBe(2);
    expect(levenshtein('ab', '')).toBe(2);
    expect(levenshtein('same', 'same')).toBe(0);
  });
  it('normalizeText', () => {
    expect(normalizeText('  Hello   World ')).toBe('hello world');
    expect(normalizeText('  Hello   World ', true)).toBe('Hello World');
    expect(normalizeText('U.S.A.', false, true)).toBe('u s a');
  });
  it('isAnswered', () => {
    expect(isAnswered({ type: 'mcq_single', selected: null })).toBe(false);
    expect(isAnswered({ type: 'mcq_single', selected: 'A' })).toBe(true);
    expect(isAnswered({ type: 'fill_blank', blanks: { b1: ' ' } })).toBe(false);
  });
});
