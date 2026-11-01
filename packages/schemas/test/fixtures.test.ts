import { describe, expect, it } from 'vitest';
import {
  AUTO_GRADABLE_TYPES,
  QUESTION_FIXTURES,
  QUESTION_FIXTURES_ALL,
  QUESTION_FIXTURE_LIST,
  QUESTION_TYPE_CODES,
  answerInputSchema,
  grade,
  hasSecretFields,
  questionContentSchema,
  toPublicContent,
} from '../src/index.js';

describe('QUESTION_FIXTURES_ALL', () => {
  it('có ≥ 3 fixture cho mỗi dạng, id duy nhất, QUESTION_FIXTURES là fixture đầu tiên', () => {
    for (const type of QUESTION_TYPE_CODES) {
      expect(QUESTION_FIXTURES_ALL[type].length).toBeGreaterThanOrEqual(3);
      expect(QUESTION_FIXTURES[type]).toBe(QUESTION_FIXTURES_ALL[type][0]);
    }
    expect(QUESTION_FIXTURE_LIST.length).toBeGreaterThanOrEqual(36);
    expect(new Set(QUESTION_FIXTURE_LIST.map((f) => f.id)).size).toBe(QUESTION_FIXTURE_LIST.length);
  });

  describe.each(QUESTION_FIXTURE_LIST.map((f) => [f.id, f] as const))('%s', (_id, f) => {
    it('content hợp lệ với questionContentSchema và answer hợp lệ với answerInputSchema', () => {
      const parsed = questionContentSchema.parse(f.content);
      expect(parsed).toEqual(f.content); // đã áp default khi nạp module → parse lại không đổi
      expect(answerInputSchema.parse(f.correct_answer).type).toBe(f.content.type);
      expect(answerInputSchema.parse(f.wrong_answer).type).toBe(f.content.type);
      if (f.partial_answer) expect(answerInputSchema.parse(f.partial_answer).type).toBe(f.content.type);
      expect(hasSecretFields(toPublicContent(parsed))).toBe(false);
    });

    if (AUTO_GRADABLE_TYPES.has(f.content.type)) {
      it('correct_answer → is_correct true; wrong_answer → false; điểm khớp expected', () => {
        const ok = grade(f.content, f.correct_answer);
        expect(ok.is_correct).toBe(true);
        expect(ok.auto).toBe(true);
        expect(ok.score).toBe(f.expected.correct);

        const bad = grade(f.content, f.wrong_answer);
        expect(bad.is_correct).toBe(false);
        expect(bad.score).toBe(f.expected.wrong);
      });
      const partial = f.partial_answer;
      if (partial) {
        it('partial_answer → 0 < score < 1, khớp expected.partial', () => {
          const r = grade(f.content, partial);
          expect(r.score).toBeGreaterThan(0);
          expect(r.score).toBeLessThan(1);
          expect(r.score).toBe(f.expected.partial);
        });
      }
    } else {
      it('dạng chấm thủ công → needs_manual, is_correct/score null', () => {
        expect(f.expected).toEqual({ correct: null, wrong: null });
        expect(grade(f.content, f.correct_answer)).toMatchObject({ is_correct: null, score: null, auto: false, needs_manual: true });
        expect(grade(f.content, f.wrong_answer)).toMatchObject({ is_correct: null, score: null, needs_manual: true });
      });
    }
  });
});
