import { describe, expect, it } from 'vitest';
import {
  grade,
  questionContentSchema,
  validateTestSetStructure,
  type SectionSpec,
  type TestSetItemSpec,
} from '@allingo/schemas';
import {
  LISTENING_DRILLS,
  LISTENING_FULL_01,
  LISTENING_SUBSKILLS,
  LISTENING_SUBSKILLS_IN_CORE,
  LISTENING_SUBSKILLS_TO_ADD,
  LISTENING_TOPICS,
  PART2_FORMS,
  scriptText,
  scriptWordCount,
  type ListeningGroup,
  type ListeningQuestion,
  type ListeningScript,
} from '../seed/demo/toeic-listening-01.js';

/**
 * Kiểm tra dữ liệu đề TOEIC Listening 01 (không cần DB): cấu trúc 6/25/39/30, nội dung parse + chấm được, script theo
 * định dạng đề thật, evidence trích đúng transcript, ảnh SVG Part 1, nhóm Part 3/4, phân bố đáp án/độ khó, bộ luyện.
 */

const TOEIC_SECTIONS: SectionSpec[] = [
  { code: 'part1', skill: 'listening', question_count: 6, sort_order: 1 },
  { code: 'part2', skill: 'listening', question_count: 25, sort_order: 2 },
  { code: 'part3', skill: 'listening', question_count: 39, sort_order: 3 },
  { code: 'part4', skill: 'listening', question_count: 30, sort_order: 4 },
  { code: 'part5', skill: 'reading', question_count: 30, sort_order: 5 },
  { code: 'part6', skill: 'reading', question_count: 16, sort_order: 6 },
  { code: 'part7', skill: 'reading', question_count: 54, sort_order: 7 },
];

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const { groups, questions } = LISTENING_FULL_01;

const inSection = (s: ListeningQuestion['section']) => questions.filter((q) => q.section === s);
const groupByKey = new Map(groups.map((g) => [g.key, g]));

function mcq(q: ListeningQuestion) {
  if (q.content.type !== 'mcq_single') throw new Error(`${q.key} không phải mcq_single`);
  return q.content;
}

/** Script dùng để đối chiếu evidence: Part 1/2 = script của câu; Part 3/4 = script của nhóm */
function sourceScript(q: ListeningQuestion): ListeningScript {
  if (q.group_key) {
    const g = groupByKey.get(q.group_key);
    if (!g) throw new Error(`${q.key} trỏ nhóm không tồn tại ${q.group_key}`);
    return g.script;
  }
  if (!q.script) throw new Error(`${q.key} thiếu script`);
  return q.script;
}

function questionsOfGroup(g: ListeningGroup): ListeningQuestion[] {
  return questions.filter((q) => q.group_key === g.key);
}

const toItems = (qs: readonly ListeningQuestion[]): TestSetItemSpec[] =>
  qs.map((q) => ({
    question_ref: q.key,
    section_code: q.section,
    sort_order: q.number,
    group_key: q.group_key ?? null,
  }));

const MEANING_RE = /^What does the (man|woman|speaker) mean when (he|she) says, "(.+)"\?$/;
const isGraphicQuestion = (q: ListeningQuestion) => mcq(q).stem.startsWith('Look at the graphic.');
const speakers = (script: ListeningScript) =>
  new Set(script.segments.filter((s) => s.speaker !== 'N').map((s) => s.speaker));

describe('Đề TOEIC Listening 01 – cấu trúc tổng', () => {
  it('đủ 100 câu: part1 6 / part2 25 / part3 39 / part4 30; số câu 1–100 liên tục; key duy nhất', () => {
    expect(LISTENING_FULL_01.code).toBe('toeic-listening-full-01');
    expect(inSection('part1')).toHaveLength(6);
    expect(inSection('part2')).toHaveLength(25);
    expect(inSection('part3')).toHaveLength(39);
    expect(inSection('part4')).toHaveLength(30);
    expect(questions).toHaveLength(100);
    expect(questions.map((q) => q.number)).toEqual(Array.from({ length: 100 }, (_, i) => 1 + i));
    expect(new Set(questions.map((q) => q.key)).size).toBe(100);
    for (const q of questions) {
      expect(q.key).toBe(`l01-q${q.number}`);
      const expected = q.number <= 6 ? 'part1' : q.number <= 31 ? 'part2' : q.number <= 70 ? 'part3' : 'part4';
      expect(q.section, q.key).toBe(expected);
    }
  });

  it('validateTestSetStructure("full") → ok với section TOEIC (chỉ kỹ năng listening có mặt)', () => {
    const report = validateTestSetStructure('full', TOEIC_SECTIONS, toItems(questions));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.by_section).toEqual({ part1: 6, part2: 25, part3: 39, part4: 30 });
  });

  it('topic/subskill/độ khó thuộc danh mục; subskill khớp Part', () => {
    const topics = new Set<string>(LISTENING_TOPICS);
    const subskills = new Set<string>(LISTENING_SUBSKILLS);
    for (const q of questions) {
      expect(topics.has(q.topic), `${q.key} topic`).toBe(true);
      expect(subskills.has(q.subskill), `${q.key} subskill`).toBe(true);
      expect(['A2', 'B1', 'B2']).toContain(q.difficulty);
    }
    for (const g of groups) expect(topics.has(g.topic), `${g.key} topic`).toBe(true);
    const allowed: Record<ListeningQuestion['section'], string[]> = {
      part1: ['photo_description'],
      part2: [
        'wh_question',
        'yes_no_question',
        'tag_question',
        'choice_question',
        'request_suggestion',
        'statement_response',
        'indirect_response',
        'similar_sound',
      ],
      part3: [
        'listening_gist',
        'listening_detail',
        'listening_inference',
        'next_action',
        'speaker_intent',
        'graphic_question',
      ],
      part4: [
        'listening_gist',
        'listening_detail',
        'listening_inference',
        'next_action',
        'speaker_intent',
        'graphic_question',
      ],
    };
    for (const q of questions) expect(allowed[q.section], q.key).toContain(q.subskill);
  });

  it('danh mục subskill: IN_CORE + TO_ADD = LISTENING_SUBSKILLS, không trùng', () => {
    const toAdd = Object.keys(LISTENING_SUBSKILLS_TO_ADD);
    expect([...LISTENING_SUBSKILLS_IN_CORE, ...toAdd].sort()).toEqual([...LISTENING_SUBSKILLS].sort());
    expect(new Set(LISTENING_SUBSKILLS).size).toBe(LISTENING_SUBSKILLS.length);
    for (const [code, name] of Object.entries(LISTENING_SUBSKILLS_TO_ADD)) {
      expect(name.vi, code).toBeTruthy();
      expect(name.en, code).toBeTruthy();
    }
    // Mọi subskill khai báo đều được dùng ít nhất một lần
    const used = new Set(questions.map((q) => q.subskill));
    for (const s of LISTENING_SUBSKILLS) expect(used.has(s), s).toBe(true);
  });

  it('độ khó ~ 30/50/20% (A2/B1/B2)', () => {
    const n = (d: string) => questions.filter((q) => q.difficulty === d).length;
    expect(n('A2')).toBeGreaterThanOrEqual(26);
    expect(n('A2')).toBeLessThanOrEqual(34);
    expect(n('B1')).toBeGreaterThanOrEqual(45);
    expect(n('B1')).toBeLessThanOrEqual(55);
    expect(n('B2')).toBeGreaterThanOrEqual(16);
    expect(n('B2')).toBeLessThanOrEqual(24);
  });
});

describe('Đề TOEIC Listening 01 – nội dung câu hỏi', () => {
  it('mọi content parse bằng questionContentSchema; chọn đúng → is_correct true, chọn sai → false', () => {
    for (const q of questions) {
      const parsed = questionContentSchema.parse(q.content);
      expect(parsed.type, q.key).toBe('mcq_single');
      const c = mcq(q);
      const letters = q.section === 'part2' ? LETTERS.slice(0, 3) : [...LETTERS];
      expect(
        c.options.map((o) => o.key),
        q.key,
      ).toEqual(letters);
      expect(c.explanation?.vi, `${q.key} explanation.vi`).toBeTruthy();
      expect(c.explanation?.en, `${q.key} explanation.en`).toBeTruthy();
      const correct = c.answer_key.correct;
      expect(letters, q.key).toContain(correct);
      expect(grade(q.content, { type: 'mcq_single', selected: correct }).is_correct, q.key).toBe(true);
      for (const wrong of letters.filter((l) => l !== correct)) {
        expect(grade(q.content, { type: 'mcq_single', selected: wrong }).is_correct, `${q.key} ${wrong}`).toBe(false);
      }
    }
  });

  it('Part 1–2: stem và text lựa chọn rỗng; Part 3–4: stem + 4 lựa chọn có text, không trùng', () => {
    for (const q of questions) {
      const c = mcq(q);
      if (q.section === 'part1' || q.section === 'part2') {
        expect(c.stem, q.key).toBe('');
        for (const o of c.options) expect(o.text, `${q.key} ${o.key}`).toBe('');
        continue;
      }
      expect(c.stem.trim().length, q.key).toBeGreaterThan(0);
      expect(c.stem, q.key).toMatch(/\?/);
      for (const o of c.options) {
        expect(o.text.length, `${q.key} ${o.key}`).toBeGreaterThan(0);
        expect(o.text.length, `${q.key} ${o.key}`).toBeLessThanOrEqual(200);
      }
      expect(new Set(c.options.map((o) => o.text)).size, `${q.key} lựa chọn trùng nhau`).toBe(4);
    }
  });

  it('media: listen_policy once; pause 5000 ms (Part 1–2) / 8000 ms (Part 3–4)', () => {
    for (const q of questions) {
      const m = mcq(q).media;
      expect(m?.listen_policy, q.key).toBe('once');
      expect(m?.pause_ms, q.key).toBe(q.section === 'part1' || q.section === 'part2' ? 5000 : 8000);
    }
  });

  it('evidence là chuỗi con NGUYÊN VĂN của scriptText (script câu với Part 1/2, script nhóm với Part 3/4)', () => {
    for (const q of questions) {
      const evidence = mcq(q).evidence ?? '';
      expect(evidence.length, `${q.key} thiếu evidence`).toBeGreaterThan(0);
      expect(scriptText(sourceScript(q)), `${q.key} evidence không có trong transcript`).toContain(evidence);
      // Không trích lời người dẫn
      expect(scriptText(sourceScript(q), { narrator: false }), q.key).toContain(evidence);
    }
  });

  it('Part 1–2: evidence chính là câu đúng được đọc sau nhãn (A)/(B)/(C)/(D)', () => {
    for (const q of [...inSection('part1'), ...inSection('part2')]) {
      const c = mcq(q);
      const line = q.script?.segments.find((s) => s.text.startsWith(`(${c.answer_key.correct}) `));
      expect(line?.text, q.key).toBe(`(${c.answer_key.correct}) ${c.evidence ?? ''}`);
    }
  });

  it('đáp án cân bằng theo Part và không chữ cái nào lặp quá 2 câu liên tiếp (1–100)', () => {
    const count = (s: ListeningQuestion['section'], l: string) =>
      inSection(s).filter((q) => mcq(q).answer_key.correct === l).length;
    for (const l of LETTERS) {
      expect(count('part1', l), `part1 ${l}`).toBeGreaterThanOrEqual(1);
      expect(count('part1', l), `part1 ${l}`).toBeLessThanOrEqual(2);
      expect(count('part3', l), `part3 ${l}`).toBeGreaterThanOrEqual(8);
      expect(count('part3', l), `part3 ${l}`).toBeLessThanOrEqual(12);
      expect(count('part4', l), `part4 ${l}`).toBeGreaterThanOrEqual(6);
      expect(count('part4', l), `part4 ${l}`).toBeLessThanOrEqual(9);
    }
    for (const l of LETTERS.slice(0, 3)) {
      expect(count('part2', l), `part2 ${l}`).toBeGreaterThanOrEqual(7);
      expect(count('part2', l), `part2 ${l}`).toBeLessThanOrEqual(10);
    }
    const seq = questions.map((q) => mcq(q).answer_key.correct);
    let run = 1;
    for (let i = 1; i < seq.length; i++) {
      run = seq[i] === seq[i - 1] ? run + 1 : 1;
      expect(run, `chuỗi lặp tại câu ${1 + i}`).toBeLessThanOrEqual(2);
    }
  });

  it('nội dung hư cấu: email/web (nếu có) dùng tên miền .example', () => {
    const texts = [
      ...questions.flatMap((q) => [
        ...(q.script?.segments.map((s) => s.text) ?? []),
        mcq(q).stem,
        ...mcq(q).options.map((o) => o.text),
      ]),
      ...groups.flatMap((g) => g.script.segments.map((s) => s.text)),
    ];
    for (const t of texts) {
      for (const m of t.match(/[\w.-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/|www\.)\S+/g) ?? []) {
        expect(m, t).toMatch(/\.example\b/);
      }
    }
  });
});

describe('Đề TOEIC Listening 01 – script & giọng đọc', () => {
  const allScripts: ListeningScript[] = [
    ...questions.flatMap((q) => (q.script ? [q.script] : [])),
    ...groups.map((g) => g.script),
  ];

  it('người dẫn N luôn giọng us; mỗi giọng giữ một accent trong cùng script; segment không rỗng', () => {
    for (const script of allScripts) {
      const accentOf = new Map<string, string>();
      for (const s of script.segments) {
        expect(s.text.trim().length).toBeGreaterThan(0);
        if (s.speaker === 'N') expect(s.accent).toBe('us');
        const prev = accentOf.get(s.speaker);
        if (prev) expect(s.accent, `${s.speaker}: ${s.text}`).toBe(prev);
        accentOf.set(s.speaker, s.accent);
      }
    }
  });

  it('trộn đủ 4 giọng us/uk/au/ca, mỗi giọng ≥ 15% lượt nói; có cả giọng nam và nữ', () => {
    const segs = allScripts.flatMap((s) => s.segments).filter((s) => s.speaker !== 'N');
    for (const accent of ['us', 'uk', 'au', 'ca']) {
      const share = segs.filter((s) => s.accent === accent).length / segs.length;
      expect(share, accent).toBeGreaterThanOrEqual(0.15);
    }
    expect(segs.some((s) => s.speaker.startsWith('M'))).toBe(true);
    expect(segs.some((s) => s.speaker.startsWith('W'))).toBe(true);
  });

  it('Part 1: N đọc "Number n. Look at the picture…" rồi MỘT giọng khác đọc (A)–(D)', () => {
    for (const q of inSection('part1')) {
      const [intro, ...rest] = q.script?.segments ?? [];
      expect(intro?.speaker, q.key).toBe('N');
      expect(intro?.text, q.key).toBe(
        `Number ${q.number}. Look at the picture marked number ${q.number} in your test book.`,
      );
      expect(rest.map((s) => s.text.slice(0, 4))).toEqual(['(A) ', '(B) ', '(C) ', '(D) ']);
      expect(new Set(rest.map((s) => `${s.speaker}/${s.accent}`)).size, q.key).toBe(1);
      expect(rest[0]?.speaker, q.key).not.toBe('N');
    }
  });

  it('Part 2: N đọc "Number n.", một giọng hỏi, giọng KHÁC đọc (A)–(C)', () => {
    for (const q of inSection('part2')) {
      const [intro, prompt, ...rest] = q.script?.segments ?? [];
      expect(intro, q.key).toEqual({ speaker: 'N', accent: 'us', text: `Number ${q.number}.` });
      expect(prompt?.speaker, q.key).not.toBe('N');
      expect(prompt?.text.startsWith('('), q.key).toBe(false);
      expect(rest.map((s) => s.text.slice(0, 4))).toEqual(['(A) ', '(B) ', '(C) ']);
      expect(new Set(rest.map((s) => s.speaker)).size, q.key).toBe(1);
      expect(rest[0]?.speaker, q.key).not.toBe(prompt?.speaker);
      expect(rest[0]?.speaker, q.key).not.toBe('N');
    }
  });

  it('Part 3/4: script câu = N đọc "Number n. <câu hỏi>" (không đọc graphic)', () => {
    for (const q of [...inSection('part3'), ...inSection('part4')]) {
      const segs = q.script?.segments ?? [];
      expect(segs, q.key).toHaveLength(1);
      expect(segs[0]?.speaker, q.key).toBe('N');
      const question = mcq(q).stem.split('\n\n')[0] ?? '';
      expect(segs[0]?.text, q.key).toBe(`Number ${q.number}. ${question}`);
      expect(segs[0]?.text, q.key).not.toContain('|');
    }
  });

  it('scriptText gắn nhãn M/W (M1/M2, W1/W2 khi hai giọng cùng giới); scriptWordCount bỏ lời dẫn', () => {
    const script: ListeningScript = {
      segments: [
        { speaker: 'N', accent: 'us', text: 'Questions 1 through 3 refer to the following conversation.' },
        { speaker: 'W1', accent: 'uk', text: 'Hello there.' },
        { speaker: 'M1', accent: 'au', text: 'Hi, how are you?' },
        { speaker: 'M2', accent: 'ca', text: 'Good, thanks.' },
      ],
    };
    expect(scriptText(script)).toBe(
      'N: Questions 1 through 3 refer to the following conversation.\nW: Hello there.\nM1: Hi, how are you?\nM2: Good, thanks.',
    );
    expect(scriptText(script, { narrator: false })).toBe('W: Hello there.\nM1: Hi, how are you?\nM2: Good, thanks.');
    expect(scriptWordCount(script)).toBe(8);
    expect(scriptWordCount(script, { narrator: true })).toBe(17);
  });
});

describe('Đề TOEIC Listening 01 – Part 1 (ảnh SVG)', () => {
  it('mỗi câu có ảnh SVG hợp lệ: bắt đầu <svg, viewBox 0 0 800 600, không <script/<text/ảnh ngoài, < 6 KB', () => {
    const keys = new Set<string>();
    for (const q of inSection('part1')) {
      const img = q.image;
      expect(img, q.key).toBeDefined();
      if (!img) continue;
      keys.add(img.key);
      expect(img.svg.startsWith('<svg'), q.key).toBe(true);
      expect(img.svg.endsWith('</svg>'), q.key).toBe(true);
      expect(img.svg, q.key).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(img.svg, q.key).toContain('viewBox="0 0 800 600"');
      expect(img.svg.toLowerCase(), q.key).not.toContain('<script');
      expect(img.svg.toLowerCase(), q.key).not.toContain('<text');
      expect(img.svg.toLowerCase(), q.key).not.toContain('<image');
      expect(img.svg.toLowerCase(), q.key).not.toMatch(/\son\w+=/);
      expect(img.svg.replace('http://www.w3.org/2000/svg', ''), q.key).not.toMatch(/https?:/);
      expect(Buffer.byteLength(img.svg, 'utf8'), q.key).toBeLessThan(6 * 1024);
      expect(img.alt_vi.length, q.key).toBeGreaterThan(20);
      expect(img.alt_en.length, q.key).toBeGreaterThan(20);
      // Thẻ mở/đóng cân bằng (kiểm tra thô cho SVG viết tay)
      const opens = (img.svg.match(/<(?!\/)[a-z]+[^>]*[^/]>/g) ?? []).length;
      const closes = (img.svg.match(/<\/[a-z]+>/g) ?? []).length;
      expect(opens, `${q.key} thẻ mở/đóng`).toBe(closes);
      // id trong <defs> có tiền tố riêng để không trùng khi nhiều ảnh cùng trang
      for (const [, id] of img.svg.matchAll(/id="([^"]+)"/g)) expect(id, q.key).toMatch(/^l01i\d/);
    }
    expect(keys.size).toBe(6);
    for (const q of [...inSection('part2'), ...inSection('part3'), ...inSection('part4')]) {
      expect(q.image, q.key).toBeUndefined();
    }
  });

  it('câu mô tả là câu tiếng Anh hoàn chỉnh; câu đúng không trùng câu sai', () => {
    for (const q of inSection('part1')) {
      const options = (q.script?.segments ?? []).slice(1).map((s) => s.text.slice(4));
      expect(options, q.key).toHaveLength(4);
      for (const o of options) expect(o, q.key).toMatch(/^[A-Z].+\.$/);
      expect(new Set(options).size, q.key).toBe(4);
    }
  });
});

describe('Đề TOEIC Listening 01 – Part 2', () => {
  const p2 = inSection('part2');
  const formOf = (q: ListeningQuestion) =>
    mcq(q)
      .tags.find((t) => t.startsWith('form:'))
      ?.slice(5);

  it('mỗi câu có đúng một tag form:<dạng>; phủ đủ WH-, Yes/No, câu đuôi, lựa chọn, đề nghị/yêu cầu, trần thuật', () => {
    for (const q of p2) {
      expect(
        mcq(q).tags.filter((t) => t.startsWith('form:')),
        q.key,
      ).toHaveLength(1);
      expect(PART2_FORMS, q.key).toContain(formOf(q));
    }
    for (const f of PART2_FORMS) {
      expect(p2.filter((q) => formOf(q) === f).length, f).toBeGreaterThanOrEqual(f === 'wh' ? 5 : 2);
    }
    for (const q of [...inSection('part1'), ...inSection('part3'), ...inSection('part4')]) {
      expect(mcq(q).tags, q.key).toEqual([]);
    }
  });

  it('≥ 6 câu trả lời gián tiếp (indirect_response); câu hỏi kết thúc đúng dấu câu theo dạng', () => {
    expect(p2.filter((q) => q.subskill === 'indirect_response').length).toBeGreaterThanOrEqual(6);
    for (const q of p2) {
      const prompt = q.script?.segments[1]?.text ?? '';
      if (formOf(q) === 'statement') expect(prompt, q.key).toMatch(/\.$/);
      else expect(prompt, q.key).toMatch(/\?$/);
      if (formOf(q) === 'tag') expect(prompt, q.key).toMatch(/, \w+n't \w+\?$/);
      if (formOf(q) === 'choice') expect(prompt, q.key).toContain(' or ');
    }
  });
});

describe('Đề TOEIC Listening 01 – Part 3 & 4 (nhóm)', () => {
  const p3Groups = groups.filter((g) => g.section === 'part3');
  const p4Groups = groups.filter((g) => g.section === 'part4');

  it('13 hội thoại + 10 bài nói; mỗi nhóm đúng 3 câu liền nhau cùng section; lời dẫn đúng số câu', () => {
    expect(p3Groups).toHaveLength(13);
    expect(p4Groups).toHaveLength(10);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    for (const g of groups) {
      expect(g.group_key, g.key).toBe(g.key);
      const qs = questionsOfGroup(g);
      expect(qs, g.key).toHaveLength(3);
      const first = qs[0]?.number ?? 0;
      expect(
        qs.map((q) => q.number),
        g.key,
      ).toEqual([first, first + 1, first + 2]);
      expect(
        qs.every((q) => q.section === g.section && q.topic === g.topic),
        g.key,
      ).toBe(true);
      const intro = g.script.segments[0];
      expect(intro?.speaker, g.key).toBe('N');
      expect(intro?.text, g.key).toMatch(
        new RegExp(`^Questions ${first} through ${first + 2} refer to the following .+\\.$`),
      );
      expect(
        g.script.segments.slice(1).every((s) => s.speaker !== 'N'),
        g.key,
      ).toBe(true);
    }
    for (const q of [...inSection('part3'), ...inSection('part4')]) {
      expect(q.group_key && groupByKey.has(q.group_key), q.key).toBe(true);
    }
    for (const q of [...inSection('part1'), ...inSection('part2')]) expect(q.group_key, q.key).toBeUndefined();
  });

  it('độ dài: hội thoại 90–140 từ, bài nói 100–150 từ (không tính lời dẫn); bài nói Part 4 một giọng', () => {
    for (const g of p3Groups) {
      const n = scriptWordCount(g.script);
      expect(n, g.key).toBeGreaterThanOrEqual(90);
      expect(n, g.key).toBeLessThanOrEqual(140);
      expect(speakers(g.script).size, g.key).toBeGreaterThanOrEqual(2);
      // hai người nói trở lên dùng ít nhất 2 accent khác nhau
      const accents = new Set(g.script.segments.filter((s) => s.speaker !== 'N').map((s) => s.accent));
      expect(accents.size, g.key).toBeGreaterThanOrEqual(2);
      expect(g.title, g.key).toMatch(/^Conversation \d+$/);
    }
    for (const g of p4Groups) {
      const n = scriptWordCount(g.script);
      expect(n, g.key).toBeGreaterThanOrEqual(100);
      expect(n, g.key).toBeLessThanOrEqual(150);
      expect(speakers(g.script).size, g.key).toBe(1);
      expect(g.title, g.key).toMatch(/^Talk \d+ – .+$/);
    }
  });

  it('≥ 2 hội thoại 3 người (lời dẫn "with three speakers")', () => {
    const three = p3Groups.filter((g) => speakers(g.script).size === 3);
    expect(three.length).toBeGreaterThanOrEqual(2);
    for (const g of three) expect(g.script.segments[0]?.text, g.key).toContain('with three speakers');
  });

  it('graphic: đúng 3 bộ cuối Part 3 và 2 bộ cuối Part 4; mỗi bộ có đúng 1 câu "Look at the graphic" kèm bảng markdown', () => {
    const withGraphic = (gs: ListeningGroup[]) => gs.filter((g) => g.graphic !== undefined).map((g) => g.key);
    expect(withGraphic(p3Groups)).toEqual(p3Groups.slice(-3).map((g) => g.key));
    expect(withGraphic(p4Groups)).toEqual(p4Groups.slice(-2).map((g) => g.key));
    for (const g of groups) {
      const qs = questionsOfGroup(g);
      const graphicQs = qs.filter(isGraphicQuestion);
      if (g.graphic === undefined) {
        expect(graphicQs, g.key).toHaveLength(0);
        continue;
      }
      const lines = g.graphic.split('\n').filter((l) => l.startsWith('|'));
      expect(lines.length, g.key).toBeGreaterThanOrEqual(4);
      expect(lines[1], g.key).toMatch(/^\|( --- \|)+$/);
      const cols = (lines[0]?.match(/\|/g) ?? []).length;
      for (const l of lines) expect((l.match(/\|/g) ?? []).length, `${g.key} ${l}`).toBe(cols);
      expect(graphicQs, g.key).toHaveLength(1);
      const q = graphicQs[0] as ListeningQuestion;
      expect(q.subskill, q.key).toBe('graphic_question');
      expect(mcq(q).stem, q.key).toContain(g.graphic);
      // Lời dẫn nhắc tới loại graphic: "conversation and …" / "… and schedule"
      expect(g.script.segments[0]?.text, g.key).toMatch(/ and /);
      // Các câu còn lại không in graphic
      for (const other of qs.filter((x) => x !== q)) expect(mcq(other).stem, other.key).not.toContain('|');
    }
    for (const q of questions.filter((x) => x.subskill === 'graphic_question')) {
      expect(isGraphicQuestion(q), q.key).toBe(true);
    }
  });

  it('câu hàm ý: Part 3 ≥ 2 câu "What does the man mean…", Part 4 ≥ 2 câu "What does the speaker mean…"; câu trích có trong lời đúng người nói', () => {
    const meaning = (section: 'part3' | 'part4') => inSection(section).filter((q) => MEANING_RE.test(mcq(q).stem));
    const p3 = meaning('part3');
    const p4 = meaning('part4');
    expect(p3.filter((q) => mcq(q).stem.startsWith('What does the man mean')).length).toBeGreaterThanOrEqual(2);
    expect(p4.length).toBeGreaterThanOrEqual(2);
    for (const q of [...p3, ...p4]) {
      const [, who, pronoun, quote] = MEANING_RE.exec(mcq(q).stem) ?? [];
      expect(q.subskill, q.key).toBe('speaker_intent');
      expect(pronoun === 'he' ? who !== 'woman' : who !== 'man', q.key).toBe(true);
      const g = groupByKey.get(q.group_key ?? '');
      const gender = pronoun === 'he' ? 'M' : 'W';
      const said = g?.script.segments.some((s) => s.speaker.startsWith(gender) && s.text.includes(quote ?? '\u0000'));
      expect(said, `${q.key} câu trích không có trong lời người nói`).toBe(true);
    }
    for (const q of questions.filter((x) => x.subskill === 'speaker_intent')) {
      expect(MEANING_RE.test(mcq(q).stem), q.key).toBe(true);
    }
  });

  it('mỗi Part 3/4 phủ các dạng: ý chính, chi tiết, suy luận, việc tiếp theo, hàm ý, graphic', () => {
    const required = [
      'listening_gist',
      'listening_detail',
      'listening_inference',
      'next_action',
      'speaker_intent',
      'graphic_question',
    ];
    for (const section of ['part3', 'part4'] as const) {
      const used = new Set<string>(inSection(section).map((q) => q.subskill));
      for (const s of required) expect(used.has(s), `${section} ${s}`).toBe(true);
    }
  });
});

describe('Đề TOEIC Listening 01 – bộ luyện theo Part', () => {
  const byKey = new Map(questions.map((q) => [q.key, q]));

  it('4 bộ luyện tham chiếu key tồn tại, đúng section, đúng số câu và qua validateTestSetStructure("part_drill")', () => {
    expect(LISTENING_DRILLS.map((d) => d.section)).toEqual(['part1', 'part2', 'part3', 'part4']);
    const expectedCount = { part1: 6, part2: 12, part3: 12, part4: 12 };
    for (const d of LISTENING_DRILLS) {
      expect(d.code, d.code).toMatch(/^toeic-listening-01-drill-part[1-4]$/);
      expect(d.title.vi, d.code).toBeTruthy();
      expect(d.title.en, d.code).toBeTruthy();
      expect(d.question_keys, d.code).toHaveLength(expectedCount[d.section]);
      expect(new Set(d.question_keys).size, d.code).toBe(d.question_keys.length);
      const qs = d.question_keys.map((k) => byKey.get(k));
      expect(
        qs.every((q) => q?.section === d.section),
        d.code,
      ).toBe(true);
      const report = validateTestSetStructure('part_drill', TOEIC_SECTIONS, toItems(qs.filter((q) => q !== undefined)));
      expect(report.issues, d.code).toEqual([]);
      expect(report.ok, d.code).toBe(true);
    }
    const [d1, d2, d3, d4] = LISTENING_DRILLS;
    expect(d1?.question_keys.map((k) => byKey.get(k)?.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d2?.question_keys.map((k) => byKey.get(k)?.number)).toEqual(Array.from({ length: 12 }, (_, i) => 7 + i));
    // Part 3/4: đúng 4 nhóm trọn vẹn
    for (const d of [d3, d4]) {
      const groupKeys = new Set(d?.question_keys.map((k) => byKey.get(k)?.group_key));
      expect(groupKeys.size, d?.code).toBe(4);
      for (const gk of groupKeys) {
        const g = groupByKey.get(gk ?? '');
        expect(g && questionsOfGroup(g).every((q) => d?.question_keys.includes(q.key)), `${d?.code} ${gk}`).toBe(true);
      }
    }
  });
});
