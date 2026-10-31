import { describe, expect, it } from 'vitest';
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
  questionContentSchema,
  toPublicContent,
} from '../src/index.js';

describe('questionContentSchema', () => {
  it.each(QUESTION_TYPE_CODES)('fixture %s hợp lệ với Zod', (type) => {
    const fx = QUESTION_FIXTURES[type];
    expect(questionContentSchema.parse(fx.content).type).toBe(type);
    expect(answerInputSchema.parse(fx.correct).type).toBe(type);
    expect(answerInputSchema.parse(fx.wrong).type).toBe(type);
  });

  it('từ chối type lạ', () => {
    expect(questionContentSchema.safeParse({ type: 'unknown', stem: 'x' }).success).toBe(false);
  });
});

describe('grade()', () => {
  for (const type of QUESTION_TYPE_CODES) {
    const fx = QUESTION_FIXTURES[type];
    const content = questionContentSchema.parse(fx.content);
    if (AUTO_GRADABLE_TYPES.has(type)) {
      it(`${type}: đúng → score 1`, () => {
        const r = grade(content, fx.correct);
        expect(r.is_correct).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0.9);
      });
      it(`${type}: sai → không đúng`, () => {
        const r = grade(content, fx.wrong);
        expect(r.is_correct).toBe(false);
        expect(r.score).toBeLessThan(0.9);
      });
      it(`${type}: không trả lời / sai kiểu → 0`, () => {
        expect(grade(content, null).score).toBe(0);
        expect(grade(content, emptyAnswer(type)).score).toBe(0);
        expect(grade(content, { type: 'essay', text: 'x' }).score).toBe(0);
      });
      const partial = fx.partial;
      if (partial) {
        it(`${type}: một phần → 0 < score < 1`, () => {
          const r = grade(content, partial);
          expect(r.score).toBeGreaterThan(0);
          expect(r.score).toBeLessThan(1);
        });
      }
    } else {
      it(`${type}: không chấm tự động → is_correct null`, () => {
        expect(grade(content, fx.correct).is_correct).toBeNull();
      });
    }
  }

  it('mcq_multi all_or_nothing', () => {
    const c = questionContentSchema.parse({ ...QUESTION_FIXTURES.mcq_multi.content, answer_key: { correct: ['B', 'C'], scoring: 'all_or_nothing' } });
    expect(grade(c, { type: 'mcq_multi', selected: ['B'] }).score).toBe(0);
    expect(grade(c, { type: 'mcq_multi', selected: ['C', 'B'] }).score).toBe(1);
  });

  it('fill_blank: phân biệt hoa thường và max_words', () => {
    const c = questionContentSchema.parse({
      type: 'fill_blank',
      stem: '{{b1}}',
      blanks: [{ id: 'b1', accepted: ['New York'], case_sensitive: true, max_words: 2 }],
    });
    expect(grade(c, { type: 'fill_blank', blanks: { b1: 'new york' } }).is_correct).toBe(false);
    expect(grade(c, { type: 'fill_blank', blanks: { b1: 'New  York ' } }).is_correct).toBe(true);
    expect(grade(c, { type: 'fill_blank', blanks: { b1: 'the New York' } }).is_correct).toBe(false);
  });

  it('ordering exact', () => {
    const c = questionContentSchema.parse({ ...QUESTION_FIXTURES.ordering.content, answer_key: { order: ['c', 'a', 'b', 'd'], scoring: 'exact' } });
    expect(grade(c, { type: 'ordering', order: ['c', 'a', 'd', 'b'] }).score).toBe(0);
  });

  it('dictation chịu lỗi chính tả 1 ký tự/token', () => {
    const c = questionContentSchema.parse(QUESTION_FIXTURES.dictation.content);
    expect(grade(c, { type: 'dictation', text: 'The shipmant will arrive on Thursday mornin.' }).is_correct).toBe(true);
    expect(grade(c, { type: 'dictation', text: 'The shipment arrives Thursday' }).is_correct).toBe(false);
  });

  it('correctAnswerOf trả đáp án không cần câu trả lời', () => {
    expect(correctAnswerOf(questionContentSchema.parse(QUESTION_FIXTURES.mcq_single.content))).toBe('B');
  });
});

describe('toPublicContent', () => {
  it.each(QUESTION_TYPE_CODES)('%s không còn answer_key/explanation/evidence', (type) => {
    const pub = toPublicContent(questionContentSchema.parse(QUESTION_FIXTURES[type].content));
    expect(hasSecretFields(pub)).toBe(false);
    expect((pub as { type: string }).type).toBe(type);
  });
});

describe('tiện ích', () => {
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'ab')).toBe(2);
  });
  it('isAnswered', () => {
    expect(isAnswered({ type: 'mcq_single', selected: null })).toBe(false);
    expect(isAnswered({ type: 'mcq_single', selected: 'A' })).toBe(true);
    expect(isAnswered({ type: 'fill_blank', blanks: { b1: ' ' } })).toBe(false);
  });
});
