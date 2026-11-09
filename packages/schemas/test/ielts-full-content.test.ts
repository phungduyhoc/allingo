import { describe, expect, it } from 'vitest';
import {
  IELTS_CBT,
  IELTS_FULL_TESTS,
  IELTS_LISTENING_01,
  IELTS_READING_ACADEMIC_01,
  hasSecretFields,
  markCount,
  numberMarks,
  questionContentSchema,
  runAutoChecks,
  toPublicContent,
  validateTestSetStructure,
  type SectionSpec,
} from '../src/index.js';

/** C3 – nội dung đề IELTS đầy đủ tự biên soạn: hợp lệ Zod, đủ 40 câu theo mục, kiểm tra tự động sạch, không lộ đáp án */

const parsed = (t: (typeof IELTS_FULL_TESTS)[number]) => t.sections.flatMap((s) => s.questions.map((q) => ({ section: s, q, content: questionContentSchema.parse(q.content) })));

const SECTION_SPECS: SectionSpec[] = [
  ...IELTS_CBT.listening_sections.map((code, i) => ({ code, skill: 'listening', question_count: 10, sort_order: i + 1 })),
  { code: 'reading_p1', skill: 'reading', question_count: 13, sort_order: 5 },
  { code: 'reading_p2', skill: 'reading', question_count: 13, sort_order: 6 },
  { code: 'reading_p3', skill: 'reading', question_count: 14, sort_order: 7 },
];

describe.each(IELTS_FULL_TESTS.map((t) => [t.code, t] as const))('%s', (_code, test) => {
  const items = parsed(test);

  it('mọi câu hợp lệ theo schema dạng câu (superRefine) và khoá câu không trùng', () => {
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => i.q.key)).size).toBe(items.length);
  });

  it('đủ 40 câu hỏi theo mục, đúng số mục từng section, đánh số liên tục 1–40', () => {
    const total = items.reduce((s, i) => s + markCount(i.content), 0);
    expect(total).toBe(IELTS_CBT.total_marks);
    const expected = test.skill === 'reading' ? { reading_p1: 13, reading_p2: 13, reading_p3: 14 } : { listening_p1: 10, listening_p2: 10, listening_p3: 10, listening_p4: 10 };
    const bySection: Record<string, number> = {};
    for (const i of items) bySection[i.section.section_code] = (bySection[i.section.section_code] ?? 0) + markCount(i.content);
    expect(bySection).toEqual(expected);
    const numbers = numberMarks(items.map((i) => i.content), 'per_item');
    expect(numbers[0]!.number_start).toBe(1);
    const last = numbers.at(-1)!;
    expect(last.number_start + last.mark_count - 1).toBe(40);
    const report = validateTestSetStructure(
      'full',
      SECTION_SPECS,
      items.map((i, n) => ({ question_ref: i.q.key, section_code: i.section.section_code, sort_order: n + 1, group_key: i.section.group_key, marks: markCount(i.content) })),
      { marking: 'per_item' },
    );
    expect(report.issues).toEqual([]);
  });

  it('số câu trong đề bài khớp số được đánh (stem "Questions a–b" nếu có)', () => {
    const numbers = numberMarks(items.map((i) => i.content), 'per_item');
    items.forEach((i, n) => {
      const m = /Questions? (\d+)(?:–(\d+))?\./.exec(String(i.content.stem ?? ''));
      if (!m) return;
      const { number_start, mark_count } = numbers[n]!;
      expect([Number(m[1]), Number(m[2] ?? m[1])], i.q.key).toEqual([number_start, number_start + mark_count - 1]);
    });
  });

  it('kiểm tra tự động không có lỗi chặn hay cảnh báo (có giải thích, giới hạn từ, đủ lựa chọn nhiễu)', () => {
    for (const i of items) {
      const rules = test.skill === 'listening' ? { audio_once: true } : null;
      const r = runAutoChecks({ program: 'ielts', section_code: i.section.section_code, question_type: i.content.type, content: i.content, has_passage: true, passage_has_audio: test.skill === 'listening', section_rules: rules });
      expect(r, i.q.key).toEqual([]);
    }
  });

  it('nội dung công khai không chứa đáp án; evidence nguyên văn từ đoạn văn/lời thoại', () => {
    for (const i of items) {
      const pub = toPublicContent(i.content);
      expect(hasSecretFields(pub), i.q.key).toBe(false);
      expect(JSON.stringify(pub)).not.toContain('"evidence"');
      const source = i.section.passage.kind === 'reading_passage' ? i.section.passage.body : i.section.passage.segments.map((s) => s.text).join('\n');
      for (const line of String(i.content.evidence ?? '').split('\n')) expect(source.includes(line), `${i.q.key}: ${line}`).toBe(true);
    }
  });

  it('ảnh trong nội dung đều có trong danh sách ảnh của đề (seed/mock thay id)', () => {
    const imageIds = new Set(test.images.map((im) => im.placeholder_id));
    for (const i of items) if ('image_asset_id' in i.content && i.content.image_asset_id) expect(imageIds.has(i.content.image_asset_id), i.q.key).toBe(true);
  });
});

describe('định dạng đề', () => {
  it('Reading Academic: 3 passage ~700–900 từ, 60 phút, level academic', () => {
    expect(IELTS_READING_ACADEMIC_01.duration_sec).toBe(IELTS_CBT.reading_duration_sec);
    expect(IELTS_READING_ACADEMIC_01.level).toBe('academic');
    for (const s of IELTS_READING_ACADEMIC_01.sections) {
      expect(s.passage.kind).toBe('reading_passage');
      const words = s.passage.kind === 'reading_passage' ? s.passage.body.split(/\s+/).length : 0;
      expect(words).toBeGreaterThanOrEqual(650);
      expect(words).toBeLessThanOrEqual(950);
    }
  });
  it('Listening: 4 part, mỗi part một lời thoại nhiều giọng, mọi câu nghe một lần trong Exam Mode', () => {
    expect(IELTS_LISTENING_01.sections.map((s) => s.section_code)).toEqual([...IELTS_CBT.listening_sections]);
    const accents = new Set(IELTS_LISTENING_01.sections.flatMap((s) => (s.passage.kind === 'audio_script' ? s.passage.segments.map((x) => x.accent) : [])));
    expect([...accents].sort()).toEqual(['au', 'ca', 'uk', 'us']);
    for (const s of IELTS_LISTENING_01.sections) {
      expect(s.passage.kind).toBe('audio_script');
      for (const q of s.questions) expect(questionContentSchema.parse(q.content).media?.listen_policy, q.key).toBe('once');
    }
  });
  it('tổng mỗi đề đúng 40 câu – 80 câu cho hai đề', () => {
    expect(IELTS_FULL_TESTS.flatMap((t) => parsed(t)).reduce((s, i) => s + markCount(i.content), 0)).toBe(80);
  });
});
