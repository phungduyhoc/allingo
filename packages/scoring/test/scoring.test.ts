import { describe, expect, it } from 'vitest';
import { ieltsLrBand, ieltsOverall, ieltsRoundOverall, paToIeltsBand, toeicLr, toeicLrEstimate, toeicRange, toeicScaled, toeicSwScaled } from '../src/index.js';

describe('TOEIC L&R', () => {
  it('biên', () => {
    expect(toeicScaled('listening', 0)).toBe(5);
    expect(toeicScaled('listening', 100)).toBe(495);
    expect(toeicScaled('reading', 100)).toBe(495);
    expect(toeicScaled('reading', 0)).toBe(5);
  });
  it('đơn điệu tăng, bước 5', () => {
    let prev = 0;
    for (let c = 0; c <= 100; c++) {
      const s = toeicScaled('reading', c);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s % 5).toBe(0);
      prev = s;
    }
  });
  it('tỷ lệ với total khác 100 (đề mini 10 câu)', () => {
    expect(toeicScaled('reading', 5, 10)).toBe(toeicScaled('reading', 50, 100));
  });
  it('tổng hợp', () => {
    const r = toeicLr({ listening: { correct: 80, total: 100 }, reading: { correct: 70, total: 100 } });
    expect(r.total).toBe((r.listening ?? 0) + (r.reading ?? 0));
    expect(toeicLr({ reading: { correct: 10, total: 10 } }).total).toBeNull();
  });
});

describe('TOEIC S/W', () => {
  it('scaled = round(raw/max*200/10)*10', () => {
    expect(toeicSwScaled('speaking', 35)).toBe(200);
    expect(toeicSwScaled('speaking', 17)).toBe(100);
    expect(toeicSwScaled('writing', 28)).toBe(200);
    expect(toeicSwScaled('writing', 0)).toBe(0);
  });
});

describe('IELTS', () => {
  it('làm tròn .25 → .5, .75 → lên', () => {
    expect(ieltsRoundOverall(6.25)).toBe(6.5);
    expect(ieltsRoundOverall(6.75)).toBe(7);
    expect(ieltsRoundOverall(6.1)).toBe(6);
    expect(ieltsRoundOverall(6.6)).toBe(6.5);
    expect(ieltsOverall({ task: 6, coherence_cohesion: 6, lexical_resource: 7, grammatical_range_accuracy: 6 })).toBe(6.5);
  });
  it('PA → band', () => {
    expect(paToIeltsBand({ accuracy: 95, fluency: 92, prosody: 90 }).band).toBe(8);
    expect(paToIeltsBand({ accuracy: 60, fluency: 50, prosody: 40 }).band).toBe(3.5);
    expect(paToIeltsBand({ accuracy: 88, fluency: 90, prosody: 86 }).band).toBe(7.5);
  });
  it('L/R band', () => {
    expect(ieltsLrBand(40)).toBe(9);
    expect(ieltsLrBand(30)).toBe(7);
    expect(ieltsLrBand(0)).toBe(0);
  });
});

describe('TOEIC L&R – bảng mẫu & khoảng ước tính (Sprint 4)', () => {
  // [số câu đúng /100, Listening, Reading] – ước tính Allingo, không phải bảng chính thức ETS
  const TABLE: ReadonlyArray<readonly [number, number, number]> = [
    [0, 5, 5],
    [1, 10, 10],
    [50, 275, 235],
    [75, 395, 375],
    [100, 495, 495],
  ];
  it.each(TABLE)('%i câu đúng → L %i / R %i', (correct, l, r) => {
    expect(toeicScaled('listening', correct)).toBe(l);
    expect(toeicScaled('reading', correct)).toBe(r);
  });
  it('tổng 10–990 = L + R', () => {
    for (const [c, l, r] of TABLE) {
      const est = toeicLrEstimate({ listening: { correct: c, total: 100 }, reading: { correct: c, total: 100 } });
      expect(est.total).toBe(l + r);
      expect(est.total).toBeGreaterThanOrEqual(10);
      expect(est.total).toBeLessThanOrEqual(990);
      expect(est.estimated).toBe(true);
    }
    expect(toeicLrEstimate({ listening: { correct: 0, total: 100 }, reading: { correct: 0, total: 100 } }).total).toBe(10);
    expect(toeicLrEstimate({ listening: { correct: 100, total: 100 }, reading: { correct: 100, total: 100 } }).total).toBe(990);
  });
  it('khoảng ±25 cắt trong 5–495 / 10–990', () => {
    expect(toeicRange(495, 'listening')).toEqual({ low: 470, high: 495 });
    expect(toeicRange(5, 'reading')).toEqual({ low: 5, high: 30 });
    expect(toeicRange(300, 'reading')).toEqual({ low: 275, high: 325 });
    expect(toeicRange(990, 'total')).toEqual({ low: 965, high: 990 });
    expect(toeicRange(10, 'total')).toEqual({ low: 10, high: 35 });
    const full = toeicLrEstimate({ listening: { correct: 100, total: 100 }, reading: { correct: 0, total: 100 } });
    expect(full).toMatchObject({ listening: 495, reading: 5, total: 500, range: { low: 475, high: 525 }, ranges: { listening: { low: 470, high: 495 }, reading: { low: 5, high: 30 } }, half_width: 25 });
  });
  it('thiếu một kỹ năng: total null, range theo kỹ năng có mặt; không có gì → null', () => {
    const r = toeicLrEstimate({ reading: { correct: 30, total: 30 } });
    expect(r.total).toBeNull();
    expect(r.reading).toBe(495);
    expect(r.range).toEqual({ low: 470, high: 495 });
    expect(r.ranges.listening).toBeNull();
    expect(toeicLrEstimate({}).range).toBeNull();
  });
  it('đề mini (33 L / 27 R) quy về /100 theo tỷ lệ', () => {
    const r = toeicLrEstimate({ listening: { correct: 33, total: 33 }, reading: { correct: 0, total: 27 } });
    expect(r).toMatchObject({ listening: 495, reading: 5, total: 500 });
  });
});
