import { describe, expect, it } from 'vitest';
import type { DiagnosticStep } from '@allingo/schemas';
import { answerBody, currentQuestionId, diagnosticProgress, diagnosticReducer, initialDiagnosticState, type DiagnosticUiState } from './diagnostic-state';

const step = (qid: string | null, over: Partial<DiagnosticStep> = {}): DiagnosticStep => ({
  attempt_id: 'att',
  done: false,
  next_question: qid ? { question_id: qid, section_code: 'part5', content: { type: 'mcq_single' } } : null,
  progress: { answered: 0, served: 1, planned: 12, section_code: 'part5', level: 1, group_remaining: 0 },
  estimate: null,
  last_correct: null,
  result: null,
  ...over,
});
const A = { type: 'mcq_single' as const, selected: 'B' };
const run = (actions: Parameters<typeof diagnosticReducer>[1][], from: DiagnosticUiState = initialDiagnosticState) => actions.reduce(diagnosticReducer, from);

describe('diagnosticReducer', () => {
  it('load → loaded hiện câu, chọn → gửi → câu kế tiếp (đáp án reset, không lộ đúng/sai)', () => {
    let s = run([{ type: 'load' }, { type: 'loaded', step: step('q1'), at: 1000 }]);
    expect(s.phase).toBe('question');
    expect(s.shownAt).toBe(1000);
    s = run([{ type: 'select', answer: A }, { type: 'submit' }], s);
    expect(s.phase).toBe('submitting');
    expect(answerBody(s, 4500)).toEqual({ question_id: 'q1', answer: A, time_spent_ms: 3500 });
    s = diagnosticReducer(s, { type: 'loaded', step: step('q2', { last_correct: true, progress: { answered: 1, served: 2, planned: 12, section_code: 'part5', level: 1, group_remaining: 0 } }), at: 5000 });
    expect(s.phase).toBe('question');
    expect(s.answer).toBeNull();
    expect(s.shownAt).toBe(5000);
    expect(currentQuestionId(s.step)).toBe('q2');
  });

  it('không gửi khi chưa chọn; không chọn khi đang gửi', () => {
    let s = run([{ type: 'loaded', step: step('q1'), at: 0 }, { type: 'submit' }]);
    expect(s.phase).toBe('question');
    s = run([{ type: 'select', answer: A }, { type: 'submit' }, { type: 'select', answer: { type: 'mcq_single', selected: 'C' } }], s);
    expect(s.phase).toBe('submitting');
    expect(s.answer).toEqual(A);
  });

  it('409 → đồng bộ lại: cùng câu giữ đáp án + thời điểm; câu khác thì reset', () => {
    const s = run([{ type: 'loaded', step: step('q1'), at: 100 }, { type: 'select', answer: A }, { type: 'submit' }, { type: 'conflict' }]);
    expect(s.phase).toBe('loading');
    expect(s.resyncs).toBe(1);
    const same = diagnosticReducer(s, { type: 'loaded', step: step('q1'), at: 900 });
    expect(same.answer).toEqual(A);
    expect(same.shownAt).toBe(100);
    expect(same.resyncs).toBe(1);
    const other = diagnosticReducer(s, { type: 'loaded', step: step('q7'), at: 900 });
    expect(other.answer).toBeNull();
    expect(other.resyncs).toBe(0);
  });

  it('lỗi khi gửi → quay lại câu giữ đáp án; lỗi khi chưa có câu → màn lỗi', () => {
    const s = run([{ type: 'loaded', step: step('q1'), at: 0 }, { type: 'select', answer: A }, { type: 'submit' }, { type: 'failed', error: new Error('x') }]);
    expect(s.phase).toBe('question');
    expect(s.answer).toEqual(A);
    expect(s.error).toBeInstanceOf(Error);
    expect(run([{ type: 'load' }, { type: 'failed', error: 'boom' }]).phase).toBe('error');
  });

  it('bước done → kết quả', () => {
    const s = run([{ type: 'loaded', step: step(null, { done: true, progress: { answered: 12, served: 12, planned: 12, section_code: null, level: null, group_remaining: 0 } }), at: 0 }]);
    expect(s.phase).toBe('done');
    expect(answerBody(s, 1)).toBeNull();
  });
});

describe('diagnosticProgress', () => {
  it('câu thứ n / dự kiến, planned không nhỏ hơn served', () => {
    expect(diagnosticProgress(null)).toEqual({ number: 0, planned: 0, pct: 0 });
    expect(diagnosticProgress(step('q', { progress: { answered: 3, served: 4, planned: 12, section_code: 'part5', level: 2, group_remaining: 0 } }))).toEqual({ number: 4, planned: 12, pct: 25 });
    expect(diagnosticProgress(step('q', { progress: { answered: 13, served: 14, planned: 12, section_code: 'part7', level: 1, group_remaining: 1 } }))).toEqual({ number: 14, planned: 14, pct: 93 });
    expect(diagnosticProgress(step(null, { done: true, progress: { answered: 14, served: 14, planned: 14, section_code: null, level: null, group_remaining: 0 } }))).toEqual({ number: 14, planned: 14, pct: 100 });
  });
});
