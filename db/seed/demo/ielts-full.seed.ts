/* eslint-disable no-console -- seed CLI in tiến độ ra stdout như các seed demo khác */
import { eq, sql } from 'drizzle-orm';
import { IELTS_FULL_TESTS, markCount, questionContentSchema, type IeltsFullTest, type IeltsScriptSegment, type QuestionContent } from '@allingo/schemas';
import type { Db } from '../../src/client.js';
import { billingFeatureFlags, catalogPassages, catalogSections, catalogSubskills, catalogTopics } from '../../drizzle/schema/index.js';
import { assertStructure, ensureSeedMedia, loadSectionSpecs, loadSeededQuestions, upsertSeedQuestion, upsertSeedTestSet, wordCount, type SeedContext, type SeedItem } from './seed-helpers.js';
import type { SeedMediaSource } from './listening-01.seed.js';
import type { ScriptSegment } from './toeic-listening-01.js';

/**
 * C3 – hai đề IELTS đầy đủ tự biên soạn (nội dung: `packages/schemas/src/content/ielts-full/`, dùng chung với web mock):
 * - `ielts-reading-academic-01` (level academic, 60 phút) – 3 passage, 40 câu theo mục.
 * - `ielts-listening-01` – 4 part × 10 câu; mỗi part một passage `audio_script` với audio TTS nhiều giọng (`seed:media` sinh qua
 *   SpeechProvider; provider mock sinh audio im lặng đúng độ dài). Câu Listening `listen_policy = once` (Exam Mode nghe một lần).
 * Cấu trúc đề kiểm bằng `validateTestSetStructure` đếm theo mục (marking per_item) như API khi phát hành. Seed demo bật cờ ra mắt
 * `ff.catalog.program.ielts` (seed core vẫn tắt – production chỉ bật khi đủ nội dung).
 */

export const IELTS_LAUNCH_FLAG = 'ff.catalog.program.ielts';
/** Khoảng lặng giữa các lượt thoại (ms) */
const GAP_BETWEEN_TURNS_MS = 600;

const audioKey = (test: IeltsFullTest, sectionCode: string) => `${test.code}:${sectionCode}:audio`;
const toSegments = (segments: readonly IeltsScriptSegment[]): ScriptSegment[] => segments.map((s) => ({ speaker: s.speaker, accent: s.accent, text: s.text }));
const ttsSource = (segments: readonly IeltsScriptSegment[]) => ({ type: 'tts' as const, segments: toSegments(segments), gap_ms: GAP_BETWEEN_TURNS_MS, locale: 'en-US' as const });

/** Nguồn media của hai đề IELTS đầy đủ theo khoá seed của asset (seed:media) – TTS từng part + ảnh SVG */
export function ieltsFullMediaSources(): Map<string, SeedMediaSource> {
  const out = new Map<string, SeedMediaSource>();
  for (const test of IELTS_FULL_TESTS) {
    for (const img of test.images) out.set(img.key, { type: 'svg', svg: img.svg, alt: img.alt });
    for (const s of test.sections) if (s.passage.kind === 'audio_script') out.set(audioKey(test, s.section_code), ttsSource(s.passage.segments));
  }
  return out;
}

/** Thay id ảnh giả trong nội dung bằng id media thật */
function withImages(content: unknown, ids: ReadonlyMap<string, string>): QuestionContent {
  let json = JSON.stringify(content);
  for (const [placeholder, real] of ids) json = json.split(placeholder).join(real);
  return questionContentSchema.parse(JSON.parse(json));
}

async function seedIeltsFullTest(db: Db, ctx: SeedContext, test: IeltsFullTest): Promise<{ testSetId: string; questions: number; marks: number }> {
  const adminId = ctx.adminId;
  const imageIds = new Map<string, string>();
  for (const img of test.images) {
    const id = await ensureSeedMedia(db, {
      key: img.key,
      kind: 'image',
      mimeType: 'image/svg+xml',
      createdBy: adminId,
      source: JSON.stringify({ type: 'svg', svg: img.svg, alt: img.alt }),
      metadata: { bucket: 'media', origin: 'cms', alt: img.alt },
    });
    imageIds.set(img.placeholder_id, id);
  }

  const keys = test.sections.flatMap((s) => s.questions.map((q) => q.key));
  const existing = await loadSeededQuestions(db, keys);
  const questionIdByKey = new Map<string, string>();
  const items: SeedItem[] = [];
  let number = 0;
  for (const s of test.sections) {
    const p = s.passage;
    let mediaAssetId: string | null = null;
    let body: string;
    if (p.kind === 'audio_script') {
      mediaAssetId = await ensureSeedMedia(db, {
        key: audioKey(test, s.section_code),
        kind: 'audio',
        mimeType: 'audio/mpeg',
        createdBy: adminId,
        source: JSON.stringify(ttsSource(p.segments)),
        metadata: { bucket: 'media', origin: 'tts' },
        transcript: p.segments.map((x) => ({ speaker: x.name, text: x.text })),
      });
      body = p.segments.map((x) => `${x.name}: ${x.text}`).join('\n');
    } else {
      body = p.body;
    }
    const values = {
      programCode: 'ielts',
      kind: p.kind,
      title: p.title,
      body,
      mediaAssetId,
      wordCount: wordCount(body),
      difficulty: 'B2' as const,
      topicId: ctx.topicId.get(s.topic) ?? null,
      source: 'human' as const,
      status: 'published' as const,
      createdBy: adminId,
    };
    // Passage giữ id giữa các lần seed (theo câu đã seed của nhóm)
    const prior = s.questions.map((q) => existing.get(q.key)?.passageId).find(Boolean);
    let passageId: string;
    if (prior) {
      await db.update(catalogPassages).set({ ...values, updatedAt: new Date() }).where(eq(catalogPassages.id, prior));
      passageId = prior;
    } else {
      const [row] = await db.insert(catalogPassages).values(values).returning({ id: catalogPassages.id });
      passageId = row!.id;
    }
    for (const q of s.questions) {
      const content = withImages(q.content, imageIds);
      number += 1;
      const id = await upsertSeedQuestion(db, ctx, existing, {
        key: q.key,
        number,
        section: s.section_code,
        passageId,
        difficulty: q.difficulty,
        topic: s.topic,
        content,
        testCode: test.code,
        changeNote: 'seed demo – C3 IELTS full test',
        program: 'ielts',
      });
      questionIdByKey.set(q.key, id);
      items.push({ key: q.key, section: s.section_code, group_key: s.group_key, marks: markCount(content) });
    }
  }

  assertStructure(await loadSectionSpecs(db, 'ielts'), 'full', test.code, items, 'per_item');
  const testSetId = await upsertSeedTestSet(db, ctx, {
    code: test.code,
    title: test.title,
    kind: 'full',
    durationSec: test.duration_sec,
    items,
    questionIdByKey,
    program: 'ielts',
    level: test.level,
  });
  const marks = items.reduce((sum, i) => sum + (i.marks ?? 1), 0);
  console.log(`[seed:demo] ${test.code} questions=${items.length} marks=${marks} (ielts ${test.skill}${test.level ? ` ${test.level}` : ''}, source=human)`);
  return { testSetId, questions: items.length, marks };
}

/** Seed hai đề IELTS đầy đủ + bật cờ ra mắt IELTS cho môi trường demo */
export async function seedIeltsFull(db: Db, adminId: string): Promise<Array<{ code: string; testSetId: string; questions: number; marks: number }>> {
  const sections = await db.select({ id: catalogSections.id, code: catalogSections.code }).from(catalogSections).where(eq(catalogSections.programCode, 'ielts'));
  const subskills = await db.select({ id: catalogSubskills.id, code: catalogSubskills.code }).from(catalogSubskills).where(eq(catalogSubskills.programCode, 'ielts'));
  const topics = await db.select({ id: catalogTopics.id, code: catalogTopics.code }).from(catalogTopics);
  const ctx: SeedContext = { adminId, sectionId: new Map(sections.map((s) => [s.code, s.id])), subskillId: new Map(subskills.map((s) => [s.code, s.id])), topicId: new Map(topics.map((t) => [t.code, t.id])) };
  const out = [];
  for (const test of IELTS_FULL_TESTS) out.push({ code: test.code, ...(await seedIeltsFullTest(db, ctx, test)) });
  await enableIeltsLaunchFlag(db);
  return out;
}

/** Demo: IELTS "học được" (A242 – cờ bật + có đề phát hành). Seed core giữ `enabled = false`, không ghi đè lựa chọn ở môi trường khác. */
export async function enableIeltsLaunchFlag(db: Db): Promise<void> {
  await db
    .insert(billingFeatureFlags)
    .values({ key: IELTS_LAUNCH_FLAG, enabled: true, rules: {} })
    .onConflictDoUpdate({ target: billingFeatureFlags.key, set: { enabled: true, updatedAt: sql`now()` } });
  console.log(`[seed:demo] ${IELTS_LAUNCH_FLAG} = true (demo)`);
}
