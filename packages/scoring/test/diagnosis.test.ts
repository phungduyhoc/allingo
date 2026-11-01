import { describe, expect, it } from 'vitest';
import { diagnoseAttempt, type DiagnosisQuestion } from '../src/index.js';

const q = (i: number, section: string, ok: boolean | null, opts: Partial<DiagnosisQuestion> = {}): DiagnosisQuestion => ({
  question_id: `q${i}`,
  section_code: section,
  subskill_codes: [],
  topic_code: null,
  answered: ok !== null,
  is_correct: ok === null ? false : ok,
  time_ms: 20_000,
  ...opts,
});

describe('chẩn đoán theo quy tắc', () => {
  it('xác định Part/kỹ năng con yếu (< 60 %, ≥ 2 câu) và gợi ý luyện đúng Part', () => {
    const qs = [
      ...Array.from({ length: 10 }, (_, i) => q(i, 'part5', i < 9, { subskill_codes: ['word_form'] })),
      ...Array.from({ length: 6 }, (_, i) => q(20 + i, 'part6', i < 2, { subskill_codes: ['conjunction'], topic_code: 'hr' })),
      q(30, 'part7', false, { subskill_codes: ['inference'] }),
    ];
    const d = diagnoseAttempt(qs, { autoSubmitted: false });
    expect(d.weak_sections.map((w) => w.code)).toEqual(['part6']);
    expect(d.weak_subskills.map((w) => w.code)).toEqual(['conjunction']);
    expect(d.weak_subskills[0]).toMatchObject({ correct: 2, total: 6, accuracy: 0.333 });
    expect(d.weak_topics.map((w) => w.code)).toEqual(['hr']);
    expect(d.recommendations[0]).toEqual({ kind: 'drill', section_code: 'part6', subskill_code: 'conjunction' });
    expect(d.flags).toEqual([]);
  });

  it('nộp tự động: câu bỏ trống tính là sai do hết giờ; nhiều câu bỏ trống → cờ', () => {
    const qs = [...Array.from({ length: 8 }, (_, i) => q(i, 'part7', true)), q(8, 'part7', null), q(9, 'part7', null)];
    const d = diagnoseAttempt(qs, { autoSubmitted: true });
    expect(d.unanswered).toBe(2);
    expect(d.timeout_wrong).toBe(2);
    expect(d.flags).toEqual(expect.arrayContaining(['many_unanswered', 'time_pressure']));
    expect(diagnoseAttempt(qs, { autoSubmitted: false }).timeout_wrong).toBe(0);
  });

  it('câu sai làm chậm (> 2× trung vị Part) và hiệu suất cao', () => {
    const qs = [...Array.from({ length: 12 }, (_, i) => q(i, 'part5', true, { time_ms: 15_000 })), q(12, 'part5', false, { time_ms: 60_000 }), q(13, 'part5', false, { time_ms: 61_000 }), q(14, 'part5', false, { time_ms: 70_000 })];
    const d = diagnoseAttempt(qs, { autoSubmitted: false });
    expect(d.slow_wrong_question_ids).toEqual(['q12', 'q13', 'q14']);
    expect(d.flags).toContain('slow_reading');
    const strong = diagnoseAttempt(Array.from({ length: 20 }, (_, i) => q(i, 'part5', i !== 0)), { autoSubmitted: false });
    expect(strong.flags).toContain('strong_performance');
    expect(strong.overall_accuracy).toBe(0.95);
  });

  it('không có câu chấm được → độ chính xác 0, không lỗi', () => {
    expect(diagnoseAttempt([], { autoSubmitted: false })).toMatchObject({ overall_accuracy: 0, unanswered: 0, recommendations: [] });
  });
});
