/* eslint-disable no-console */
import { eq } from 'drizzle-orm';
import type { QuestionContent } from '@allingo/schemas';
import type { Db } from '../../src/client.js';
import { catalogPassages } from '../../drizzle/schema/index.js';
import type { PartSeedResult } from './reading-01.seed.js';
import {
  assertStructure,
  ensureSeedMedia,
  hardestOf,
  loadSeededQuestions,
  loadSectionSpecs,
  upsertSeedQuestion,
  upsertSeedTestSet,
  type SeedContext,
  type SeedItem,
} from './seed-helpers.js';
import {
  LISTENING_DRILLS,
  LISTENING_FULL_01,
  scriptText,
  scriptWordCount,
  type ListeningQuestion,
  type ScriptSegment,
} from './toeic-listening-01.js';

/** Listening TOEIC L&R ~ 45 phút; nhịp làm bài do audio quyết định (đồng hồ đề chỉ là giới hạn trên) */
export const LISTENING_FULL_DURATION_SEC = 45 * 60;
const DRILL_SECONDS_PER_QUESTION: Record<'part1' | 'part2' | 'part3' | 'part4', number> = {
  part1: 35,
  part2: 25,
  part3: 45,
  part4: 45,
};

/** Khoảng lặng giữa các lượt nói trong một tệp TTS (ms) */
const GAP_BETWEEN_OPTIONS_MS = 700;
const GAP_BETWEEN_TURNS_MS = 350;

/**
 * Nguồn sinh media cho nội dung seed: script API (`pnpm --filter @allingo/api seed:media`) đọc theo
 * `media_assets.metadata.seed.key` → sinh TTS (ghép từng segment, chèn khoảng lặng) hoặc ghi ảnh SVG.
 */
export type SeedMediaSource =
  | { type: 'tts'; segments: ScriptSegment[]; gap_ms: number; locale: 'en-US' }
  | { type: 'svg'; svg: string; alt: { vi: string; en: string } };

/** Đề bài Part 3/4 bỏ bảng graphic (không đọc) – người dẫn đọc "Number n. <câu hỏi>" */
export function questionReadout(q: ListeningQuestion): string {
  const stem = q.content.stem
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('|'))
    .join(' ')
    .trim();
  return `Number ${q.number}. ${stem}`;
}

const audioKey = (k: string) => `${k}:audio`;
const imageKey = (k: string) => `${k}:image`;

/** Toàn bộ nguồn media của đề Listening 01, theo khoá seed của asset */
export function listeningMediaSources(): Map<string, SeedMediaSource> {
  const out = new Map<string, SeedMediaSource>();
  for (const g of LISTENING_FULL_01.groups) {
    out.set(audioKey(g.group_key), {
      type: 'tts',
      segments: g.script.segments,
      gap_ms: GAP_BETWEEN_TURNS_MS,
      locale: 'en-US',
    });
  }
  for (const q of LISTENING_FULL_01.questions) {
    if (q.section === 'part1' || q.section === 'part2') {
      if (!q.script) throw new Error(`[seed:demo] ${q.key} thiếu script`);
      out.set(audioKey(q.key), {
        type: 'tts',
        segments: q.script.segments,
        gap_ms: GAP_BETWEEN_OPTIONS_MS,
        locale: 'en-US',
      });
    } else {
      out.set(audioKey(q.key), {
        type: 'tts',
        segments: [{ speaker: 'N', accent: 'us', text: questionReadout(q) }],
        gap_ms: 0,
        locale: 'en-US',
      });
    }
    if (q.image)
      out.set(imageKey(q.key), { type: 'svg', svg: q.image.svg, alt: { vi: q.image.alt_vi, en: q.image.alt_en } });
  }
  return out;
}

const transcriptOf = (segments: ScriptSegment[]) => segments.map((s) => ({ speaker: s.speaker, text: s.text }));

/**
 * Seed đề TOEIC Listening đầy đủ 01 (100 câu tự biên soạn) + 4 bộ luyện Part 1–4.
 * - Part 3/4: mỗi hội thoại/bài nói một `catalog.passages` kind `audio_script` (body = transcript, chỉ trả sau khi nộp),
 *   audio nhóm gắn `passages.media_asset_id`; mỗi câu có audio người dẫn đọc câu hỏi.
 * - Part 1/2: audio theo câu; Part 1 có ảnh SVG tự vẽ. Asset tạo ở trạng thái `uploading` → script media sinh tệp.
 */
export async function seedListeningFull01(db: Db, ctx: SeedContext): Promise<PartSeedResult> {
  const questions = LISTENING_FULL_01.questions;
  const items: SeedItem[] = questions.map((q) => ({ key: q.key, section: q.section, group_key: q.group_key ?? null }));
  const itemByKey = new Map(items.map((i) => [i.key, i]));

  const specs = await loadSectionSpecs(db);
  assertStructure(specs, 'full', LISTENING_FULL_01.code, items);
  for (const d of LISTENING_DRILLS)
    assertStructure(
      specs,
      'part_drill',
      d.code,
      d.question_keys.map((k) => itemByKey.get(k)!),
    );

  const sources = listeningMediaSources();
  const ensure = async (key: string, kind: 'audio' | 'image') => {
    const src = sources.get(key);
    if (!src) throw new Error(`[seed:demo] thiếu nguồn media ${key}`);
    return ensureSeedMedia(db, {
      key,
      kind,
      mimeType: src.type === 'svg' ? 'image/svg+xml' : 'audio/mpeg',
      createdBy: ctx.adminId,
      source: JSON.stringify(src),
      metadata: {
        bucket: 'media',
        origin: src.type === 'svg' ? 'cms' : 'tts',
        ...(src.type === 'svg' ? { alt: src.alt } : {}),
      },
      transcript: src.type === 'tts' ? transcriptOf(src.segments) : undefined,
    });
  };

  const existing = await loadSeededQuestions(
    db,
    items.map((i) => i.key),
  );

  // ---------------------------------------------------------------- Passage audio_script cho Part 3/4
  const passageIdByGroup = new Map<string, string>();
  for (const g of LISTENING_FULL_01.groups) {
    const groupQuestions = questions.filter((q) => q.group_key === g.group_key);
    const values = {
      programCode: 'toeic',
      kind: 'audio_script' as const,
      title: g.title,
      body: scriptText(g.script, { narrator: false }),
      mediaAssetId: await ensure(audioKey(g.group_key), 'audio'),
      wordCount: scriptWordCount(g.script),
      difficulty: hardestOf(groupQuestions),
      topicId: ctx.topicId.get(g.topic) ?? null,
      source: 'human' as const,
      status: 'published' as const,
      createdBy: ctx.adminId,
    };
    const prior = groupQuestions.map((q) => existing.get(q.key)?.passageId).find(Boolean);
    if (prior) {
      await db
        .update(catalogPassages)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(catalogPassages.id, prior));
      passageIdByGroup.set(g.group_key, prior);
    } else {
      const [row] = await db.insert(catalogPassages).values(values).returning({ id: catalogPassages.id });
      passageIdByGroup.set(g.group_key, row!.id);
    }
  }

  // ---------------------------------------------------------------- Câu hỏi (media trỏ asset seed)
  const questionIdByKey = new Map<string, string>();
  for (const q of questions) {
    const audioId = await ensure(audioKey(q.key), 'audio');
    const imageId = q.image ? await ensure(imageKey(q.key), 'image') : undefined;
    const base = q.content as Extract<QuestionContent, { type: 'mcq_single' }>;
    const content: QuestionContent = {
      ...base,
      media: {
        listen_policy: 'once',
        ...(base.media ?? {}),
        audio_asset_id: audioId,
        ...(imageId ? { image_asset_id: imageId } : {}),
      },
    };
    const id = await upsertSeedQuestion(db, ctx, existing, {
      key: q.key,
      number: q.number,
      section: q.section,
      passageId: q.group_key ? (passageIdByGroup.get(q.group_key) ?? null) : null,
      difficulty: q.difficulty,
      topic: q.topic,
      subskill: q.subskill,
      content,
      testCode: LISTENING_FULL_01.code,
      changeNote: 'seed demo – TOEIC Listening 01',
    });
    questionIdByKey.set(q.key, id);
  }

  // ---------------------------------------------------------------- Đề full Listening + bộ luyện
  const testSetIds: Record<string, string> = {};
  testSetIds[LISTENING_FULL_01.code] = await upsertSeedTestSet(db, ctx, {
    code: LISTENING_FULL_01.code,
    title: LISTENING_FULL_01.title,
    kind: 'full',
    durationSec: LISTENING_FULL_DURATION_SEC,
    items,
    questionIdByKey,
  });
  for (const d of LISTENING_DRILLS) {
    const durationSec = d.question_keys.length * DRILL_SECONDS_PER_QUESTION[d.section];
    testSetIds[d.code] = await upsertSeedTestSet(db, ctx, {
      code: d.code,
      title: d.title,
      kind: 'part_drill',
      durationSec,
      items: d.question_keys.map((k) => itemByKey.get(k)!),
      questionIdByKey,
      sectionDurationSec: () => durationSec,
    });
  }

  console.log(
    `[seed:demo] ${LISTENING_FULL_01.code} passages=${passageIdByGroup.size} questions=${questionIdByKey.size} media=${sources.size} drills=${LISTENING_DRILLS.length}`,
  );
  return { passages: passageIdByGroup.size, questionIdByKey, items, testSetIds };
}

/** TOEIC L&R 200 câu / 120 phút = Listening 01 + Reading 01 */
export const LR_FULL_01 = {
  code: 'toeic-lr-full-01',
  title: {
    vi: 'Đề luyện TOEIC Listening & Reading đầy đủ 01 (200 câu, 120 phút)',
    en: 'TOEIC Listening & Reading Full Practice Test 01 (200 questions, 120 minutes)',
  },
  durationSec: 120 * 60,
} as const;

export async function seedLrFull01(
  db: Db,
  ctx: SeedContext,
  listening: PartSeedResult,
  reading: PartSeedResult,
): Promise<string> {
  const items = [...listening.items, ...reading.items];
  assertStructure(await loadSectionSpecs(db), 'full', LR_FULL_01.code, items);
  const questionIdByKey = new Map([...listening.questionIdByKey, ...reading.questionIdByKey]);
  return upsertSeedTestSet(db, ctx, {
    code: LR_FULL_01.code,
    title: LR_FULL_01.title,
    kind: 'full',
    durationSec: LR_FULL_01.durationSec,
    items,
    questionIdByKey,
  });
}
