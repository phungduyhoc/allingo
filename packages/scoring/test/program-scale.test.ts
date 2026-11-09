import { describe, expect, it } from 'vitest';
import { estimateIeltsDiagnostic, suggestBandTarget, ieltsListeningBand, ieltsReadingBand, scoreByProgram, suggestTargetFor, targetBucketFor, toeicLrEstimate } from '../src/index.js';

const toeicSkill = (code: string) => (/^part[1-4]$/.test(code) ? 'listening' : /^part[5-7]$/.test(code) ? 'reading' : null);
const ieltsSkill = (code: string) => (code.startsWith('listening_') ? 'listening' : code.startsWith('reading_') ? 'reading' : null);

/** C1 – quy đổi điểm theo chương trình: TOEIC giữ nguyên hành vi S4, IELTS band sẵn cho C3, JLPT/HSK chỉ khai báo */
describe('scoreByProgram – TOEIC (không đổi so với toeicLrEstimate)', () => {
  it.each([
    [{ part1: { marks: 5, max_marks: 6 }, part2: { marks: 20, max_marks: 25 }, part5: { marks: 25, max_marks: 30 }, part7: { marks: 40, max_marks: 54 } }],
    [{ part3: { marks: 10, max_marks: 39 } }],
    [{ part6: { marks: 16, max_marks: 16 } }],
  ])('%#: tổng/kỹ năng/khoảng bằng toeicLrEstimate', (bySection) => {
    const r = scoreByProgram({ program: 'toeic', kind: 'toeic_lr', bySection, skillOf: toeicSkill });
    const sum = (skill: string) => {
      const xs = Object.entries(bySection).filter(([c]) => toeicSkill(c) === skill);
      return xs.length ? { correct: xs.reduce((a, [, s]) => a + s.marks, 0), total: xs.reduce((a, [, s]) => a + s.max_marks, 0) } : undefined;
    };
    const old = toeicLrEstimate({ listening: sum('listening'), reading: sum('reading') });
    expect(r.toeic).toEqual(old);
    expect(r.value).toBe(old.total ?? old.listening ?? old.reading);
    expect(r.scale).toMatchObject({ program: 'toeic', listening: old.listening, reading: old.reading, total: old.total, partial: old.total === null });
    for (const code of Object.keys(bySection)) expect(r.sections[code]).toBe(toeicSkill(code) === 'listening' ? old.listening : old.reading);
  });
  it('không có Part tự chấm → toeic null, value null', () => {
    const r = scoreByProgram({ program: 'toeic', kind: 'toeic_lr', bySection: { writing_q8: { marks: 0, max_marks: 1 } }, skillOf: toeicSkill });
    expect(r.toeic).toBeNull();
    expect(r.value).toBeNull();
    expect(r.sections).toEqual({ writing_q8: null });
  });
});

describe('scoreByProgram – IELTS band', () => {
  it('Listening + Reading: band từng kỹ năng theo bảng riêng; C3 – thiếu Writing/Speaking → không có overall (value/band null)', () => {
    const r = scoreByProgram({
      program: 'ielts',
      kind: 'band',
      bySection: { listening_p1: { marks: 10, max_marks: 10 }, listening_p2: { marks: 20, max_marks: 30 }, reading_p1: { marks: 26, max_marks: 40 } },
      skillOf: ieltsSkill,
    });
    expect(r.skills.listening?.scaled).toBe(ieltsListeningBand(30, 40));
    expect(r.skills.reading?.scaled).toBe(ieltsReadingBand(26, 40, 'academic'));
    expect(r.value).toBeNull();
    expect(r.sections).toEqual({ listening_p1: 7, listening_p2: 7, reading_p1: 6 });
    expect(r.scale).toMatchObject({ program: 'ielts', unit: 'band', band: null, bands: { listening: 7, reading: 6 }, raw: { listening: { correct: 30, total: 40 } }, module: 'academic', partial: true });
    expect(r.toeic).toBeNull();
  });
  it('đề ngắn (18 mục): quy về /40; một kỹ năng → value = band kỹ năng đó', () => {
    const r = scoreByProgram({ program: 'ielts', kind: 'band', bySection: { reading_p1: { marks: 11, max_marks: 22 } }, skillOf: ieltsSkill });
    expect(r.value).toBe(ieltsReadingBand(20, 40));
    expect(r.skills.listening).toBeUndefined();
  });
  it('C3: Reading General Training dùng bảng GT – cùng số câu đúng cho band thấp hơn Academic', () => {
    const bySection = { reading_p1: { marks: 13, max_marks: 13 }, reading_p2: { marks: 10, max_marks: 13 }, reading_p3: { marks: 7, max_marks: 14 } };
    const ac = scoreByProgram({ program: 'ielts', kind: 'band', bySection, skillOf: ieltsSkill, module: 'academic' });
    const gt = scoreByProgram({ program: 'ielts', kind: 'band', bySection, skillOf: ieltsSkill, module: 'general_training' });
    expect(ac.value).toBe(7); // 30/40
    expect(gt.value).toBe(6); // 30/40 GT
    expect(gt.scale).toMatchObject({ module: 'general_training', bands: { reading: 6 } });
  });
  it('C3: đề Listening không ghi module (module null)', () => {
    const r = scoreByProgram({ program: 'ielts', kind: 'band', bySection: { listening_p1: { marks: 9, max_marks: 10 } }, skillOf: ieltsSkill, module: 'general_training' });
    expect(r.scale).toMatchObject({ module: null, bands: { listening: ieltsListeningBand(36, 40) } });
  });
  it('không có mục tự chấm → value null', () => {
    expect(scoreByProgram({ program: 'ielts', kind: 'band', bySection: {}, skillOf: ieltsSkill }).value).toBeNull();
  });
});

describe('scoreByProgram – JLPT/HSK (chưa có bảng quy đổi)', () => {
  it('value null, implemented false', () => {
    const r = scoreByProgram({ program: 'jlpt', kind: 'points', bySection: { vocab: { marks: 5, max_marks: 10 } }, skillOf: () => 'language_knowledge' });
    expect(r.value).toBeNull();
    expect(r.scale).toMatchObject({ program: 'jlpt', implemented: false });
    expect(r.sections).toEqual({ vocab: null });
  });
});

describe('targetBucketFor / suggestTargetFor', () => {
  it('TOEIC theo trăm, band theo 0,5, điểm khác theo chục (giống targetBucket S10)', () => {
    expect(targetBucketFor('toeic_lr', 650)).toEqual({ label: '600-695', lo: 600, hi: 700 });
    expect(targetBucketFor('band', 6.7)).toEqual({ label: '6.5', lo: 6.5, hi: 7 });
    expect(targetBucketFor('points', 125)).toEqual({ label: '120-129', lo: 120, hi: 130 });
    expect(targetBucketFor('band', null)).toBeNull();
    expect(targetBucketFor('toeic_lr', Number.NaN)).toBeNull();
  });
  it('gợi ý mục tiêu: TOEIC và band (C3); thang points chưa có mô hình', () => {
    const input = { current: 5.5, examDate: '2027-03-01', today: '2026-11-09', weeklyMinutes: 300 };
    expect(suggestTargetFor('band', input)).toMatchObject({ current: 5.5 });
    expect(suggestTargetFor('points', input)).toBeNull();
  });
});

describe('C3 – suggestBandTarget / estimateIeltsDiagnostic', () => {
  it('nhiều tuần + nhiều phút → band cao hơn, làm tròn xuống 0,5, không vượt 9, không thấp hơn hiện tại', () => {
    const few = suggestBandTarget({ current: 5.5, today: '2026-11-09', examDate: '2026-11-23', weeklyMinutes: 60 });
    const many = suggestBandTarget({ current: 5.5, today: '2026-11-09', examDate: '2027-05-09', weeklyMinutes: 600 });
    expect(few.suggested).toBe(5.5);
    expect(many.suggested).toBeGreaterThan(5.5);
    expect(many.suggested * 2).toBe(Math.round(many.suggested * 2));
    expect(suggestBandTarget({ current: 8.5, today: '2026-11-09', examDate: '2028-11-09', weeklyMinutes: 2000 }).suggested).toBeLessThanOrEqual(9);
  });
  it('mục tiêu mong muốn: feasible / stretch (phút cần) / unreachable; không có ngày thi → 12 tuần', () => {
    const base = { current: 5.5, today: '2026-11-09', examDate: '2027-02-01', weeklyMinutes: 180 };
    expect(suggestBandTarget({ ...base, desired: 5.5 })).toMatchObject({ feasible: true, reason: 'feasible' });
    const stretch = suggestBandTarget({ ...base, desired: 6.5 });
    expect(stretch.feasible).toBe(false);
    expect(['stretch', 'unreachable']).toContain(stretch.reason);
    if (stretch.reason === 'stretch') expect(stretch.required_weekly_minutes).toBeGreaterThan(180);
    expect(suggestBandTarget({ ...base, desired: 9 }).reason).toBe('unreachable');
    expect(suggestBandTarget({ ...base, examDate: null }).weeks_left).toBe(12);
  });
  it('ước tính band chẩn đoán theo kỹ năng, khoảng ±1 khi < 10 câu, current = trung bình L/R', () => {
    const served = [
      ...Array.from({ length: 8 }, (_, i) => ({ skill: 'listening', correct: i < 6 })),
      ...Array.from({ length: 12 }, (_, i) => ({ skill: 'reading', correct: i < 9 })),
      { skill: 'reading', correct: null },
    ];
    const e = estimateIeltsDiagnostic(served);
    expect(e.listening).toEqual({ score: ieltsListeningBand(6, 8), low: ieltsListeningBand(6, 8) - 1, high: ieltsListeningBand(6, 8) + 1 });
    expect(e.reading?.score).toBe(ieltsReadingBand(9, 12));
    expect(e.reading).not.toBeNull();
    expect(e.reading!.high - e.reading!.low).toBe(1);
    expect(e.answered).toBe(20);
    expect(e.current).not.toBeNull();
    expect(estimateIeltsDiagnostic([]).current).toBeNull();
  });
});
