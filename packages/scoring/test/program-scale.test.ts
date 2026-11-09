import { describe, expect, it } from 'vitest';
import { ieltsLrBand, scoreByProgram, suggestTargetFor, targetBucketFor, toeicLrEstimate } from '../src/index.js';

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
  it('đủ Listening + Reading: band từng kỹ năng theo /40, overall làm tròn .25/.75, không partial về L/R', () => {
    const r = scoreByProgram({
      program: 'ielts',
      kind: 'band',
      bySection: { listening_p1: { marks: 10, max_marks: 10 }, listening_p2: { marks: 20, max_marks: 30 }, reading_p1: { marks: 26, max_marks: 40 } },
      skillOf: ieltsSkill,
    });
    expect(r.skills.listening?.scaled).toBe(ieltsLrBand(30, 40));
    expect(r.skills.reading?.scaled).toBe(ieltsLrBand(26, 40));
    expect(r.value).toBe(7); // (7 + 6.5)/2 = 6.75 → 7
    expect(r.sections).toEqual({ listening_p1: 7, listening_p2: 7, reading_p1: 6.5 });
    expect(r.scale).toMatchObject({ program: 'ielts', unit: 'band', band: 7, bands: { listening: 7, reading: 6.5 }, raw: { listening: { correct: 30, total: 40 } }, partial: true });
    expect(r.toeic).toBeNull();
  });
  it('đề ngắn (18 mục): quy về /40; một kỹ năng → overall = band kỹ năng đó', () => {
    const r = scoreByProgram({ program: 'ielts', kind: 'band', bySection: { reading_p1: { marks: 11, max_marks: 22 } }, skillOf: ieltsSkill });
    expect(r.value).toBe(ieltsLrBand(20, 40));
    expect(r.skills.listening).toBeUndefined();
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
  it('gợi ý mục tiêu chỉ có cho TOEIC', () => {
    const input = { estimate: 500, examDate: '2027-03-01', today: '2026-11-09', minutesPerDay: 30 } as unknown as Parameters<typeof suggestTargetFor>[1];
    expect(suggestTargetFor('band', input)).toBeNull();
    expect(suggestTargetFor('points', input)).toBeNull();
  });
});
