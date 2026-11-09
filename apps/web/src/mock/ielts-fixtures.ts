import { questionContentSchema, type QuestionContent, type QuestionTypeCode } from '@allingo/schemas/question/content';
import { QUESTION_FIXTURES, QUESTION_FIXTURES_ALL } from '@allingo/schemas/question/fixtures';
import { RL_DEMO_DIAGRAM_SVG, RL_DEMO_EXTRA, RL_DEMO_LISTENING, RL_DEMO_MAP_SVG, RL_DEMO_READING } from '@allingo/schemas/question/fixtures-rl';
import type { MockQuestion, MockTestSet } from './fixtures';

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

export const MOCK_IELTS_TEST_SETS: MockTestSet[] = [IELTS_DEMO_SET];
