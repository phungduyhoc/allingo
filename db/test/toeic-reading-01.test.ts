import { describe, expect, it } from 'vitest';
import {
  grade,
  questionContentSchema,
  validateTestSetStructure,
  type SectionSpec,
  type TestSetItemSpec,
} from '@allingo/schemas';
import {
  READING_DRILLS,
  READING_FULL_01,
  READING_SUBSKILLS,
  READING_TOPICS,
  mergeGroupPassages,
  type ReadingPassage,
  type ReadingQuestion,
} from '../seed/demo/toeic-reading-01.js';

/**
 * Kiểm tra dữ liệu đề TOEIC Reading 01 (không cần DB): cấu trúc 30/16/54, nội dung parse + chấm được,
 * chỗ trống Part 6, nhóm đoạn Part 7, phân bố đáp án, evidence trích đúng văn bản, bộ luyện theo Part.
 */

const TOEIC_SECTIONS: SectionSpec[] = [
  { code: 'part5', skill: 'reading', question_count: 30, sort_order: 5 },
  { code: 'part6', skill: 'reading', question_count: 16, sort_order: 6 },
  { code: 'part7', skill: 'reading', question_count: 54, sort_order: 7 },
];

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const { passages, questions } = READING_FULL_01;

const inSection = (s: ReadingQuestion['section']) => questions.filter((q) => q.section === s);
const passagesOfGroup = (g: string): ReadingPassage[] => passages.filter((p) => p.group_key === g);

function mcq(q: ReadingQuestion) {
  if (q.content.type !== 'mcq_single') throw new Error(`${q.key} không phải mcq_single`);
  return q.content;
}

function groupsOf(section: 'part6' | 'part7'): Map<string, ReadingQuestion[]> {
  const out = new Map<string, ReadingQuestion[]>();
  for (const q of inSection(section)) {
    if (!q.group_key) throw new Error(`${q.key} thiếu group_key`);
    out.set(q.group_key, [...(out.get(q.group_key) ?? []), q]);
  }
  return out;
}

const toItems = (qs: readonly ReadingQuestion[]): TestSetItemSpec[] =>
  qs.map((q) => ({
    question_ref: q.key,
    section_code: q.section,
    sort_order: q.number,
    group_key: q.group_key ?? null,
  }));

const isInsertion = (q: ReadingQuestion) =>
  mcq(q).stem.startsWith('In which of the positions marked [1], [2], [3], and [4]');
const MEANING_RE =
  /^At (\d{1,2}:\d{2} [AP]\.M\.), what does (?:Mr\.|Ms\.) (\S+) most likely mean when (?:she|he) writes, "(.+)"\?$/;
const WORD_RE = /the word "([^"]+)" in paragraph (\d+), line 1, is closest in meaning to$/i;

describe('Đề TOEIC Reading 01 – cấu trúc tổng', () => {
  it('đủ 100 câu: part5 30 / part6 16 / part7 54; số câu 101–200 liên tục; key duy nhất', () => {
    expect(READING_FULL_01.code).toBe('toeic-reading-full-01');
    expect(inSection('part5')).toHaveLength(30);
    expect(inSection('part6')).toHaveLength(16);
    expect(inSection('part7')).toHaveLength(54);
    expect(questions).toHaveLength(100);
    expect(questions.map((q) => q.number)).toEqual(Array.from({ length: 100 }, (_, i) => 101 + i));
    expect(new Set(questions.map((q) => q.key)).size).toBe(100);
    expect(new Set(passages.map((p) => p.key)).size).toBe(passages.length);
    // Thứ tự Part theo đề thật: 101–130 Part 5, 131–146 Part 6, 147–200 Part 7
    for (const q of questions) {
      const expected = q.number <= 130 ? 'part5' : q.number <= 146 ? 'part6' : 'part7';
      expect(q.section, q.key).toBe(expected);
    }
  });

  it('validateTestSetStructure("full") → ok; câu cùng nhóm liền nhau', () => {
    const report = validateTestSetStructure('full', TOEIC_SECTIONS, toItems(questions));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.by_section).toEqual({ part5: 30, part6: 16, part7: 54 });
    for (const section of ['part6', 'part7'] as const) {
      for (const [g, qs] of groupsOf(section)) {
        const nums = qs.map((q) => q.number);
        const first = nums[0] ?? 0;
        expect(nums, g).toEqual(nums.map((_, i) => first + i));
      }
    }
  });

  it('topic/subskill/độ khó thuộc danh mục cho phép', () => {
    const topics = new Set<string>(READING_TOPICS);
    const subskills = new Set<string>(READING_SUBSKILLS);
    for (const q of questions) {
      expect(topics.has(q.topic ?? ''), `${q.key} topic`).toBe(true);
      expect(subskills.has(q.subskill ?? ''), `${q.key} subskill`).toBe(true);
      expect(['A2', 'B1', 'B2']).toContain(q.difficulty);
    }
    for (const p of passages) {
      expect(topics.has(p.topic), `${p.key} topic`).toBe(true);
      expect(p.kind).toBe('reading_passage');
    }
  });
});

describe('Đề TOEIC Reading 01 – nội dung câu hỏi', () => {
  it('mọi content parse bằng questionContentSchema; chọn đúng → is_correct true, chọn sai → false', () => {
    for (const q of questions) {
      const parsed = questionContentSchema.parse(q.content);
      expect(parsed.type, q.key).toBe('mcq_single');
      const c = mcq(q);
      expect(
        c.options.map((o) => o.key),
        q.key,
      ).toEqual([...LETTERS]);
      expect(c.tags).toEqual([]);
      expect(c.explanation?.vi, `${q.key} explanation.vi`).toBeTruthy();
      expect(c.explanation?.en, `${q.key} explanation.en`).toBeTruthy();
      for (const o of c.options) {
        expect(o.text.length, `${q.key} option ${o.key}`).toBeGreaterThan(0);
        expect(o.text.length, `${q.key} option ${o.key}`).toBeLessThanOrEqual(1000);
      }
      expect(new Set(c.options.map((o) => o.text)).size, `${q.key} lựa chọn trùng nhau`).toBe(4);
      const correct = c.answer_key.correct;
      expect(grade(q.content, { type: 'mcq_single', selected: correct }).is_correct, q.key).toBe(true);
      for (const wrong of LETTERS.filter((l) => l !== correct)) {
        expect(grade(q.content, { type: 'mcq_single', selected: wrong }).is_correct, `${q.key} ${wrong}`).toBe(false);
      }
    }
  });

  it('đáp án cân bằng: mỗi chữ cái 22–28 lần, không quá 3 câu liên tiếp cùng chữ cái', () => {
    const seq = questions.map((q) => mcq(q).answer_key.correct);
    const counts = Object.fromEntries(LETTERS.map((l) => [l, seq.filter((s) => s === l).length]));
    for (const l of LETTERS) {
      expect(counts[l], `đáp án ${l}`).toBeGreaterThanOrEqual(22);
      expect(counts[l], `đáp án ${l}`).toBeLessThanOrEqual(28);
    }
    let run = 1;
    for (let i = 1; i < seq.length; i++) {
      run = seq[i] === seq[i - 1] ? run + 1 : 1;
      expect(run, `chuỗi lặp tại câu ${101 + i}`).toBeLessThanOrEqual(3);
    }
  });

  it('passage_key tồn tại, trỏ đoạn đầu của nhóm; evidence là chuỗi con của một đoạn trong nhóm', () => {
    const passageKeys = new Set(passages.map((p) => p.key));
    for (const q of questions) {
      if (q.section === 'part5') {
        expect(q.passage_key, q.key).toBeUndefined();
        expect(q.group_key, q.key).toBeUndefined();
        continue;
      }
      expect(q.passage_key && passageKeys.has(q.passage_key), `${q.key} passage_key`).toBe(true);
      const group = passagesOfGroup(q.group_key ?? '');
      expect(group.length, `${q.key} group`).toBeGreaterThan(0);
      expect(group[0]?.key, `${q.key} trỏ đoạn đầu nhóm`).toBe(q.passage_key);
      expect(
        group.every((p) => p.section === q.section),
        q.key,
      ).toBe(true);
      const evidence = mcq(q).evidence;
      expect(evidence, `${q.key} thiếu evidence`).toBeTruthy();
      expect(
        group.some((p) => p.body.includes(evidence ?? '')),
        `${q.key} evidence không có trong đoạn văn`,
      ).toBe(true);
    }
  });
});

describe('Đề TOEIC Reading 01 – Part 5', () => {
  const p5 = inSection('part5');

  it('có chỗ trống ______; mỗi subskill ngữ pháp/từ vựng ≥ 3 câu', () => {
    for (const q of p5) expect(mcq(q).stem, q.key).toContain('______');
    const required = [
      'word_form',
      'verb_tense',
      'preposition',
      'conjunction',
      'pronoun',
      'vocabulary_context',
      'relative_clause',
    ];
    for (const s of required) expect(p5.filter((q) => q.subskill === s).length, s).toBeGreaterThanOrEqual(3);
    expect(p5.every((q) => required.includes(q.subskill ?? ''))).toBe(true);
  });

  it('độ khó khoảng 30/50/20% (A2/B1/B2)', () => {
    const n = (d: string) => p5.filter((q) => q.difficulty === d).length;
    expect(n('A2')).toBeGreaterThanOrEqual(7);
    expect(n('A2')).toBeLessThanOrEqual(11);
    expect(n('B1')).toBeGreaterThanOrEqual(13);
    expect(n('B1')).toBeLessThanOrEqual(17);
    expect(n('B2')).toBeGreaterThanOrEqual(4);
    expect(n('B2')).toBeLessThanOrEqual(8);
  });
});

describe('Đề TOEIC Reading 01 – Part 6', () => {
  const groups = groupsOf('part6');

  it('4 đoạn × 4 câu; mỗi đoạn có đúng các chỗ trống [n] của 4 câu thuộc nó', () => {
    expect(groups.size).toBe(4);
    for (const [g, qs] of groups) {
      expect(qs, g).toHaveLength(4);
      const ps = passagesOfGroup(g);
      expect(ps, g).toHaveLength(1);
      const body = ps[0]?.body ?? '';
      const markers = [...body.matchAll(/\[(\d{3})\]/g)].map((m) => Number(m[1]));
      expect(markers, g).toEqual(qs.map((q) => q.number));
    }
  });

  it('mỗi đoạn có đúng 1 câu chèn câu hoàn chỉnh; câu đúng chưa có sẵn trong đoạn', () => {
    for (const [g, qs] of groups) {
      const inserts = qs.filter((q) => mcq(q).stem.includes('Choose the sentence'));
      expect(inserts, g).toHaveLength(1);
      const c = mcq(inserts[0] as ReadingQuestion);
      for (const o of c.options) {
        expect(o.text.trim().split(/\s+/).length, `${g} ${o.key}`).toBeGreaterThanOrEqual(5);
        expect(o.text, `${g} ${o.key}`).toMatch(/[.!?]$/);
      }
      const answer = c.options.find((o) => o.key === c.answer_key.correct)?.text ?? '';
      expect(passagesOfGroup(g)[0]?.body.includes(answer), g).toBe(false);
      // Các câu còn lại là từ/cụm từ (không phải câu chèn)
      for (const q of qs.filter((x) => x !== inserts[0])) expect(mcq(q).stem, q.key).toContain('word or phrase');
    }
  });
});

describe('Đề TOEIC Reading 01 – Part 7', () => {
  const groups = groupsOf('part7');
  const entries = [...groups.entries()];
  const singles = entries.filter(([g]) => passagesOfGroup(g).length === 1);
  const doubles = entries.filter(([g]) => passagesOfGroup(g).length === 2);
  const triples = entries.filter(([g]) => passagesOfGroup(g).length === 3);

  it('10 đoạn đơn (29 câu, 2–4 câu/đoạn) + 2 bộ đôi + 3 bộ ba (25 câu, 5 câu/bộ)', () => {
    expect(singles).toHaveLength(10);
    expect(singles.flatMap(([, qs]) => qs)).toHaveLength(29);
    for (const [g, qs] of singles) {
      expect(qs.length, g).toBeGreaterThanOrEqual(2);
      expect(qs.length, g).toBeLessThanOrEqual(4);
      expect(passagesOfGroup(g)[0]?.key, g).toBe(g);
    }
    expect(doubles).toHaveLength(2);
    expect(triples).toHaveLength(3);
    for (const [g, qs] of [...doubles, ...triples]) expect(qs, g).toHaveLength(5);
    expect([...doubles, ...triples].flatMap(([, qs]) => qs)).toHaveLength(25);
    // Đoạn đơn đứng trước (147–175), đa đoạn sau (176–200)
    expect(Math.max(...singles.flatMap(([, qs]) => qs.map((q) => q.number)))).toBe(175);
    expect(Math.min(...[...doubles, ...triples].flatMap(([, qs]) => qs.map((q) => q.number)))).toBe(176);
  });

  it('chỉ dùng subskill đọc hiểu', () => {
    const allowed = ['detail', 'inference', 'paraphrase_recognition', 'vocabulary_context'];
    for (const q of inSection('part7')) expect(allowed, q.key).toContain(q.subskill);
  });

  it('≥ 2 câu chèn câu [1]–[4] ở đoạn đơn: đoạn có đủ 4 vị trí, câu cần chèn chưa có trong đoạn', () => {
    const inserts = singles.flatMap(([, qs]) => qs).filter(isInsertion);
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const q of inserts) {
      const c = mcq(q);
      expect(
        c.options.map((o) => o.text),
        q.key,
      ).toEqual(['[1]', '[2]', '[3]', '[4]']);
      const body = passagesOfGroup(q.group_key ?? '')[0]?.body ?? '';
      for (const m of ['[1]', '[2]', '[3]', '[4]']) expect(body, `${q.key} ${m}`).toContain(m);
      const sentence = /"(.+)"$/.exec(c.stem)?.[1] ?? '';
      expect(sentence.length, q.key).toBeGreaterThan(0);
      expect(body.includes(sentence), q.key).toBe(false);
    }
  });

  it('≥ 2 câu "At …, what does X most likely mean…": mốc giờ, người viết và câu trích có trong đoạn chat', () => {
    const meaning = singles.flatMap(([, qs]) => qs).filter((q) => MEANING_RE.test(mcq(q).stem));
    expect(meaning.length).toBeGreaterThanOrEqual(2);
    for (const q of meaning) {
      const [, time, surname, quote] = MEANING_RE.exec(mcq(q).stem) ?? [];
      const body = passagesOfGroup(q.group_key ?? '')[0]?.body ?? '';
      expect(body, q.key).toContain(time ?? '\u0000');
      expect(body, q.key).toContain(surname ?? '\u0000');
      expect(body, q.key).toContain(quote ?? '\u0000');
      expect(q.subskill, q.key).toBe('inference');
    }
  });

  it('câu từ vựng "closest in meaning": từ được hỏi nằm ở dòng đầu của đúng đoạn văn', () => {
    const vocab = inSection('part7').filter((q) => q.subskill === 'vocabulary_context');
    expect(vocab.length).toBeGreaterThanOrEqual(3);
    for (const q of vocab) {
      const [, word, para] = WORD_RE.exec(mcq(q).stem) ?? [];
      expect(word, q.key).toBeTruthy();
      // Đoạn văn = khối một dòng, dài ≥ 80 ký tự, cách nhau bởi dòng trống – bỏ header email/tiêu đề (nhiều dòng), lời chào, chữ ký
      const found = passagesOfGroup(q.group_key ?? '').some((p) => {
        const paragraphs = p.body.split('\n\n').filter((b) => !b.includes('\n') && b.length >= 80);
        const target = paragraphs[Number(para) - 1] ?? '';
        const idx = target.search(new RegExp(`\\b${word ?? '\u0000'}\\b`));
        return idx >= 0 && idx <= 35;
      });
      expect(found, `${q.key} "${word}" không ở dòng 1 đoạn ${para}`).toBe(true);
    }
  });

  it('mỗi bộ đa đoạn lấy evidence từ ≥ 2 văn bản khác nhau (có câu kết hợp thông tin)', () => {
    for (const [g, qs] of [...doubles, ...triples]) {
      const ps = passagesOfGroup(g);
      const used = new Set(
        qs.map((q) => ps.find((p) => p.body.includes(mcq(q).evidence ?? '\u0000'))?.key).filter(Boolean),
      );
      expect(used.size, g).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Đề TOEIC Reading 01 – bộ luyện & gộp đoạn', () => {
  const byKey = new Map(questions.map((q) => [q.key, q]));

  it('3 bộ luyện tham chiếu key tồn tại, đúng section, đúng số câu và qua validateTestSetStructure("part_drill")', () => {
    expect(READING_DRILLS.map((d) => d.section)).toEqual(['part5', 'part6', 'part7']);
    const expectedCount = { part5: 15, part6: 8, part7: 11 };
    for (const d of READING_DRILLS) {
      expect(d.question_keys, d.code).toHaveLength(expectedCount[d.section]);
      expect(new Set(d.question_keys).size, d.code).toBe(d.question_keys.length);
      const qs = d.question_keys.map((k) => byKey.get(k));
      expect(
        qs.every((q) => q?.section === d.section),
        d.code,
      ).toBe(true);
      const report = validateTestSetStructure('part_drill', TOEIC_SECTIONS, toItems(qs.filter((q) => q !== undefined)));
      expect(report.issues, d.code).toEqual([]);
    }
    const [drill5, drill6, drill7] = READING_DRILLS;
    expect(drill5?.question_keys).toEqual(
      inSection('part5')
        .slice(0, 15)
        .map((q) => q.key),
    );
    expect(new Set(drill6?.question_keys.map((k) => byKey.get(k)?.group_key)).size).toBe(2);
    // Part 7: 3 đoạn đơn đầu (147–152) + bộ đôi đầu (176–180)
    expect(drill7?.question_keys.map((k) => byKey.get(k)?.number)).toEqual([
      147, 148, 149, 150, 151, 152, 176, 177, 178, 179, 180,
    ]);
  });

  it('mergeGroupPassages: một bản ghi mỗi nhóm, chứa đủ body các đoạn và evidence của mọi câu', () => {
    const merged = mergeGroupPassages();
    const groupKeys = new Set(passages.map((p) => p.group_key));
    expect(merged).toHaveLength(groupKeys.size);
    expect(merged).toHaveLength(4 + 10 + 5);
    const byGroup = new Map(merged.map((m) => [m.group_key, m]));
    for (const p of passages) expect(byGroup.get(p.group_key)?.body, p.key).toContain(p.body);
    for (const q of questions.filter((x) => x.section !== 'part5')) {
      expect(byGroup.get(q.group_key ?? '')?.body, q.key).toContain(mcq(q).evidence);
    }
    const single = byGroup.get('r01-p7-s01');
    expect(single?.body).toBe(passagesOfGroup('r01-p7-s01')[0]?.body);
    expect(byGroup.get('r01-p7-m03')?.passage_keys).toEqual(['r01-p7-m03-a', 'r01-p7-m03-b', 'r01-p7-m03-c']);
  });

  it('B5/S24: nhóm đa đoạn Part 7 có parts đúng thứ tự (tiêu đề + body từng văn bản); đoạn đơn không có part', () => {
    const merged = mergeGroupPassages();
    const multi = merged.filter((m) => m.passage_keys.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    for (const m of merged) {
      const src = passagesOfGroup(m.group_key);
      if (src.length === 1) {
        expect(m.parts, m.group_key).toEqual([]);
        continue;
      }
      expect(m.parts.map((p) => p.sort_order)).toEqual(src.map((_, i) => i + 1));
      expect(m.parts.map((p) => p.title)).toEqual(src.map((p) => p.title));
      expect(m.parts.map((p) => p.body)).toEqual(src.map((p) => p.body));
      // Bản gộp (dự phòng) vẫn chứa từng văn bản kèm nhãn [Tiêu đề]
      for (const p of m.parts) expect(m.body).toContain(`[${p.title}]\n${p.body}`);
    }
    expect(byKeyParts(merged, 'r01-p7-m03')).toHaveLength(3);
  });
});

function byKeyParts(merged: ReturnType<typeof mergeGroupPassages>, groupKey: string) {
  return merged.find((m) => m.group_key === groupKey)?.parts ?? [];
}
