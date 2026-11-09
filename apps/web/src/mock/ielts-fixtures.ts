import { questionContentSchema, type QuestionContent, type QuestionTypeCode } from '@allingo/schemas/question/content';
import { QUESTION_FIXTURES, QUESTION_FIXTURES_ALL } from '@allingo/schemas/question/fixtures';
import { RL_DEMO_DIAGRAM_SVG, RL_DEMO_EXTRA, RL_DEMO_LISTENING, RL_DEMO_MAP_SVG, RL_DEMO_READING } from '@allingo/schemas/question/fixtures-rl';
import { markCount } from '@allingo/schemas/question/marks';
import { IELTS_LISTENING_01, IELTS_READING_ACADEMIC_01, type IeltsFullTest } from '@allingo/schemas/content/ielts-full/index';
import type { MockQuestion, MockSegment, MockTestSet } from './fixtures';

/**
 * C2 – đề mẫu IELTS "các dạng câu Reading/Listening" cho web mock: cùng nội dung tự biên soạn với seed demo
 * (`db/seed/demo/ielts-types-demo.seed.ts`, fixture `packages/schemas/src/question/fixtures-rl.ts`) – mã đề giống nhau để E2E dùng
 * chung cho mock và API thật. Ảnh bản đồ/sơ đồ là SVG tự vẽ (data URI – CSP img-src cho phép data:).
 */

export const IELTS_DEMO_CODE = 'ielts-question-types-demo';

const uid = (n: number, prefix = '7777') => `${prefix}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const fixture = (t: QuestionTypeCode): QuestionContent => QUESTION_FIXTURES[t].content;
const extra = (i: number): QuestionContent => questionContentSchema.parse(RL_DEMO_EXTRA[i]!.content);
const chooseTwo = (): QuestionContent => QUESTION_FIXTURES_ALL.mcq_multi.find((f) => f.content.type === 'mcq_multi' && f.content.select_count !== undefined)!.content;

const READING_PASSAGE = { id: uid(901, '7778'), kind: 'reading_passage', title: RL_DEMO_READING.title, body: RL_DEMO_READING.body, media_url: null } as const;
const LISTENING_PASSAGE = { id: uid(902, '7778'), kind: 'audio_script', title: RL_DEMO_LISTENING.title, body: RL_DEMO_LISTENING.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n'), media_url: null } as const;

/** Thứ tự như seed demo: Listening trước, Reading sau */
const ITEMS: Array<{ key: string; section: 'listening_p1' | 'reading_p1'; content: QuestionContent }> = [
  { key: 'l-mcq-single', section: 'listening_p1', content: extra(0) },
  { key: 'l-form', section: 'listening_p1', content: fixture('form_completion') },
  { key: 'l-note', section: 'listening_p1', content: fixture('note_completion') },
  { key: 'l-table', section: 'listening_p1', content: fixture('table_completion') },
  { key: 'l-map', section: 'listening_p1', content: fixture('plan_map_labelling') },
  { key: 'l-diagram', section: 'listening_p1', content: fixture('diagram_labelling') },
  { key: 'l-choose-two', section: 'listening_p1', content: chooseTwo() },
  { key: 'r-headings', section: 'reading_p1', content: fixture('matching_headings') },
  { key: 'r-information', section: 'reading_p1', content: fixture('matching_information') },
  { key: 'r-features', section: 'reading_p1', content: fixture('matching_features') },
  { key: 'r-endings', section: 'reading_p1', content: fixture('matching_sentence_endings') },
  { key: 'r-tfng', section: 'reading_p1', content: extra(1) },
  { key: 'r-ynng', section: 'reading_p1', content: extra(2) },
  { key: 'r-sentence', section: 'reading_p1', content: fixture('sentence_completion') },
  { key: 'r-summary', section: 'reading_p1', content: fixture('summary_completion') },
  { key: 'r-word-bank', section: 'reading_p1', content: fixture('summary_word_bank') },
  { key: 'r-short-answer', section: 'reading_p1', content: fixture('short_answer') },
  { key: 'r-flow-chart', section: 'reading_p1', content: fixture('flow_chart_completion') },
];

const imageOf = (c: QuestionContent): MockQuestion['media'] => {
  if (c.type === 'plan_map_labelling') return [{ id: c.image_asset_id, kind: 'image', url: svgUrl(RL_DEMO_MAP_SVG), duration_ms: null }];
  if (c.type === 'diagram_labelling') return [{ id: c.image_asset_id, kind: 'image', url: svgUrl(RL_DEMO_DIAGRAM_SVG), duration_ms: null }];
  return [];
};

export const IELTS_DEMO_QUESTIONS: MockQuestion[] = ITEMS.map((it, i) => ({
  question_id: uid(i + 1),
  question_version_id: uid(i + 1, '7779'),
  section_code: it.section,
  group_key: it.section === 'listening_p1' ? 'ielts-demo-listening' : 'ielts-demo-reading',
  order_no: i + 1,
  content: it.content,
  media: imageOf(it.content),
  passage: it.section === 'listening_p1' ? { ...LISTENING_PASSAGE } : { ...READING_PASSAGE },
  community_correct_rate: 55,
}));

/** Khoá ổn định từng câu (E2E tìm câu theo dạng) */
export const IELTS_DEMO_KEYS: readonly string[] = ITEMS.map((i) => i.key);

export const IELTS_DEMO_SET: MockTestSet = {
  id: uid(999, '7770'),
  code: IELTS_DEMO_CODE,
  title: { vi: 'IELTS – Làm quen các dạng câu Reading & Listening (18 câu)', en: 'IELTS – Reading & Listening question types (18 items)' },
  kind: 'mini',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: 40 * 60,
  question_count: IELTS_DEMO_QUESTIONS.length,
  sections: [
    { code: 'listening_p1', skill: 'listening', name: { vi: 'Listening Part 1', en: 'Listening Part 1' }, duration_sec: null, question_count: 7 },
    { code: 'reading_p1', skill: 'reading', name: { vi: 'Reading Passage 1', en: 'Reading Passage 1' }, duration_sec: null, question_count: 11 },
  ],
  questions: IELTS_DEMO_QUESTIONS,
};

// --------------------------------------------------------------------------- C3: hai đề IELTS đầy đủ

/**
 * C3 – đề IELTS đầy đủ cho web mock, cùng nội dung với seed demo (`db/seed/demo/ielts-full.seed.ts`, module
 * `packages/schemas/src/content/ielts-full/`) và cùng mã đề → E2E dùng chung mock/API thật.
 * - Audio mỗi part Listening: tệp MP3 im lặng 12 s (`public/demo-audio/ielts/`) – đủ để chạy luồng phát liên tục/nghe một lần;
 *   mốc thời gian lời thoại chia theo số từ trong 12 s (API thật: mốc từ seed:media).
 * - Ảnh sơ đồ/bản đồ: SVG data URI, id media = id giả trong nội dung (`placeholder_id`).
 * - `sections[].question_count` = số câu hỏi theo mục (13/13/14, 10 × 4) – như "Questions 1–40".
 */

/** Độ dài tệp audio mock của mỗi part (ms) – mock-fetch dùng cho `exam_format.listening_parts[].duration_ms` */
export const IELTS_MOCK_PART_AUDIO_MS = 12_000;

function mockSegments(segments: ReadonlyArray<{ name: string; text: string }>, totalMs: number): MockSegment[] {
  const words = segments.map((s) => s.text.split(/\s+/).length);
  const sum = words.reduce((a, b) => a + b, 0);
  let at = 0;
  return segments.map((s, i) => {
    const len = Math.round((words[i]! / sum) * totalMs);
    const seg = { start_ms: at, end_ms: i === segments.length - 1 ? totalMs : at + len, speaker: s.name, text: s.text };
    at += len;
    return seg;
  });
}

/** prefix: 4 ký tự hex riêng cho mỗi đề; trong đề tách dải số: câu 1–99, phiên bản 101–199, passage 900+, audio 950+, đề 998 */
function fullTestSet(test: IeltsFullTest, prefix: string): MockTestSet {
  const images = new Map(test.images.map((im) => [im.placeholder_id, im]));
  const questions: MockQuestion[] = [];
  const sections: MockTestSet['sections'] = [];
  test.sections.forEach((s, si) => {
    const p = s.passage;
    const passageId = uid(900 + si, prefix);
    const passage: MockQuestion['passage'] =
      p.kind === 'audio_script'
        ? {
            id: passageId,
            kind: 'audio_script',
            title: p.title,
            body: p.segments.map((x) => `${x.name}: ${x.text}`).join('\n'),
            media_url: `/demo-audio/ielts/l01-p${si + 1}.mp3`,
            media_asset_id: uid(950 + si, prefix),
            segments: mockSegments(p.segments, IELTS_MOCK_PART_AUDIO_MS),
          }
        : { id: passageId, kind: 'reading_passage', title: p.title, body: p.body, media_url: null };
    let marks = 0;
    for (const q of s.questions) {
      const content = questionContentSchema.parse(q.content);
      marks += markCount(content);
      const image = 'image_asset_id' in content && content.image_asset_id ? images.get(content.image_asset_id) : undefined;
      const n = questions.length + 1;
      questions.push({
        question_id: uid(n, prefix),
        question_version_id: uid(100 + n, prefix),
        section_code: s.section_code,
        group_key: s.group_key,
        order_no: n,
        content,
        media: image ? [{ id: image.placeholder_id, kind: 'image', url: svgUrl(image.svg), duration_ms: null }] : [],
        passage: { ...passage },
        community_correct_rate: 50,
      });
    }
    const label = s.section_code.startsWith('listening_') ? `Listening Part ${s.section_code.slice(-1)}` : `Reading Passage ${s.section_code.slice(-1)}`;
    sections.push({ code: s.section_code, skill: test.skill, name: { vi: label, en: label }, duration_sec: null, question_count: marks });
  });
  return {
    id: uid(998, prefix),
    code: test.code,
    title: test.title,
    kind: 'full',
    level: test.level,
    is_free: true,
    locked: false,
    duration_sec: test.duration_sec,
    question_count: questions.length,
    sections,
    questions,
  };
}

export const IELTS_READING_ACADEMIC_01_SET: MockTestSet = fullTestSet(IELTS_READING_ACADEMIC_01, '7781');
export const IELTS_LISTENING_01_SET: MockTestSet = fullTestSet(IELTS_LISTENING_01, '7782');

export const MOCK_IELTS_TEST_SETS: MockTestSet[] = [IELTS_LISTENING_01_SET, IELTS_READING_ACADEMIC_01_SET, IELTS_DEMO_SET];
