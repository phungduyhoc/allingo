/* eslint-disable no-console */
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/client.js';
import { catalogPassageParts, catalogPassages } from '../../drizzle/schema/index.js';
import {
  assertStructure,
  hardestOf,
  loadSeededQuestions,
  loadSectionSpecs,
  upsertSeedQuestion,
  upsertSeedTestSet,
  wordCount,
  type SeedContext,
  type SeedItem,
} from './seed-helpers.js';
import { mergeGroupPassages, READING_DRILLS, READING_FULL_01 } from './toeic-reading-01.js';

/** Thời gian làm bài Reading TOEIC L&R: 75 phút cho cả Part 5–7 (đồng hồ chung, không chia theo Part) */
export const READING_FULL_DURATION_SEC = 75 * 60;
/** Bộ luyện: ước tính ~ 40 s/câu Part 5, ~ 60 s/câu Part 6–7 */
const DRILL_SECONDS_PER_QUESTION: Record<'part5' | 'part6' | 'part7', number> = { part5: 40, part6: 60, part7: 60 };

/** @deprecated dùng SeedContext */
export type ReadingSeedContext = SeedContext;

export interface PartSeedResult {
  passages: number;
  questionIdByKey: Map<string, string>;
  /** Item theo thứ tự đề full (để ghép đề L&R 200 câu) */
  items: SeedItem[];
  testSetIds: Record<string, string>;
}

/**
 * Seed đề TOEIC Reading đầy đủ 01 (100 câu, nội dung tự biên soạn, source = 'human') + 3 bộ luyện theo Part.
 * Idempotent: câu hỏi nhận diện qua `question_versions.metadata.seed_key`; đoạn văn nhận diện qua passage_id của câu đầu nhóm.
 * Nhóm đa đoạn (bộ đôi/bộ ba Part 7) gộp thành một `catalog.passages` vì `questions.passage_id` chỉ trỏ một đoạn; B5/S24: từng văn
 * bản của nhóm ghi thêm vào `catalog.passage_parts` (tab trên giao diện) – `passages.body` giữ bản gộp làm dự phòng.
 */
export async function seedReadingFull01(db: Db, ctx: SeedContext): Promise<PartSeedResult> {
  const questions = READING_FULL_01.questions;
  const items: SeedItem[] = questions.map((q) => ({ key: q.key, section: q.section, group_key: q.group_key ?? null }));
  const itemByKey = new Map(items.map((i) => [i.key, i]));

  const specs = await loadSectionSpecs(db);
  assertStructure(specs, 'full', READING_FULL_01.code, items);
  for (const d of READING_DRILLS)
    assertStructure(
      specs,
      'part_drill',
      d.code,
      d.question_keys.map((k) => itemByKey.get(k)!),
    );

  const existing = await loadSeededQuestions(
    db,
    items.map((i) => i.key),
  );

  // ---------------------------------------------------------------- Đoạn văn (một bản ghi mỗi group_key)
  const passageIdByGroup = new Map<string, string>();
  const groups = mergeGroupPassages();
  for (const g of groups) {
    const groupQuestions = questions.filter((q) => q.group_key === g.group_key);
    const values = {
      programCode: 'toeic',
      kind: 'reading_passage' as const,
      title: g.title,
      body: g.body,
      wordCount: wordCount(g.body),
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
    // Văn bản từng phần (idempotent: thay toàn bộ part của passage)
    const passageId = passageIdByGroup.get(g.group_key)!;
    await db.delete(catalogPassageParts).where(eq(catalogPassageParts.passageId, passageId));
    if (g.parts.length) {
      await db.insert(catalogPassageParts).values(g.parts.map((p) => ({ passageId, sortOrder: p.sort_order, title: p.title, body: p.body })));
    }
  }

  // ---------------------------------------------------------------- Câu hỏi
  const questionIdByKey = new Map<string, string>();
  for (const q of questions) {
    const id = await upsertSeedQuestion(db, ctx, existing, {
      key: q.key,
      number: q.number,
      section: q.section,
      passageId: q.group_key ? (passageIdByGroup.get(q.group_key) ?? null) : null,
      difficulty: q.difficulty,
      topic: q.topic,
      subskill: q.subskill,
      content: q.content,
      testCode: READING_FULL_01.code,
      changeNote: 'seed demo – TOEIC Reading 01',
    });
    questionIdByKey.set(q.key, id);
  }

  // ---------------------------------------------------------------- Đề full + bộ luyện
  const testSetIds: Record<string, string> = {};
  testSetIds[READING_FULL_01.code] = await upsertSeedTestSet(db, ctx, {
    code: READING_FULL_01.code,
    title: READING_FULL_01.title,
    kind: 'full',
    durationSec: READING_FULL_DURATION_SEC,
    items,
    questionIdByKey,
  });
  for (const d of READING_DRILLS) {
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
    `[seed:demo] ${READING_FULL_01.code} passages=${groups.length} parts=${groups.reduce((n, g) => n + g.parts.length, 0)} questions=${questionIdByKey.size} drills=${READING_DRILLS.length}`,
  );
  return { passages: groups.length, questionIdByKey, items, testSetIds };
}
