import { createHash } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { questionContentSchema, validateTestSetStructure, type QuestionContent } from '@allingo/schemas';
import type { Db } from '../../src/client.js';
import {
  catalogMediaAssets,
  catalogQuestionSubskills,
  catalogQuestionVersions,
  catalogQuestions,
  catalogSections,
  catalogSkills,
  catalogTestSetItems,
  catalogTestSetSections,
  catalogTestSets,
} from '../../drizzle/schema/index.js';

/** Ngữ cảnh tra cứu dùng chung cho các seed đề demo (id section/subskill/topic từ seed core) */
export interface SeedContext {
  adminId: string;
  sectionId: Map<string, string>;
  subskillId: Map<string, string>;
  topicId: Map<string, string>;
}

/** C3: thêm C1 cho nội dung IELTS (đề TOEIC GĐ1 dùng A2–B2) */
export type Difficulty = 'A2' | 'B1' | 'B2' | 'C1';
export const DIFFICULTY_RANK: Record<Difficulty, number> = { A2: 1, B1: 2, B2: 3, C1: 4 };

export const hardestOf = (list: readonly { difficulty: Difficulty }[]): Difficulty =>
  list.reduce<Difficulty>(
    (acc, q) => (DIFFICULTY_RANK[q.difficulty] > DIFFICULTY_RANK[acc] ? q.difficulty : acc),
    'A2',
  );

export const wordCount = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface SectionSpecRow {
  code: string;
  skill: string;
  question_count: number | null;
  sort_order: number;
}

export async function loadSectionSpecs(db: Db, program = 'toeic'): Promise<SectionSpecRow[]> {
  const rows = await db
    .select({
      code: catalogSections.code,
      skill: catalogSkills.code,
      questionCount: catalogSections.questionCount,
      sortOrder: catalogSections.sortOrder,
    })
    .from(catalogSections)
    .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
    .where(eq(catalogSections.programCode, program));
  return rows.map((s) => ({
    code: s.code,
    skill: s.skill,
    question_count: s.questionCount ?? null,
    sort_order: s.sortOrder,
  }));
}

export interface SeedItem {
  key: string;
  section: string;
  group_key?: string | null;
  /** C3 – số mục đánh số (markCount) – chỉ dùng khi kiểm cấu trúc với `marking = per_item` (IELTS) */
  marks?: number;
}

/** Kiểm tra cấu trúc bộ đề bằng cùng hàm API dùng khi phát hành; sai → dừng seed. C3: IELTS đếm theo mục (`marking = per_item`) */
export function assertStructure(
  specs: readonly SectionSpecRow[],
  kind: 'full' | 'part_drill' | 'mini' | 'diagnostic',
  code: string,
  items: readonly SeedItem[],
  marking: 'per_question' | 'per_item' = 'per_question',
): void {
  const report = validateTestSetStructure(
    kind,
    specs,
    items.map((q, i) => ({
      question_ref: q.key,
      section_code: q.section,
      sort_order: i + 1,
      group_key: q.group_key ?? null,
      marks: q.marks,
    })),
    { marking },
  );
  if (!report.ok) throw new Error(`[seed:demo] ${code} cấu trúc không hợp lệ: ${JSON.stringify(report.issues)}`);
}

export interface SeededQuestionRow {
  seedKey: string;
  questionId: string;
  versionId: string;
  passageId: string | null;
}

/** Câu đã seed trước đó, nhận diện qua `question_versions.metadata.seed_key` */
export async function loadSeededQuestions(db: Db, keys: readonly string[]): Promise<Map<string, SeededQuestionRow>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      seedKey: sql<string>`${catalogQuestionVersions.metadata} ->> 'seed_key'`,
      questionId: catalogQuestionVersions.questionId,
      versionId: catalogQuestionVersions.id,
      passageId: catalogQuestions.passageId,
    })
    .from(catalogQuestionVersions)
    .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
    .where(inArray(sql`${catalogQuestionVersions.metadata} ->> 'seed_key'`, [...keys]));
  return new Map(rows.map((r) => [r.seedKey, r]));
}

export interface SeedQuestionInput {
  key: string;
  number: number;
  section: string;
  passageId: string | null;
  difficulty: Difficulty;
  topic?: string;
  subskill?: string;
  content: QuestionContent;
  testCode: string;
  changeNote: string;
  /** C1: chương trình (mặc định toeic – các seed GĐ1) */
  program?: string;
}

/** Tạo hoặc cập nhật (idempotent) một câu đã phát hành + phiên bản 1, trả question_id */
export async function upsertSeedQuestion(
  db: Db,
  ctx: SeedContext,
  existing: Map<string, SeededQuestionRow>,
  q: SeedQuestionInput,
): Promise<string> {
  const content = questionContentSchema.parse(q.content);
  const sectionId = ctx.sectionId.get(q.section);
  if (!sectionId) throw new Error(`[seed:demo] thiếu section ${q.section} (chạy seed core trước)`);
  const topicId = q.topic ? (ctx.topicId.get(q.topic) ?? null) : null;
  const prior = existing.get(q.key);
  if (prior) {
    await db.update(catalogQuestionVersions).set({ content }).where(eq(catalogQuestionVersions.id, prior.versionId));
    await db
      .update(catalogQuestions)
      .set({ passageId: q.passageId, difficultyTarget: q.difficulty, topicId, updatedAt: new Date() })
      .where(eq(catalogQuestions.id, prior.questionId));
    await linkSubskill(db, ctx, prior.questionId, q.subskill);
    return prior.questionId;
  }
  const [question] = await db
    .insert(catalogQuestions)
    .values({
      programCode: q.program ?? 'toeic',
      sectionId,
      questionTypeCode: content.type,
      passageId: q.passageId,
      topicId,
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
      metadata: { seed_key: q.key, author: 'allingo-content', test: q.testCode, number: q.number },
      changeNote: q.changeNote,
      createdBy: ctx.adminId,
    })
    .returning({ id: catalogQuestionVersions.id });
  await db.update(catalogQuestions).set({ currentVersionId: version!.id }).where(eq(catalogQuestions.id, question!.id));
  await linkSubskill(db, ctx, question!.id, q.subskill);
  return question!.id;
}

async function linkSubskill(db: Db, ctx: SeedContext, questionId: string, subskill?: string): Promise<void> {
  if (!subskill || !ctx.subskillId.has(subskill)) return;
  await db
    .insert(catalogQuestionSubskills)
    .values({ questionId, subskillId: ctx.subskillId.get(subskill)!, weight: '1' })
    .onConflictDoNothing();
}

export interface SeedTestSetInput {
  code: string;
  title: { vi: string; en: string };
  kind: 'full' | 'part_drill' | 'mini' | 'diagnostic';
  durationSec: number;
  items: readonly SeedItem[];
  questionIdByKey: ReadonlyMap<string, string>;
  /** Thời lượng riêng từng section (NULL = đồng hồ chung của đề) */
  sectionDurationSec?: (sectionCode: string) => number | null;
  /** C1: chương trình (mặc định toeic) */
  program?: string;
  /** C3: catalog.test_sets.level – IELTS hình thức Reading (academic | general_training) */
  level?: string | null;
}

/** Tạo/cập nhật bộ đề đã phát hành: section theo thứ tự xuất hiện, item giữ group_key */
export async function upsertSeedTestSet(db: Db, ctx: SeedContext, input: SeedTestSetInput): Promise<string> {
  const [ts] = await db
    .insert(catalogTestSets)
    .values({
      programCode: input.program ?? 'toeic',
      code: input.code,
      title: input.title,
      kind: input.kind,
      isFree: true,
      durationSec: input.durationSec,
      level: input.level ?? null,
      status: 'published',
      publishedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [catalogTestSets.programCode, catalogTestSets.code],
      set: {
        title: sql`excluded.title`,
        kind: sql`excluded.kind`,
        durationSec: sql`excluded.duration_sec`,
        level: sql`excluded.level`,
        status: sql`excluded.status`,
      },
    })
    .returning({ id: catalogTestSets.id });
  const testSetId = ts!.id;
  const sectionCodes = [...new Set(input.items.map((i) => i.section))];
  await db.delete(catalogTestSetSections).where(eq(catalogTestSetSections.testSetId, testSetId));
  await db.insert(catalogTestSetSections).values(
    sectionCodes.map((code, i) => ({
      testSetId,
      sectionId: ctx.sectionId.get(code)!,
      sortOrder: i + 1,
      durationSec: input.sectionDurationSec ? input.sectionDurationSec(code) : null,
    })),
  );
  await db.delete(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, testSetId));
  await db.insert(catalogTestSetItems).values(
    input.items.map((it, i) => {
      const questionId = input.questionIdByKey.get(it.key);
      if (!questionId) throw new Error(`[seed:demo] ${input.code}: thiếu câu ${it.key}`);
      return {
        testSetId,
        questionId,
        sectionId: ctx.sectionId.get(it.section)!,
        sortOrder: i + 1,
        groupKey: it.group_key ?? null,
        points: '1',
      };
    }),
  );
  return testSetId;
}

export interface SeedMediaInput {
  /** Khoá ổn định, lưu ở `media_assets.checksum` dạng `seed:<key>` */
  key: string;
  kind: 'audio' | 'image';
  mimeType: string;
  createdBy: string;
  /** Nội dung nguồn (script TTS / SVG): đổi nội dung → asset quay về `uploading` để script media sinh lại */
  source: string;
  metadata: Record<string, unknown>;
  transcript?: unknown;
}

/**
 * Asset media cho nội dung seed (ADR-0025): tạo hàng `uploading` (chưa có tệp, catalog chưa phát URL); script API
 * `pnpm --filter @allingo/api seed:media` sinh TTS/ảnh, ghi tệp và chuyển `ready`. Idempotent theo checksum + hash nguồn.
 */
export async function ensureSeedMedia(db: Db, input: SeedMediaInput): Promise<string> {
  const checksum = `seed:${input.key}`;
  const sourceHash = sha256(input.source);
  const metadata = { ...input.metadata, seed: { key: input.key, source_hash: sourceHash } };
  const [row] = await db
    .select({ id: catalogMediaAssets.id, status: catalogMediaAssets.status, metadata: catalogMediaAssets.metadata })
    .from(catalogMediaAssets)
    .where(eq(catalogMediaAssets.checksum, checksum))
    .limit(1);
  if (!row) {
    const [created] = await db
      .insert(catalogMediaAssets)
      .values({
        kind: input.kind,
        mimeType: input.mimeType,
        license: 'own',
        checksum,
        createdBy: input.createdBy,
        status: 'uploading',
        metadata,
        transcript: input.transcript ?? null,
      })
      .returning({ id: catalogMediaAssets.id });
    return created!.id;
  }
  const prevHash = (row.metadata as { seed?: { source_hash?: string } } | null)?.seed?.source_hash;
  if (prevHash !== sourceHash) {
    // Nguồn đổi → sinh lại (giữ id để các câu đang trỏ tới không đổi)
    await db
      .update(catalogMediaAssets)
      .set({ status: 'uploading', storageKey: null, durationMs: null, metadata, transcript: input.transcript ?? null })
      .where(eq(catalogMediaAssets.id, row.id));
  }
  return row.id;
}
