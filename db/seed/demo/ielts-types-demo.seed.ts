/* eslint-disable no-console -- seed CLI in tiến độ ra stdout như các seed demo khác */
import { eq } from 'drizzle-orm';
import { QUESTION_FIXTURES, QUESTION_FIXTURES_ALL, questionContentSchema, RL_DEMO_DIAGRAM_SVG, RL_DEMO_EXTRA, RL_DEMO_LISTENING, RL_DEMO_MAP_SVG, RL_DEMO_READING, type QuestionContent, type QuestionTypeCode } from '@allingo/schemas';
import type { Db } from '../../src/client.js';
import { catalogPassages, catalogSections, catalogSubskills, catalogTopics } from '../../drizzle/schema/index.js';
import { ensureSeedMedia, loadSeededQuestions, upsertSeedQuestion, upsertSeedTestSet, wordCount, type SeedContext, type SeedItem } from './seed-helpers.js';
import type { ScriptSegment } from './toeic-listening-01.js';
import type { SeedMediaSource } from './listening-01.seed.js';

/**
 * C2 – đề mẫu "IELTS – các dạng câu Reading/Listening" (`ielts-question-types-demo`): mỗi dạng câu IELTS R/L một câu tự biên soạn
 * (source = 'human', tên riêng hư cấu – nội dung ở packages/schemas/src/question/fixtures-rl.ts, KHÔNG sao chép đề IELTS thật).
 * - Listening (listening_p1): một lời thoại `audio_script` (TTS seed:media) cho trắc nghiệm, form/note/table, bản đồ, sơ đồ, Choose TWO.
 * - Reading (reading_p1): một đoạn văn 5 đoạn A–E cho 4 dạng nối, TFNG, YNNG, hoàn thành câu/tóm tắt/ngân hàng từ, trả lời ngắn,
 *   sơ đồ quy trình.
 * - Ảnh bản đồ/sơ đồ: SVG tự vẽ (seed:media ghi tệp). Chương trình IELTS vẫn "sắp ra mắt" tới C3 (cờ ff.catalog.program.ielts tắt);
 *   đề làm được qua link trực tiếp/E2E (A251).
 */

export const IELTS_DEMO_CODE = 'ielts-question-types-demo';
const LISTEN_GROUP = 'ielts-demo-listening';
const READ_GROUP = 'ielts-demo-reading';

interface DemoItem {
  key: string;
  section: 'listening_p1' | 'reading_p1';
  group: string;
  content: QuestionContent;
  subskill?: string;
}

const fixture = (t: QuestionTypeCode) => QUESTION_FIXTURES[t].content;
const extra = (i: number) => questionContentSchema.parse(RL_DEMO_EXTRA[i]!.content);

/** Thứ tự câu trong đề: Listening trước (như bài thi IELTS), Reading sau */
export function ieltsDemoItems(ids: { map: string; diagram: string }): DemoItem[] {
  const L = (key: string, content: QuestionContent): DemoItem => ({ key: `ielts-demo-${key}`, section: 'listening_p1', group: LISTEN_GROUP, content });
  const R = (key: string, content: QuestionContent): DemoItem => ({ key: `ielts-demo-${key}`, section: 'reading_p1', group: READ_GROUP, content });
  const withImage = (c: QuestionContent, id: string): QuestionContent => ({ ...c, image_asset_id: id }) as QuestionContent;
  return [
    L('l-mcq-single', extra(0)),
    L('l-form', fixture('form_completion')),
    L('l-note', fixture('note_completion')),
    L('l-table', fixture('table_completion')),
    L('l-map', withImage(fixture('plan_map_labelling'), ids.map)),
    L('l-diagram', withImage(fixture('diagram_labelling'), ids.diagram)),
    L('l-choose-two', mcqChooseTwo()),
    R('r-headings', fixture('matching_headings')),
    R('r-information', fixture('matching_information')),
    R('r-features', fixture('matching_features')),
    R('r-endings', fixture('matching_sentence_endings')),
    R('r-tfng', extra(1)),
    R('r-ynng', extra(2)),
    R('r-sentence', fixture('sentence_completion')),
    R('r-summary', fixture('summary_completion')),
    R('r-word-bank', fixture('summary_word_bank')),
    R('r-short-answer', fixture('short_answer')),
    R('r-flow-chart', fixture('flow_chart_completion')),
  ];
}

/** Fixture mcq_multi "Choose TWO letters" (có `select_count`) trong danh sách fixture đầy đủ */
function mcqChooseTwo(): QuestionContent {
  const f = QUESTION_FIXTURES_ALL.mcq_multi.find((x) => x.content.type === 'mcq_multi' && x.content.select_count !== undefined);
  if (!f) throw new Error('[seed:demo] thiếu fixture mcq_multi Choose TWO');
  return f.content;
}

/** Nguồn media của đề mẫu IELTS (seed:media đọc theo khoá asset) – SVG bản đồ/sơ đồ + TTS lời thoại Listening */
export function ieltsDemoMediaSources(): Map<string, SeedMediaSource> {
  return new Map<string, SeedMediaSource>([
    ['ielts-demo:map', { type: 'svg', svg: RL_DEMO_MAP_SVG, alt: MAP_ALT }],
    ['ielts-demo:diagram', { type: 'svg', svg: RL_DEMO_DIAGRAM_SVG, alt: DIAGRAM_ALT }],
    ['ielts-demo:listening', { type: 'tts', segments: LISTEN_SEGMENTS, gap_ms: 350, locale: 'en-US' }],
  ]);
}

const MAP_ALT = { vi: 'Bản đồ vườn cộng đồng Harbourview với các chữ A–F', en: 'Map of Harbourview Community Garden with letters A–F' };
const DIAGRAM_ALT = { vi: 'Sơ đồ thu nước mưa ở nhà kho dụng cụ, nhãn 1–3', en: 'Rainwater collection diagram at the tool shed, labels 1–3' };

const LISTEN_SEGMENTS: ScriptSegment[] = RL_DEMO_LISTENING.segments.map((s) => ({ speaker: s.speaker === 'Daniel' ? 'M1' : 'W1', accent: 'uk', text: s.text }));
const scriptBody = RL_DEMO_LISTENING.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');

export async function seedIeltsTypesDemo(db: Db, adminId: string): Promise<{ testSetId: string; questions: number }> {
  const sections = await db.select({ id: catalogSections.id, code: catalogSections.code }).from(catalogSections).where(eq(catalogSections.programCode, 'ielts'));
  const subskills = await db.select({ id: catalogSubskills.id, code: catalogSubskills.code }).from(catalogSubskills).where(eq(catalogSubskills.programCode, 'ielts'));
  const topics = await db.select({ id: catalogTopics.id, code: catalogTopics.code }).from(catalogTopics);
  const ctx: SeedContext = { adminId, sectionId: new Map(sections.map((s) => [s.code, s.id])), subskillId: new Map(subskills.map((s) => [s.code, s.id])), topicId: new Map(topics.map((t) => [t.code, t.id])) };

  const svg = (key: string, body: string, alt: { vi: string; en: string }) =>
    ensureSeedMedia(db, { key, kind: 'image', mimeType: 'image/svg+xml', createdBy: adminId, source: JSON.stringify({ type: 'svg', svg: body, alt }), metadata: { bucket: 'media', origin: 'cms', alt } });
  const mapId = await svg('ielts-demo:map', RL_DEMO_MAP_SVG, MAP_ALT);
  const diagramId = await svg('ielts-demo:diagram', RL_DEMO_DIAGRAM_SVG, DIAGRAM_ALT);
  const audioId = await ensureSeedMedia(db, {
    key: 'ielts-demo:listening',
    kind: 'audio',
    mimeType: 'audio/mpeg',
    createdBy: adminId,
    source: JSON.stringify({ type: 'tts', segments: LISTEN_SEGMENTS, gap_ms: 350, locale: 'en-US' }),
    metadata: { bucket: 'media', origin: 'tts' },
    transcript: LISTEN_SEGMENTS.map((s) => ({ speaker: s.speaker, text: s.text })),
  });

  const items = ieltsDemoItems({ map: mapId, diagram: diagramId });
  const existing = await loadSeededQuestions(db, items.map((i) => i.key));
  // Passage: Reading (đoạn văn) + Listening (script audio – body chỉ trả sau khi nộp)
  const passages: Record<string, { kind: 'reading_passage' | 'audio_script'; title: string; body: string; mediaAssetId: string | null }> = {
    [READ_GROUP]: { kind: 'reading_passage', title: RL_DEMO_READING.title, body: RL_DEMO_READING.body, mediaAssetId: null },
    [LISTEN_GROUP]: { kind: 'audio_script', title: RL_DEMO_LISTENING.title, body: scriptBody, mediaAssetId: audioId },
  };
  const passageIdByGroup = new Map<string, string>();
  for (const [group, p] of Object.entries(passages)) {
    const values = { programCode: 'ielts', kind: p.kind, title: p.title, body: p.body, mediaAssetId: p.mediaAssetId, wordCount: wordCount(p.body), difficulty: 'B2' as const, topicId: ctx.topicId.get('education') ?? null, source: 'human' as const, status: 'published' as const, createdBy: adminId };
    const prior = items.filter((i) => i.group === group).map((i) => existing.get(i.key)?.passageId).find(Boolean);
    if (prior) {
      await db.update(catalogPassages).set({ ...values, updatedAt: new Date() }).where(eq(catalogPassages.id, prior));
      passageIdByGroup.set(group, prior);
    } else {
      const [row] = await db.insert(catalogPassages).values(values).returning({ id: catalogPassages.id });
      passageIdByGroup.set(group, row!.id);
    }
  }
  const questionIdByKey = new Map<string, string>();
  for (const [i, it] of items.entries()) {
    const id = await upsertSeedQuestion(db, ctx, existing, {
      key: it.key,
      number: i + 1,
      section: it.section,
      passageId: passageIdByGroup.get(it.group) ?? null,
      difficulty: 'B2',
      topic: 'education',
      subskill: it.subskill,
      content: it.content,
      testCode: IELTS_DEMO_CODE,
      changeNote: 'seed demo – C2 IELTS question types',
      program: 'ielts',
    });
    questionIdByKey.set(it.key, id);
  }
  const seedItems: SeedItem[] = items.map((i) => ({ key: i.key, section: i.section, group_key: i.group }));
  const testSetId = await upsertSeedTestSet(db, ctx, {
    code: IELTS_DEMO_CODE,
    title: { vi: 'IELTS – Làm quen các dạng câu Reading & Listening (18 câu)', en: 'IELTS – Reading & Listening question types (18 items)' },
    kind: 'mini',
    durationSec: 40 * 60,
    items: seedItems,
    questionIdByKey,
    program: 'ielts',
  });
  console.log(`[seed:demo] ${IELTS_DEMO_CODE} questions=${items.length} (ielts, source=human)`);
  return { testSetId, questions: items.length };
}
