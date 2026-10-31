import { describe, expect, it } from 'vitest';
import { ieltsLrBand, ieltsOverall, ieltsRoundOverall, paToIeltsBand, toeicLr, toeicScaled, toeicSwScaled } from '../src/index.js';

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
