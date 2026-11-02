import { describe, expect, it } from 'vitest';
import { loadDictionaryModule, toVocabRow } from '../seed/dictionary.js';
import { TOEIC600_TOPICS, TOEIC600_TOTAL, selectToeic600, stableUuid, toeic600ListId, type Toeic600Candidate } from '../seed/core/vocab-toeic600.js';

/**
 * Sprint 10 – chọn "TOEIC 600 từ theo chủ đề" từ từ điển tự biên soạn: xác định, đúng 600 từ, mỗi từ một chủ đề, đúng hạn mức
 * từng bộ, ưu tiên B1, chủ đề khan hiếm chọn trước, thiếu dồn về business; id bộ ổn định.
 */
describe('seed TOEIC 600', () => {
  it('hạn mức 10 chủ đề cộng lại = 600; id bộ xác định (uuid hợp lệ)', () => {
    expect(TOEIC600_TOPICS.reduce((s, t) => s + t.quota, 0)).toBe(TOEIC600_TOTAL);
    expect(toeic600ListId('office')).toBe(toeic600ListId('office'));
    expect(toeic600ListId('office')).not.toBe(toeic600ListId('all'));
    expect(stableUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('dữ liệu từ điển thật: 600 từ duy nhất, mỗi bộ đúng hạn mức, từ thuộc chủ đề của bộ, sắp A2→B1→B2; chạy lại cùng kết quả', async () => {
    const mod = await loadDictionaryModule();
    if (!mod) return; // tệp dữ liệu chưa có ở môi trường này
    const cands: Toeic600Candidate[] = mod.DICTIONARY_TOEIC_CORE.map((e, i) => {
      const r = toVocabRow(e);
      return { id: `id-${i}-${r.headword}`, headword: r.headword, pos: r.pos ?? null, level: r.level ?? null, topics: r.topics ?? [] };
    });
    const sel = selectToeic600(cands);
    const all = [...sel.values()].flat();
    expect(all).toHaveLength(600);
    expect(new Set(all.map((c) => c.headword.toLowerCase())).size).toBe(600);
    for (const t of TOEIC600_TOPICS) {
      const list = sel.get(t.code)!;
      expect(list).toHaveLength(t.quota);
      expect(list.every((c) => c.topics.includes(t.code))).toBe(true);
      const levels = list.map((c) => ({ A2: 0, B1: 1, B2: 2, C1: 3 })[c.level as 'A2']);
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    }
    // ưu tiên B1 (mục tiêu TOEIC 600)
    expect(all.filter((c) => c.level === 'B1').length).toBeGreaterThan(all.filter((c) => c.level === 'C1').length);
    const again = selectToeic600([...cands].reverse());
    expect([...again.values()].flat().map((c) => c.id)).toEqual(all.map((c) => c.id));
  });

  it('chủ đề thiếu ứng viên → phần thiếu dồn về business; bỏ mục không có level/topic', () => {
    const mk = (n: number, topic: string, level = 'B1'): Toeic600Candidate[] => Array.from({ length: n }, (_, i) => ({ id: `${topic}-${i}`, headword: `${topic}word${i}`, pos: 'n', level, topics: [topic] }));
    const cands = [...mk(5, 'health'), ...mk(400, 'business'), ...mk(3, 'office', 'X9'), { id: 'z', headword: 'zz', pos: null, level: 'B1', topics: [] }];
    const topics = [
      { code: 'health', vi: 'h', en: 'h', quota: 10 },
      { code: 'business', vi: 'b', en: 'b', quota: 20 },
      { code: 'office', vi: 'o', en: 'o', quota: 5 },
    ];
    const sel = selectToeic600(cands, topics);
    expect(sel.get('health')).toHaveLength(5);
    expect(sel.get('office')).toHaveLength(0);
    expect(sel.get('business')).toHaveLength(20 + 5 + 5);
  });
});
