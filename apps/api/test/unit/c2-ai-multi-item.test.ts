import { describe, expect, it } from 'vitest';
import { QUESTION_FIXTURES, keyAnswerOf, type QuestionContent } from '@allingo/schemas';
import { explainChoiceKey } from '../../src/modules/ai-gateway/index.js';
import { ExplainService } from '../../src/modules/ai-gateway/features/explain.service.js';
import { referencedQuestionData, type TutorReferencedQuestion } from '../../src/modules/learning/tutor/context-builder.js';
import type { LoadedQuestion } from '../../src/modules/catalog/index.js';

const loaded = (content: QuestionContent): LoadedQuestion =>
  ({
    question_id: '11111111-1111-4111-8111-111111111111',
    question_version_id: '22222222-2222-4222-8222-222222222222',
    program_code: 'ielts',
    section_code: 'reading_p1',
    question_type: content.type,
    content,
    subskill_codes: [],
    passage: null,
  }) as unknown as LoadedQuestion;

/** C2 – giải thích/gia sư AI cho dạng câu nhiều mục (qua AiGateway – chỉ kiểm phần dựng biến, không gọi model) */
describe('explainChoiceKey (khoá cache giải thích)', () => {
  it('MCQ một đáp án = mã lựa chọn như S5', () => {
    expect(explainChoiceKey('mcq_single', 'B', { type: 'mcq_single', selected: 'B' })).toBe('B');
    expect(explainChoiceKey('mcq_single', null, null)).toBeNull();
  });
  it('dạng nhiều mục = "a:" + 16 hex, ổn định theo thứ tự khoá và hoa thường; khác câu trả lời → khác khoá', () => {
    const k1 = explainChoiceKey('sentence_completion', null, { type: 'sentence_completion', gaps: { '1': 'Cabinet', '2': 'workshops' } });
    const k2 = explainChoiceKey('sentence_completion', null, { type: 'sentence_completion', gaps: { '2': 'workshops ', '1': 'cabinet' } });
    const k3 = explainChoiceKey('sentence_completion', null, { type: 'sentence_completion', gaps: { '1': 'shelf', '2': 'workshops' } });
    expect(k1).toMatch(/^a:[0-9a-f]{16}$/);
    expect(k1!.length).toBeLessThanOrEqual(32);
    expect(k2).toBe(k1);
    expect(k3).not.toBe(k1);
    // Không chứa nội dung câu trả lời
    expect(k1).not.toContain('cabinet');
  });
  it('câu trả lời khác dạng / không có → giữ chosen', () => {
    expect(explainChoiceKey('tfng', null, { type: 'mcq_single', selected: 'A' })).toBeNull();
    expect(explainChoiceKey('tfng', 'x', undefined)).toBe('x');
  });
});

describe('ExplainService.variablesOf – mọi dạng tự chấm qua describeQuestion', () => {
  it('matching_headings: options = danh sách tiêu đề, items = đoạn kèm đáp án đúng + của người học', () => {
    const c = QUESTION_FIXTURES.matching_headings.content;
    const v = ExplainService.variablesOf(loaded(c), null, 'vi', keyAnswerOf(c));
    expect(v.question_type).toBe('matching_headings');
    expect((v.options as unknown[]).length).toBeGreaterThan(0);
    const items = v.items as Array<{ correct: string; chosen: string | null }>;
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.chosen).toBe(it.correct);
    expect(String(v.chosen_option)).not.toBe('null');
  });
  it('dạng điền từ: instructions = giới hạn từ', () => {
    const v = ExplainService.variablesOf(loaded(QUESTION_FIXTURES.note_completion.content), null, 'en', null);
    expect(String(v.instructions)).toMatch(/^Write /);
    expect(v.chosen_option).toBe('null');
  });
  it('MCQ một đáp án giữ hành vi S5 (chosen = mã lựa chọn, items rỗng)', () => {
    const v = ExplainService.variablesOf(loaded(QUESTION_FIXTURES.mcq_single.content), 'C', 'vi');
    expect(v.chosen_option).toBe('C');
    expect(v.items).toEqual([]);
  });
  it('essay/speaking không giải thích được → 400', () => {
    expect(ExplainService.explainable(loaded(QUESTION_FIXTURES.essay.content))).toBe(false);
    expect(() => ExplainService.variablesOf(loaded(QUESTION_FIXTURES.speaking.content), null, 'vi')).toThrow();
  });
});

describe('tutor referenced_question.items – chỉ lộ đáp án khi reveal (Exam Mode)', () => {
  const ref = (reveal: boolean): TutorReferencedQuestion => ({
    question_version_id: '33333333-3333-4333-8333-333333333333',
    section_code: 'reading_p1',
    question_type: 'tfng',
    stem: 'Do the statements agree with the passage?',
    options: [],
    instructions: 'TRUE / FALSE / NOT GIVEN',
    items: [{ key: '1', text: 'The library opened in 2019.', correct: 'TRUE', chosen: 'FALSE' }],
    passage_excerpt: null,
    reveal,
    correct_option: '1: TRUE',
    explanation: null,
    learner_choice: '1: FALSE',
  });
  it('reveal = false → mục không có correct/chosen', () => {
    const d = referencedQuestionData(ref(false));
    expect(d.items).toEqual([{ key: '1', text: 'The library opened in 2019.' }]);
    expect(JSON.stringify(d)).not.toContain('TRUE"');
    expect(d.instructions).toBe('TRUE / FALSE / NOT GIVEN');
  });
  it('reveal = true → mục có đáp án và lựa chọn của người học', () => {
    expect(referencedQuestionData(ref(true)).items).toEqual([{ key: '1', text: 'The library opened in 2019.', correct: 'TRUE', chosen: 'FALSE' }]);
  });
});
