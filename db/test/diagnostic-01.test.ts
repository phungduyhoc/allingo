import { describe, expect, it } from 'vitest';
import { TOEIC_DIAGNOSTIC_BLUEPRINT, buildDiagnosticPool, diagnosticAdvance, initDiagnosticState, unitLevel, type DiagnosticItem } from '@allingo/scoring';
import { validateTestSetStructure } from '@allingo/schemas';
import { buildDiagnosticSelection } from '../seed/demo/diagnostic-01.seed.js';
import { LISTENING_FULL_01 } from '../seed/demo/toeic-listening-01.js';
import { READING_FULL_01 } from '../seed/demo/toeic-reading-01.js';

const bank = [...LISTENING_FULL_01.questions, ...READING_FULL_01.questions];
const byKey = new Map(bank.map((q) => [q.key, q]));

describe('bài chẩn đoán TOEIC 01 (S9) – chọn từ ngân hàng seed', () => {
  const items = buildDiagnosticSelection();

  it('≈ 60 câu phủ Part 1–7; mọi câu có trong ngân hàng Listening/Reading 01; không trùng; cấu trúc hợp lệ', () => {
    expect(items.length).toBeGreaterThanOrEqual(55);
    expect(items.length).toBeLessThanOrEqual(65);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const it of items) expect(byKey.has(it.key)).toBe(true);
    expect(new Set(items.map((i) => i.section))).toEqual(new Set(['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7']));
    const specs = [
      { code: 'part1', skill: 'listening', question_count: 6, sort_order: 1 },
      { code: 'part2', skill: 'listening', question_count: 25, sort_order: 2 },
      { code: 'part3', skill: 'listening', question_count: 39, sort_order: 3 },
      { code: 'part4', skill: 'listening', question_count: 30, sort_order: 4 },
      { code: 'part5', skill: 'reading', question_count: 30, sort_order: 5 },
      { code: 'part6', skill: 'reading', question_count: 16, sort_order: 6 },
      { code: 'part7', skill: 'reading', question_count: 54, sort_order: 7 },
    ];
    const r = validateTestSetStructure('diagnostic', specs, items.map((it, i) => ({ question_ref: it.key, section_code: it.section, sort_order: i + 1, group_key: it.group_key ?? null })));
    expect(r.issues).toEqual([]);
  });

  it('2 mức khó mỗi Part; nhóm passage trọn vẹn; Part lẻ phủ nhiều subskill', () => {
    const units = new Map<string, Array<{ difficulty: string; group_key: string | null }>>();
    for (const it of items) {
      const q = byKey.get(it.key)!;
      const k = it.group_key ? `${it.section}:${it.group_key}` : `${it.section}:${it.key}`;
      units.set(k, [...(units.get(k) ?? []), { difficulty: q.difficulty, group_key: it.group_key ?? null }]);
    }
    for (const section of ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7']) {
      const levels = new Set([...units.entries()].filter(([k]) => k.startsWith(`${section}:`)).map(([, v]) => unitLevel(v)));
      expect(levels, section).toEqual(new Set([1, 2]));
    }
    for (const g of new Set(items.map((i) => i.group_key).filter(Boolean))) {
      expect(items.filter((i) => i.group_key === g).length).toBe(bank.filter((q) => q.group_key === g).length);
    }
    const part5Subs = new Set(items.filter((i) => i.section === 'part5').map((i) => byKey.get(i.key)!.subskill));
    expect(part5Subs.size).toBeGreaterThanOrEqual(5);
  });

  it('đủ câu cho blueprint thích ứng ở cả người học giỏi và yếu (~ 30 câu)', () => {
    const diagItems: DiagnosticItem[] = items.map((it, i) => {
      const q = byKey.get(it.key)!;
      return { question_id: it.key, section_code: it.section, skill: ['part1', 'part2', 'part3', 'part4'].includes(it.section) ? 'listening' : 'reading', group_key: it.group_key ?? null, subskills: q.subskill ? [q.subskill] : [], difficulty: q.difficulty, order: i };
    });
    const pool = buildDiagnosticPool(diagItems);
    for (const correct of [true, false]) {
      let { state, next } = diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, initDiagnosticState(pool, TOEIC_DIAGNOSTIC_BLUEPRINT));
      while (next) ({ state, next } = diagnosticAdvance(pool, TOEIC_DIAGNOSTIC_BLUEPRINT, state, { question_id: next, correct }));
      for (const b of TOEIC_DIAGNOSTIC_BLUEPRINT) expect(state.units[b.section_code], b.section_code).toBe(b.units);
      expect(state.served.length).toBeGreaterThanOrEqual(26);
      expect(state.served.length).toBeLessThanOrEqual(36);
    }
  });

  it('xác định (seed chạy lại cho cùng đề)', () => {
    expect(buildDiagnosticSelection()).toEqual(items);
  });
});
