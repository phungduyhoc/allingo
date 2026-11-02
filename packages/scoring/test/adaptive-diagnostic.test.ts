import { describe, expect, it } from 'vitest';
import {
  TOEIC_DIAGNOSTIC_BLUEPRINT,
  applyRunRule,
  buildDiagnosticPool,
  diagnosticAdvance,
  diagnosticItemScore,
  estimateToeicDiagnostic,
  initDiagnosticState,
  masteryFromDiagnostic,
  suggestToeicTarget,
  unitLevel,
  DiagnosticRuleError,
  type DiagnosticItem,
  type DiagnosticState,
} from '../src/index.js';

/** Ngân hàng giả lập ~ cấu trúc đề diagnostic seed: mỗi Part 2 mức, nhóm passage cho Part 3/4/6/7 */
function bank(): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];
  let order = 0;
  const single = (section: string, skill: string, sub: string, difficulty: string, n: number) => {
    for (let i = 0; i < n; i++) items.push({ question_id: `${section}-${sub}-${difficulty}-${i}`, section_code: section, skill, group_key: null, subskills: [sub], difficulty, order: order++ });
  };
  const group = (section: string, skill: string, key: string, diffs: string[], subs: string[]) => {
    diffs.forEach((d, i) => items.push({ question_id: `${key}-q${i}`, section_code: section, skill, group_key: key, subskills: [subs[i % subs.length]!], difficulty: d, order: order++ }));
  };
  single('part1', 'listening', 'photo', 'A2', 2);
  single('part1', 'listening', 'photo', 'B1', 2);
  for (const sub of ['wh', 'yes_no', 'choice', 'tag']) {
    single('part2', 'listening', sub, 'A2', 1);
    single('part2', 'listening', sub, 'B2', 1);
  }
  group('part3', 'listening', 'p3-e1', ['A2', 'B1', 'B1'], ['gist', 'detail']);
  group('part3', 'listening', 'p3-e2', ['A2', 'B1', 'B1'], ['gist', 'detail']);
  group('part3', 'listening', 'p3-h1', ['B1', 'B2', 'B1'], ['inference', 'detail']);
  group('part3', 'listening', 'p3-h2', ['A2', 'B2', 'B1'], ['intent', 'detail']);
  group('part4', 'listening', 'p4-e1', ['A2', 'B1', 'B1'], ['gist', 'detail']);
  group('part4', 'listening', 'p4-h1', ['B1', 'B2', 'B1'], ['inference', 'detail']);
  for (const sub of ['tense', 'word_form', 'preposition', 'pronoun']) {
    single('part5', 'reading', sub, 'A2', 1);
    single('part5', 'reading', sub, 'B1', 1);
    single('part5', 'reading', sub, 'B2', 1);
  }
  group('part6', 'reading', 'p6-e1', ['B1', 'B1', 'A2', 'B1'], ['tense', 'conjunction']);
  group('part6', 'reading', 'p6-h1', ['B1', 'B2', 'B1', 'B1'], ['tense', 'inference']);
  group('part7', 'reading', 'p7-e1', ['A2', 'B1'], ['paraphrase', 'detail']);
  group('part7', 'reading', 'p7-e2', ['A2', 'B1'], ['paraphrase', 'inference']);
  group('part7', 'reading', 'p7-h1', ['A2', 'B1', 'B2'], ['paraphrase', 'inference']);
  group('part7', 'reading', 'p7-h2', ['B1', 'B2', 'B1', 'B1'], ['detail', 'inference']);
  return items;
}

/** Chạy hết bài với một "người học" quyết định đúng/sai theo câu */
function runAll(answerFn: (id: string, state: DiagnosticState) => boolean) {
  const items = bank();
  const pool = buildDiagnosticPool(items);
  let { state, next } = diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, initDiagnosticState(pool, TOEIC_DIAGNOSTIC_BLUEPRINT));
  let guard = 0;
  while (next && guard++ < 200) ({ state, next } = diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, state, { question_id: next, correct: answerFn(next, state) }));
  return { state, items, pool };
}

describe('diagnostic v1 – luật thích ứng', () => {
  it('đúng 2 liên tiếp → tăng mức; sai 2 liên tiếp → giảm; đổi mức thì đếm lại', () => {
    let r = applyRunRule(1, { correct: 0, wrong: 0 }, true);
    expect(r).toEqual({ level: 1, run: { correct: 1, wrong: 0 } });
    r = applyRunRule(r.level, r.run, true);
    expect(r).toEqual({ level: 2, run: { correct: 0, wrong: 0 } });
    r = applyRunRule(2, { correct: 0, wrong: 1 }, false);
    expect(r).toEqual({ level: 1, run: { correct: 0, wrong: 0 } });
    // đúng-sai xen kẽ không đổi mức
    r = applyRunRule(1, { correct: 1, wrong: 0 }, false);
    expect(r).toEqual({ level: 1, run: { correct: 0, wrong: 1 } });
  });

  it('mức đơn vị: câu lẻ A2 = 1, B1+ = 2; nhóm có câu B2 = 2', () => {
    expect(unitLevel([{ difficulty: 'A2', group_key: null }])).toBe(1);
    expect(unitLevel([{ difficulty: 'B1', group_key: null }])).toBe(2);
    expect(unitLevel([{ difficulty: 'A2', group_key: 'g' }, { difficulty: 'B1', group_key: 'g' }])).toBe(1);
    expect(unitLevel([{ difficulty: 'B1', group_key: 'g' }, { difficulty: 'B2', group_key: 'g' }])).toBe(2);
  });

  it('người học giỏi: lên mức 2 sau 2 câu đúng, phần lớn câu sau ở mức 2; đủ hạn mức mọi Part; ~30 câu', () => {
    const { state } = runAll(() => true);
    expect(state.done).toBe(true);
    expect(state.served[0]!.level).toBe(1);
    expect(state.served[1]!.level).toBe(1);
    expect(state.served[2]!.level).toBe(2);
    const reading = state.served.filter((s) => s.skill === 'reading');
    expect(reading.filter((s) => s.level === 2).length).toBeGreaterThan(reading.length / 2);
    for (const b of TOEIC_DIAGNOSTIC_BLUEPRINT) expect(state.units[b.section_code]).toBe(b.units);
    expect(state.served.length).toBeGreaterThanOrEqual(25);
    expect(state.served.length).toBeLessThanOrEqual(36);
  });

  it('người học yếu: luôn ở mức 1 khi còn câu dễ', () => {
    const { state } = runAll(() => false);
    const part5 = state.served.filter((s) => s.section_code === 'part5');
    expect(part5.slice(0, 4).every((s) => s.level === 1)).toBe(true);
  });

  it('giữ nhóm passage: câu cùng group_key phục vụ liền nhau, không chen câu khác', () => {
    const { state } = runAll((id) => id.length % 2 === 0);
    const seq = state.served.map((s) => s.group_key);
    for (let i = 0; i < seq.length; i++) {
      const g = seq[i];
      if (!g) continue;
      const last = seq.lastIndexOf(g);
      for (let j = i; j <= last; j++) expect(seq[j]).toBe(g);
    }
  });

  it('trả lời sai câu → lỗi not_current; đã xong → already_done; không phục vụ trùng câu', () => {
    const pool = buildDiagnosticPool(bank());
    const { state, next } = diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, initDiagnosticState(pool, TOEIC_DIAGNOSTIC_BLUEPRINT));
    expect(() => diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, state, { question_id: 'nope', correct: true })).toThrow(DiagnosticRuleError);
    // gọi lại không có answer → trả lại đúng câu đang chờ (tải lại trang)
    expect(diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, state).next).toBe(next);
    const done = runAll(() => true).state;
    expect(new Set(done.served.map((s) => s.question_id)).size).toBe(done.served.length);
    expect(() => diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, done, { question_id: 'x', correct: true })).toThrow(/already/);
  });

  it('không đổi state đầu vào (thuần)', () => {
    const pool = buildDiagnosticPool(bank());
    const s0 = initDiagnosticState(pool, TOEIC_DIAGNOSTIC_BLUEPRINT);
    const copy = structuredClone(s0);
    diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, s0);
    expect(s0).toEqual(copy);
  });
});

describe('diagnostic v1 – ước tính điểm, mastery, mục tiêu', () => {
  it('điểm câu theo mức', () => {
    expect(diagnosticItemScore(2, true)).toBe(0.9);
    expect(diagnosticItemScore(1, true)).toBe(0.65);
    expect(diagnosticItemScore(2, false)).toBe(0.35);
    expect(diagnosticItemScore(1, false)).toBe(0.1);
  });

  it('giỏi > yếu; khoảng chứa điểm, ≥ ±35/kỹ năng, ±50 tổng; tổng = L + R', () => {
    const strong = estimateToeicDiagnostic(runAll(() => true).state.served);
    const weak = estimateToeicDiagnostic(runAll(() => false).state.served);
    expect(strong.total!.score).toBeGreaterThan(weak.total!.score);
    expect(strong.total!.score).toBe(strong.by_skill.listening!.score + strong.by_skill.reading!.score);
    for (const e of [strong, weak]) {
      for (const k of ['listening', 'reading']) {
        const s = e.by_skill[k]!;
        expect(s.low).toBeLessThanOrEqual(s.score);
        expect(s.high).toBeGreaterThanOrEqual(s.score);
        expect(Math.max(s.score - s.low, s.high - s.score)).toBeGreaterThanOrEqual(35);
      }
      expect(e.total!.high - e.total!.low).toBeGreaterThanOrEqual(50);
      expect(e.se).toBeGreaterThan(0);
    }
    expect(weak.total!.score).toBeLessThan(300);
    expect(strong.total!.score).toBeGreaterThan(700);
  });

  it('mastery 0–1 theo subskill, câu khó đúng cao hơn câu dễ đúng', () => {
    const m = masteryFromDiagnostic([
      { question_id: '1', section_code: 'part5', skill: 'reading', level: 2, group_key: null, subskills: ['tense'], correct: true },
      { question_id: '2', section_code: 'part5', skill: 'reading', level: 1, group_key: null, subskills: ['word_form'], correct: true },
      { question_id: '3', section_code: 'part6', skill: 'reading', level: 1, group_key: 'g', subskills: ['word_form'], correct: false },
      { question_id: '4', section_code: 'part5', skill: 'reading', level: 1, group_key: null, subskills: ['pronoun'], correct: null },
    ]);
    expect(m.map((x) => x.subskill)).toEqual(['tense', 'word_form']);
    expect(m[0]).toMatchObject({ mastery: 0.9, n_obs: 1, sections: ['part5'] });
    expect(m[1]).toMatchObject({ mastery: 0.375, n_obs: 2, sections: ['part5', 'part6'], confidence: 0.5 });
  });

  it('mục tiêu: càng nhiều giờ/tuần càng cao; mục tiêu quá cao → stretch + phút cần; không có ngày thi → 8 tuần', () => {
    const base = { current: 450, today: '2026-11-02', examDate: '2026-12-28' };
    const a = suggestToeicTarget({ ...base, weeklyMinutes: 180 });
    const b = suggestToeicTarget({ ...base, weeklyMinutes: 600 });
    expect(a.weeks_left).toBe(8);
    expect(b.suggested).toBeGreaterThan(a.suggested);
    expect(a.suggested % 5).toBe(0);
    const ok = suggestToeicTarget({ ...base, weeklyMinutes: 300, desired: 500 });
    expect(ok).toMatchObject({ feasible: true, reason: 'feasible', required_weekly_minutes: null });
    const hard = suggestToeicTarget({ ...base, weeklyMinutes: 120, desired: 650 });
    expect(hard.feasible).toBe(false);
    expect(hard.reason).toBe('stretch');
    expect(hard.required_weekly_minutes).toBeGreaterThan(120);
    expect(suggestToeicTarget({ ...base, weeklyMinutes: 120, desired: 990 }).reason).toBe('unreachable');
    expect(suggestToeicTarget({ current: 450, today: '2026-11-02', examDate: null, weeklyMinutes: 300 })).toMatchObject({ weeks_left: 8, reason: 'no_exam_date' });
    expect(suggestToeicTarget({ current: 980, today: '2026-11-02', examDate: '2027-11-02', weeklyMinutes: 2000 }).suggested).toBeLessThanOrEqual(990);
  });
});
