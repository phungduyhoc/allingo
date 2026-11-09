import { describe, expect, it } from 'vitest';
import { IELTS_CBT, scaledPartsOf } from '@allingo/schemas';
import { LISTEN_SLACK_MS, evidenceSegments, listenWindowClosed, listeningTimings, lockedSkills, planTotalSec, skillPlan, skillWindows, type FormatSection } from '../../src/modules/test-engine/ielts-format.js';
import { classifyError, timeoutThreshold } from '../../src/modules/learning/errors/classify.js';

/** C3 – định dạng IELTS trên máy tính: đồng hồ theo kỹ năng, nghe một lần, trích đoạn đáp án trong transcript */

const listening = (n: number, rules: Record<string, unknown> = { preread_sec: 30 }): FormatSection => ({ code: `listening_p${n}`, skill: 'listening', duration_sec: 450, rules });
const reading = (n: number): FormatSection => ({ code: `reading_p${n}`, skill: 'reading', duration_sec: 1200, rules: {} });
const LR: FormatSection[] = [listening(1), listening(2), listening(3), listening(4, { preread_sec: 30, review_sec: 120 }), reading(1), reading(2), reading(3)];

describe('skillPlan', () => {
  it('Listening = Σ (đọc trước + audio part) + xem lại khi biết thời lượng mọi part; Reading = 3 × 20′', () => {
    const audio = new Map([['listening_p1', 300_000], ['listening_p2', 310_500], ['listening_p3', 400_000], ['listening_p4', 420_000]]);
    const plan = skillPlan(LR, audio);
    expect(plan.map((p) => p.skill)).toEqual(['listening', 'reading']);
    expect(plan[0]!.duration_sec).toBe(4 * 30 + 300 + 311 + 400 + 420 + 120);
    expect(plan[1]).toEqual({ skill: 'reading', sections: ['reading_p1', 'reading_p2', 'reading_p3'], duration_sec: IELTS_CBT.reading_duration_sec });
    expect(planTotalSec(plan)).toBe(plan[0]!.duration_sec + 3600);
  });
  it('thiếu thời lượng một part → Σ thời lượng section + xem lại', () => {
    const plan = skillPlan(LR.slice(0, 4), new Map([['listening_p1', 300_000]]));
    expect(plan[0]!.duration_sec).toBe(4 * 450 + 120);
  });
  it('rules không khai báo → hằng IELTS_CBT', () => {
    expect(listeningTimings([listening(1, {})])).toEqual({ preread_sec: IELTS_CBT.preread_sec, review_sec: IELTS_CBT.review_sec });
    expect(listeningTimings([listening(1, { preread_sec: 45 }), listening(4, { review_sec: 60 })])).toEqual({ preread_sec: 45, review_sec: 60 });
  });
});

describe('skillWindows / lockedSkills', () => {
  const plan = [
    { skill: 'listening', sections: ['listening_p1'], duration_sec: 1800 },
    { skill: 'reading', sections: ['reading_p1'], duration_sec: 3600 },
  ];
  const t0 = new Date('2026-11-09T01:00:00Z');
  it('kỹ năng sau bắt đầu khi kỹ năng trước hết giờ nếu chưa chuyển', () => {
    const w = skillWindows(plan, t0, {});
    expect(w[1]!.start.toISOString()).toBe('2026-11-09T01:30:00.000Z');
    expect(w[1]!.end.toISOString()).toBe('2026-11-09T02:30:00.000Z');
  });
  it('chuyển sớm → kỹ năng sau bắt đầu lúc chuyển, kỹ năng trước khoá ngay', () => {
    const w = skillWindows(plan, t0, { reading: '2026-11-09T01:20:00Z' });
    expect(w[1]!.start.toISOString()).toBe('2026-11-09T01:20:00.000Z');
    expect([...lockedSkills(w, Date.parse('2026-11-09T01:21:00Z'), 30)]).toEqual(['listening']);
    expect([...lockedSkills(w, Date.parse('2026-11-09T01:19:00Z'), 30)]).toEqual([]);
  });
  it('mốc ghi muộn hơn hạn kỹ năng trước bị kẹp về hạn đó; quá hạn + ân hạn → khoá', () => {
    const w = skillWindows(plan, t0, { reading: '2026-11-09T05:00:00Z' });
    expect(w[1]!.start.toISOString()).toBe('2026-11-09T01:30:00.000Z');
    const end = w[1]!.end.getTime();
    expect(lockedSkills(w, end + 29_000, 30).has('reading')).toBe(false);
    expect(lockedSkills(w, end + 31_000, 30).has('reading')).toBe(true);
  });
});

describe('listenWindowClosed (nghe một lần)', () => {
  const start = '2026-11-09T01:00:00.000Z';
  const t = Date.parse(start);
  it('chưa phát → mở; trong thời lượng + dung sai → mở; quá → đóng', () => {
    expect(listenWindowClosed(undefined, 60_000, t + 10 * 60_000, 1)).toBe(false);
    expect(listenWindowClosed(start, 60_000, t + 60_000 + LISTEN_SLACK_MS, 1)).toBe(false);
    expect(listenWindowClosed(start, 60_000, t + 60_000 + LISTEN_SLACK_MS + 1, 1)).toBe(true);
  });
  it('thời lượng chưa biết → cửa sổ dự phòng', () => {
    expect(listenWindowClosed(start, null, t + 5 * 60_000, 10 * 60_000)).toBe(false);
    expect(listenWindowClosed(start, null, t + 12 * 60_000, 10 * 60_000)).toBe(true);
  });
  it('mốc không đọc được → coi như chưa phát', () => expect(listenWindowClosed('not-a-date', 1, Date.now(), 1)).toBe(false));
});

describe('evidenceSegments', () => {
  const segments = [
    { text: 'Good morning, Riverside Sports Centre. How can I help?' },
    { text: "I'd like to book the badminton court for Thursday evening." },
    { text: 'Certainly. The court costs twelve pounds per hour.' },
    { text: 'Okay.' },
  ];
  it('khớp không phân biệt hoa thường/dấu câu; nhiều đoạn (dòng hoặc |)', () => {
    expect(evidenceSegments('THURSDAY evening', segments)).toEqual([1]);
    expect(evidenceSegments('badminton court for Thursday evening | twelve pounds per hour', segments)).toEqual([1, 2]);
    expect(evidenceSegments('costs twelve pounds\nRiverside Sports Centre', segments)).toEqual([0, 2]);
  });
  it('evidence dài chứa trọn segment (≥ 12 ký tự) cũng khớp; segment quá ngắn ("Okay") không khớp ngược', () => {
    expect(evidenceSegments('Certainly. The court costs twelve pounds per hour. Okay. Thanks!', segments)).toEqual([2]);
  });
  it('không có evidence/segments → rỗng', () => {
    expect(evidenceSegments(null, segments)).toEqual([]);
    expect(evidenceSegments('x', undefined)).toEqual([]);
    expect(evidenceSegments('  |  ', segments)).toEqual([]);
  });
});

describe('classifyError – IELTS (C3)', () => {
  const base = { skill_code: 'reading', subskill_codes: [], topic_code: null, time_spent_ms: 120_000, answered: true, auto_submitted: false };
  it('ngưỡng chậm theo cả câu nhiều mục (không áp ngưỡng Part TOEIC)', () => {
    expect(timeoutThreshold('reading_p2')).toBe(1_200_000);
    expect(timeoutThreshold('listening_p3')).toBe(600_000);
    expect(classifyError({ ...base, section_code: 'reading_p2' }).rule).not.toBe('slow');
  });
  it('Reading IELTS mặc định → paraphrase; Listening → listening_detail', () => {
    expect(classifyError({ ...base, section_code: 'reading_p1' })).toMatchObject({ kind: 'paraphrase', rule: 'section' });
    expect(classifyError({ ...base, skill_code: 'listening', section_code: 'listening_p2' })).toMatchObject({ kind: 'listening_detail', rule: 'section' });
  });
});

describe('scaledPartsOf (thống kê/dự báo)', () => {
  it('TOEIC dùng scaled; IELTS lấy bands + band overall', () => {
    expect(scaledPartsOf({ scaled: { total: 700, listening: 380, reading: 320 } })).toEqual({ total: 700, listening: 380, reading: 320 });
    expect(scaledPartsOf({ scaled: null, scale: { unit: 'band', band: null, bands: { reading: 6.5 } } })).toEqual({ total: null, listening: null, reading: 6.5 });
    expect(scaledPartsOf({ scale: { unit: 'band', band: 7, bands: { listening: 7, reading: 7.5 } } })).toEqual({ total: 7, listening: 7, reading: 7.5 });
    expect(scaledPartsOf({ scale: { unit: 'points' } })).toBeNull();
    expect(scaledPartsOf(null)).toBeNull();
  });
});

describe('explainEvalLineSchema – dòng eval IELTS (S169)', () => {
  it('mọi dòng explain_mcq_ielts_v1.jsonl và explain_mcq_v1.jsonl hợp lệ', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { explainEvalLineSchema } = await import('../../src/modules/ai-gateway/core/eval.service.js');
    for (const f of ['../../eval/data/explain_mcq_ielts_v1.jsonl', '../../eval/data/explain_mcq_v1.jsonl']) {
      const path = new URL(f, `file://${process.cwd()}/`).pathname;
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      const bad = lines.map((l) => explainEvalLineSchema.safeParse(JSON.parse(l))).filter((r) => !r.success);
      expect(bad, f).toHaveLength(0);
    }
  });
});
