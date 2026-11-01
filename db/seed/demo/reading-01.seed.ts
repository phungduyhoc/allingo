/* eslint-disable no-console */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { questionContentSchema, validateTestSetStructure } from '@allingo/schemas';
import type { Db } from '../../src/client.js';
import {
  catalogPassages,
  catalogQuestionSubskills,
  catalogQuestionVersions,
  catalogQuestions,
  catalogSections,
  catalogSkills,
  catalogTestSetItems,
  catalogTestSetSections,
  catalogTestSets,
} from '../../drizzle/schema/index.js';
import { mergeGroupPassages, READING_DRILLS, READING_FULL_01, type ReadingQuestion } from './toeic-reading-01.js';

/** Thời gian làm bài Reading TOEIC L&R: 75 phút cho cả Part 5–7 (đồng hồ chung, không chia theo Part) */
export const READING_FULL_DURATION_SEC = 75 * 60;
/** Bộ luyện: ước tính ~ 40 s/câu Part 5, ~ 60 s/câu Part 6–7 */
const DRILL_SECONDS_PER_QUESTION: Record<'part5' | 'part6' | 'part7', number> = { part5: 40, part6: 60, part7: 60 };

const DIFFICULTY_RANK = { A2: 1, B1: 2, B2: 3 } as const;

export interface ReadingSeedContext {
  adminId: string;
  sectionId: Map<string, string>;
  subskillId: Map<string, string>;
  topicId: Map<string, string>;
}

export interface ReadingSeedResult {
  passages: number;
  questions: number;
  testSetIds: Record<string, string>;
}

const wordCount = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Seed đề TOEIC Reading đầy đủ 01 (100 câu, nội dung tự biên soạn, source = 'human') + 3 bộ luyện theo Part.
 * Idempotent: câu hỏi nhận diện qua `question_versions.metadata.seed_key`; đoạn văn nhận diện qua passage_id của câu đầu nhóm.
 * Nhóm đa đoạn (bộ đôi/bộ ba Part 7) gộp thành một `catalog.passages` vì `questions.passage_id` chỉ trỏ một đoạn.
 */
export async function seedReadingFull01(db: Db, ctx: ReadingSeedContext): Promise<ReadingSeedResult> {
  const questions = READING_FULL_01.questions;
  const keys = questions.map((q) => q.key);

  // Kiểm tra cấu trúc trước khi ghi (cùng hàm API dùng khi phát hành đề), section lấy từ seed core
  const sectionSpecs = (
    await db
      .select({ code: catalogSections.code, skill: catalogSkills.code, questionCount: catalogSections.questionCount, sortOrder: catalogSections.sortOrder })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(and(eq(catalogSections.programCode, 'toeic')))
  ).map((s) => ({ code: s.code, skill: s.skill, question_count: s.questionCount ?? null, sort_order: s.sortOrder }));
  const check = (kind: 'full' | 'part_drill', code: string, list: readonly ReadingQuestion[]) => {
    const report = validateTestSetStructure(
      kind,
      sectionSpecs,
      list.map((q, i) => ({ question_ref: q.key, section_code: q.section, sort_order: i + 1, group_key: q.group_key ?? null })),
    );
    if (!report.ok) throw new Error(`[seed:demo] ${code} cấu trúc không hợp lệ: ${JSON.stringify(report.issues)}`);
  };
  check('full', READING_FULL_01.code, questions);
  const byKeyAll = new Map(questions.map((q) => [q.key, q]));
  for (const d of READING_DRILLS) check('part_drill', d.code, d.question_keys.map((k) => byKeyAll.get(k)!));

  // Câu đã seed trước đó (seed_key → question_id, version_id, passage_id)
  const existingRows = await db
    .select({
      seedKey: sql<string>`${catalogQuestionVersions.metadata} ->> 'seed_key'`,
      questionId: catalogQuestionVersions.questionId,
      versionId: catalogQuestionVersions.id,
      passageId: catalogQuestions.passageId,
    })
    .from(catalogQuestionVersions)
    .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
    .where(inArray(sql`${catalogQuestionVersions.metadata} ->> 'seed_key'`, keys));
  const existing = new Map(existingRows.map((r) => [r.seedKey, r]));

  // ---------------------------------------------------------------- Đoạn văn (một bản ghi mỗi group_key)
  const passageIdByGroup = new Map<string, string>();
  const groups = mergeGroupPassages();
  for (const g of groups) {
    const groupQuestions = questions.filter((q) => q.group_key === g.group_key);
    const hardest = groupQuestions.reduce<ReadingQuestion['difficulty']>(
      (acc, q) => (DIFFICULTY_RANK[q.difficulty] > DIFFICULTY_RANK[acc] ? q.difficulty : acc),
      'A2',
    );
    const values = {
      programCode: 'toeic',
      kind: 'reading_passage' as const,
      title: g.title,
      body: g.body,
      wordCount: wordCount(g.body),
      difficulty: hardest,
      topicId: ctx.topicId.get(g.topic) ?? null,
      source: 'human' as const,
      status: 'published' as const,
      createdBy: ctx.adminId,
    };
    const prior = groupQuestions.map((q) => existing.get(q.key)?.passageId).find(Boolean);
    if (prior) {
      await db.update(catalogPassages).set({ ...values, updatedAt: new Date() }).where(eq(catalogPassages.id, prior));
      passageIdByGroup.set(g.group_key, prior);
    } else {
      const [row] = await db.insert(catalogPassages).values(values).returning({ id: catalogPassages.id });
      passageIdByGroup.set(g.group_key, row!.id);
    }
  }

  // ---------------------------------------------------------------- Câu hỏi + phiên bản 1
  const questionIdByKey = new Map<string, string>();
  for (const q of questions) {
    const content = questionContentSchema.parse(q.content);
    const passageId = q.group_key ? (passageIdByGroup.get(q.group_key) ?? null) : null;
    const sectionId = ctx.sectionId.get(q.section);
    if (!sectionId) throw new Error(`[seed:demo] thiếu section ${q.section} (chạy seed core trước)`);
    const prior = existing.get(q.key);
    if (prior) {
      await db.update(catalogQuestionVersions).set({ content }).where(eq(catalogQuestionVersions.id, prior.versionId));
      await db
        .update(catalogQuestions)
        .set({ passageId, difficultyTarget: q.difficulty, topicId: q.topic ? (ctx.topicId.get(q.topic) ?? null) : null, updatedAt: new Date() })
        .where(eq(catalogQuestions.id, prior.questionId));
      questionIdByKey.set(q.key, prior.questionId);
      continue;
    }
    const [question] = await db
      .insert(catalogQuestions)
      .values({
        programCode: 'toeic',
        sectionId,
        questionTypeCode: content.type,
        passageId,
        topicId: q.topic ? (ctx.topicId.get(q.topic) ?? null) : null,
        status: 'published',
        source: 'human',
        difficultyTarget: q.difficulty,
        createdBy: ctx.adminId,
      })
      .returning({ id: catalogQuestions.id });
    const [version] = await db
      .insert(catalogQuestionVersions)
      .values({
        questionId: question!.id,
        versionNo: 1,
        content,
        metadata: { seed_key: q.key, author: 'allingo-content', test: READING_FULL_01.code, number: q.number },
        changeNote: 'seed demo – TOEIC Reading 01',
        createdBy: ctx.adminId,
      })
      .returning({ id: catalogQuestionVersions.id });
    await db.update(catalogQuestions).set({ currentVersionId: version!.id }).where(eq(catalogQuestions.id, question!.id));
    if (q.subskill && ctx.subskillId.has(q.subskill)) {
      await db
        .insert(catalogQuestionSubskills)
        .values({ questionId: question!.id, subskillId: ctx.subskillId.get(q.subskill)!, weight: '1' })
        .onConflictDoNothing();
    }
    questionIdByKey.set(q.key, question!.id);
  }

  // ---------------------------------------------------------------- Đề full + bộ luyện
  const byKey = byKeyAll;
  const upsertSet = async (input: {
    code: string;
    title: { vi: string; en: string };
    kind: 'full' | 'part_drill';
    durationSec: number;
    keys: string[];
  }): Promise<string> => {
    const [ts] = await db
      .insert(catalogTestSets)
      .values({
        programCode: 'toeic',
        code: input.code,
        title: input.title,
        kind: input.kind,
        isFree: true,
        durationSec: input.durationSec,
        status: 'published',
        publishedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [catalogTestSets.programCode, catalogTestSets.code],
        set: { title: sql`excluded.title`, kind: sql`excluded.kind`, durationSec: sql`excluded.duration_sec`, status: sql`excluded.status` },
      })
      .returning({ id: catalogTestSets.id });
    const testSetId = ts!.id;
    const sectionCodes = [...new Set(input.keys.map((k) => byKey.get(k)!.section))];
    await db.delete(catalogTestSetSections).where(eq(catalogTestSetSections.testSetId, testSetId));
    await db.insert(catalogTestSetSections).values(
      // Đề full: đồng hồ chung 75 phút (duration_sec của section để NULL); bộ luyện một Part: thời lượng = cả bộ
      sectionCodes.map((code, i) => ({
        testSetId,
        sectionId: ctx.sectionId.get(code)!,
        sortOrder: i + 1,
        durationSec: input.kind === 'full' ? null : input.durationSec,
      })),
    );
    await db.delete(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, testSetId));
    await db.insert(catalogTestSetItems).values(
      input.keys.map((k, i) => {
        const q = byKey.get(k)!;
        return {
          testSetId,
          questionId: questionIdByKey.get(k)!,
          sectionId: ctx.sectionId.get(q.section)!,
          sortOrder: i + 1,
          groupKey: q.group_key ?? null,
          points: '1',
        };
      }),
    );
    return testSetId;
  };

  const testSetIds: Record<string, string> = {};
  testSetIds[READING_FULL_01.code] = await upsertSet({
    code: READING_FULL_01.code,
    title: READING_FULL_01.title,
    kind: 'full',
    durationSec: READING_FULL_DURATION_SEC,
    keys,
  });
  for (const d of READING_DRILLS) {
    testSetIds[d.code] = await upsertSet({
      code: d.code,
      title: d.title,
      kind: 'part_drill',
      durationSec: d.question_keys.length * DRILL_SECONDS_PER_QUESTION[d.section],
      keys: d.question_keys,
    });
  }

  console.log(`[seed:demo] toeic-reading-full-01 passages=${groups.length} questions=${questionIdByKey.size} drills=${READING_DRILLS.length}`);
  return { passages: groups.length, questions: questionIdByKey.size, testSetIds };
}
