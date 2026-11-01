import { describe, expect, it } from 'vitest';
import { generateMiniTest, TOEIC_MINI_BLUEPRINT_60 } from '@allingo/schemas';
import { buildMiniBank, GENERATED_MINIS } from '../seed/demo/listening-01.seed.js';
import { LISTENING_FULL_01 } from '../seed/demo/toeic-listening-01.js';
import { READING_FULL_01 } from '../seed/demo/toeic-reading-01.js';

const items = [...LISTENING_FULL_01.questions, ...READING_FULL_01.questions].map((q) => ({
  key: q.key,
  section: q.section,
  group_key: q.group_key ?? null,
}));

describe('đề mini L&R tự sinh trong seed demo (S4)', () => {
  it('đủ 60 câu đúng blueprint, không thiếu câu, giữ trọn nhóm', () => {
    for (const m of GENERATED_MINIS) {
      const r = generateMiniTest(buildMiniBank(items), TOEIC_MINI_BLUEPRINT_60, m.seed);
      expect(r.shortfall).toEqual([]);
      expect(r.items).toHaveLength(60);
      expect(r.by_section).toEqual({ part1: 6, part2: 10, part3: 9, part4: 9, part5: 10, part6: 4, part7: 12 });
      const groups = new Map<string, number[]>();
      r.items.forEach((it, i) => it.group_key && groups.set(it.group_key, [...(groups.get(it.group_key) ?? []), i]));
      for (const [g, idx] of groups) {
        const full = items.filter((q) => q.group_key === g).length;
        expect(idx.length, g).toBe(full);
        expect(idx[idx.length - 1]! - idx[0]!, g).toBe(idx.length - 1);
      }
    }
  });

  it('cùng seed → cùng đề (không phụ thuộc thứ tự ngân hàng); seed khác → đề khác', () => {
    const bank = buildMiniBank(items);
    const a = generateMiniTest(bank, TOEIC_MINI_BLUEPRINT_60, GENERATED_MINIS[0].seed);
    const b = generateMiniTest([...bank].reverse(), TOEIC_MINI_BLUEPRINT_60, GENERATED_MINIS[0].seed);
    expect(b.items.map((i) => i.question_id)).toEqual(a.items.map((i) => i.question_id));
    const c = generateMiniTest(bank, TOEIC_MINI_BLUEPRINT_60, GENERATED_MINIS[1].seed);
    expect(c.items.map((i) => i.question_id)).not.toEqual(a.items.map((i) => i.question_id));
  });
});
