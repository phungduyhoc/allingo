import { describe, expect, it } from 'vitest';
import { PROGRAM_CODES, PROGRAM_REGISTRY, QUESTION_TYPE_CODES } from '@allingo/schemas';
import { CATALOG_SEED_DEFINITION } from '../seed/index.js';

/**
 * C1 (ADR-0038) – registry chương trình ở @allingo/schemas là bản sao tĩnh của seed `catalog.programs/skills/sections`: hai phía
 * không được lệch (thêm chương trình/phần thi = sửa cả hai).
 */
describe('PROGRAM_REGISTRY ↔ seed catalog', () => {
  const seed = CATALOG_SEED_DEFINITION;

  it('cùng tập chương trình, ngôn ngữ mục tiêu và loại thang', () => {
    expect(seed.programs.map((p) => p.code).sort()).toEqual([...PROGRAM_CODES].sort());
    for (const p of seed.programs) {
      const def = PROGRAM_REGISTRY[p.code];
      expect(p.languages).toContain(def.target_language);
      const kind = (p.scoreScale as { type: string }).type;
      expect(def.scale.kind === 'toeic_lr' ? kind === 'toeic' : def.scale.kind === 'band' ? kind === 'band' : kind !== 'toeic' && kind !== 'band').toBe(true);
    }
  });

  it.each(PROGRAM_CODES.map((c) => [c] as const))('%s: kỹ năng và phần thi của registry có trong seed (đúng kỹ năng)', (code) => {
    const def = PROGRAM_REGISTRY[code];
    const seedSkills = seed.skills.filter((s) => s.program === code).map((s) => s.code);
    expect([...def.skills].sort()).toEqual([...new Set(seedSkills)].sort());
    const seedSections = seed.sections.filter((s) => s.program === code);
    for (const s of def.sections) {
      const match = seedSections.filter((x) => x.code === s.code);
      expect(match.length, `${code}/${s.code}`).toBeGreaterThan(0);
      for (const m of match) expect(m.skill).toBe(s.skill);
    }
    // Mọi phần thi trong seed đều khai báo trong registry
    for (const s of seedSections) expect(def.sections.some((x) => x.code === s.code), `${code}/${s.code}`).toBe(true);
    for (const sp of def.spoken_sections) expect(def.sections.some((x) => x.code === sp)).toBe(true);
  });

  it('dạng câu của registry đều có trong seed question_types', () => {
    expect([...seed.questionTypes].sort()).toEqual([...QUESTION_TYPE_CODES].sort());
    for (const code of PROGRAM_CODES) for (const t of PROGRAM_REGISTRY[code].question_types) expect(seed.questionTypes).toContain(t);
  });
});
