import { describe, expect, it } from 'vitest';
import { diagnoseAttempt } from '@allingo/scoring';
import { checkAnswerIndex, knownFlags, parseDiagnosis, recommendationHref, scaleView, toPercent } from './diagnosis';

describe('diagnosis (khối Chẩn đoán màn kết quả)', () => {
  it('đọc đúng cấu trúc AttemptDiagnosis của packages/scoring', () => {
    const raw = diagnoseAttempt(
      [
        { question_id: 'a', section_code: 'part5', subskill_codes: ['verb_tense'], topic_code: 'office', answered: true, is_correct: false, time_ms: 9000 },
        { question_id: 'b', section_code: 'part5', subskill_codes: ['verb_tense'], topic_code: 'office', answered: true, is_correct: false, time_ms: 8000 },
        { question_id: 'c', section_code: 'part5', subskill_codes: ['preposition'], topic_code: null, answered: true, is_correct: true, time_ms: 4000 },
        { question_id: 'd', section_code: 'part6', subskill_codes: [], topic_code: null, answered: false, is_correct: false, time_ms: null },
      ],
      { autoSubmitted: true },
    );
    const d = parseDiagnosis(raw);
    expect(d).not.toBeNull();
    expect(d!.weak_subskills[0]).toMatchObject({ code: 'verb_tense', correct: 0, total: 2 });
    expect(knownFlags(d!)).toEqual(['many_unanswered', 'time_pressure']);
    expect(d!.recommendations[0]).toEqual({ kind: 'drill', section_code: 'part5', subskill_code: 'verb_tense' });
    expect(recommendationHref(d!.recommendations[0]!)).toBe('/toeic/practice?section=part5&subskill=verb_tense');
  });

  it('dữ liệu sai dạng → null; cờ lạ bị bỏ qua', () => {
    expect(parseDiagnosis(null)).toBeNull();
    expect(parseDiagnosis({ method: 'rules' })).toBeNull();
    const d = parseDiagnosis({ method: 'rules', overall_accuracy: 0.9, flags: ['strong_performance', 'future_flag'] });
    expect(d && knownFlags(d)).toEqual(['strong_performance']);
    expect(toPercent(0.666)).toBe(67);
    expect(toPercent(1.4)).toBe(100);
  });

  it('thang điểm ước tính: một kỹ năng 5–495, đủ hai kỹ năng 10–990', () => {
    expect(scaleView({ scale: { program: 'toeic', listening: null, reading: 235, total: null }, by_section: {} })).toEqual({ kind: 'skill', skill: 'reading', min: 5, max: 495 });
    expect(scaleView({ scale: { program: 'toeic', listening: 300, reading: 235, total: 535 }, by_section: {} })).toEqual({ kind: 'total', min: 10, max: 990 });
    expect(scaleView({ scale: { program: 'toeic', skills: { listening: 120, reading: null } }, by_section: {} })).toMatchObject({ skill: 'listening', min: 5 });
    expect(scaleView({ scale: {}, by_section: { part5: { correct: 1, total: 2, avg_time_ms: null, score: null } } })).toMatchObject({ kind: 'skill', skill: 'reading' });
    expect(scaleView({ scale: { program: 'ielts' }, by_section: {} })).toBeNull();
  });
});

describe('checkAnswerIndex – câu tự kiểm tra của chẩn đoán AI', () => {
  const options = ['entitled', 'available', 'capable'];
  it('khớp nguyên văn (không phân biệt hoa thường/khoảng trắng)', () => {
    expect(checkAnswerIndex(options, 'entitled')).toBe(0);
    expect(checkAnswerIndex(options, '  Capable ')).toBe(2);
  });
  it('khớp chữ cái A/B/C (kể cả "B." / "b)"), ngoài phạm vi → -1', () => {
    expect(checkAnswerIndex(options, 'B')).toBe(1);
    expect(checkAnswerIndex(options, 'b)')).toBe(1);
    expect(checkAnswerIndex(options, 'D')).toBe(-1);
    expect(checkAnswerIndex(options, 'unrelated')).toBe(-1);
  });
});
