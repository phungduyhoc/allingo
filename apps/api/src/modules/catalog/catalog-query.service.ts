import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { questionContentSchema, toPublicContent, type LocalizedText, type ProgramCode, type QuestionContent, type QuestionPublic, type QuestionTypeCode } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { StorageService } from '../../shared/storage/storage.module.js';
import { NotFound } from '../../shared/http/errors.js';

const { catalogPrograms, catalogSections, catalogSkills, catalogTestSets, catalogTestSetItems, catalogTestSetSections, catalogQuestions, catalogQuestionVersions, catalogPassages, catalogMediaAssets, catalogQuestionSubskills, catalogSubskills, catalogTopics } = schema;

/** Câu hỏi đầy đủ (có answer_key) – chỉ dùng nội bộ server (test-engine chấm, ai-gateway giải thích) */
export interface LoadedQuestion {
  question_id: string;
  question_version_id: string;
  question_type: QuestionTypeCode;
  section_id: string;
  section_code: string;
  skill_code: string;
  group_key: string | null;
  order_no: number;
  points: number;
  content: QuestionContent;
  passage: { id: string; kind: string; title: string | null; body: string | null; media_asset_id: string | null } | null;
  topic_code: string | null;
  subskill_codes: string[];
  exposure_count: number;
  correct_count: number;
}

export interface SectionRow {
  id: string;
  code: string;
  skill: string;
  name: LocalizedText;
  level: string | null;
  duration_sec: number | null;
  question_count: number | null;
  rules: Record<string, unknown>;
  sort_order: number;
}

@Injectable()
export class CatalogQueryService {
  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  async programs() {
    const rows = await this.dbs.db.select().from(catalogPrograms).where(eq(catalogPrograms.isActive, true)).orderBy(catalogPrograms.sortOrder);
    return rows.map((r) => ({ code: r.code as ProgramCode, name: r.name, score_scale: (r.scoreScale as Record<string, unknown>) ?? {}, languages: r.languages }));
  }

  async sections(program: string, level?: string): Promise<SectionRow[]> {
    const rows = await this.dbs.db
      .select({ s: catalogSections, skill: catalogSkills.code })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(and(eq(catalogSections.programCode, program), level ? eq(catalogSections.level, level) : sql`true`))
      .orderBy(catalogSections.sortOrder);
    return rows.map((r) => ({ id: r.s.id, code: r.s.code, skill: r.skill, name: r.s.name, level: r.s.level ?? null, duration_sec: r.s.durationSec ?? null, question_count: r.s.questionCount ?? null, rules: (r.s.rules as Record<string, unknown>) ?? {}, sort_order: r.s.sortOrder }));
  }

  async sectionByCode(program: string, code: string, db: DbOrTx = this.dbs.db) {
    const [row] = await db
      .select({ s: catalogSections, skill: catalogSkills.code })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(and(eq(catalogSections.programCode, program), eq(catalogSections.code, code)))
      .limit(1);
    return row ? { ...row.s, skillCode: row.skill } : null;
  }

  async sectionById(id: string) {
    const [row] = await this.dbs.db
      .select({ s: catalogSections, skill: catalogSkills.code })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogSections.id, id))
      .limit(1);
    return row ? { ...row.s, skillCode: row.skill } : null;
  }

  /** Danh sách đề đã phát hành của chương trình (cursor theo published_at desc, id) */
  async testSets(program: string, opts: { kind?: string; level?: string; limit: number; cursorId?: string | null }) {
    const rows = await this.dbs.db
      .select({ ts: catalogTestSets, count: sql<number>`(select count(*) from catalog.test_set_items i where i.test_set_id = ${catalogTestSets.id})`.mapWith(Number) })
      .from(catalogTestSets)
      .where(
        and(
          eq(catalogTestSets.programCode, program),
          eq(catalogTestSets.status, 'published'),
          opts.kind ? eq(catalogTestSets.kind, opts.kind as never) : sql`true`,
          opts.level ? eq(catalogTestSets.level, opts.level) : sql`true`,
          opts.cursorId ? sql`${catalogTestSets.id} > ${opts.cursorId}` : sql`true`,
        ),
      )
      .orderBy(asc(catalogTestSets.id))
      .limit(opts.limit + 1);
    return rows;
  }

  async testSetById(id: string) {
    const [row] = await this.dbs.db
      .select({ ts: catalogTestSets, count: sql<number>`(select count(*) from catalog.test_set_items i where i.test_set_id = ${catalogTestSets.id})`.mapWith(Number) })
      .from(catalogTestSets)
      .where(eq(catalogTestSets.id, id))
      .limit(1);
    return row ?? null;
  }

  async testSetSections(testSetId: string): Promise<Array<SectionRow & { test_duration_sec: number | null }>> {
    const rows = await this.dbs.db
      .select({ s: catalogSections, skill: catalogSkills.code, tss: catalogTestSetSections })
      .from(catalogTestSetSections)
      .innerJoin(catalogSections, eq(catalogSections.id, catalogTestSetSections.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogTestSetSections.testSetId, testSetId))
      .orderBy(catalogTestSetSections.sortOrder);
    return rows.map((r) => ({ id: r.s.id, code: r.s.code, skill: r.skill, name: r.s.name, level: r.s.level ?? null, duration_sec: r.s.durationSec ?? null, question_count: r.s.questionCount ?? null, rules: (r.s.rules as Record<string, unknown>) ?? {}, sort_order: r.s.sortOrder, test_duration_sec: r.tss.durationSec ?? null }));
  }

  /** Toàn bộ câu hỏi (bản hiện hành) của đề theo thứ tự – dùng khi tạo attempt */
  async loadTestSetQuestions(testSetId: string, db: DbOrTx = this.dbs.db): Promise<LoadedQuestion[]> {
    const rows = await db
      .select({ item: catalogTestSetItems, q: catalogQuestions, v: catalogQuestionVersions, s: catalogSections, skill: catalogSkills.code, p: catalogPassages, topic: catalogTopics.code })
      .from(catalogTestSetItems)
      .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogTestSetItems.questionId))
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogTestSetItems.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(eq(catalogTestSetItems.testSetId, testSetId))
      .orderBy(catalogSections.sortOrder, catalogTestSetItems.sortOrder);
    const subskills = await this.subskillsFor(rows.map((r) => r.q.id), db);
    return rows.map((r, i) => this.toLoaded(r.q, r.v, { id: r.s.id, code: r.s.code, skill: r.skill }, r.p, r.topic, subskills.get(r.q.id) ?? [], { group_key: r.item.groupKey ?? null, order_no: i + 1, points: Number(r.item.points) }));
  }

  /** Cache trong tiến trình: question_version_id → question_type (phiên bản bất biến nên không cần vô hiệu) */
  private readonly versionTypeCache = new Map<string, string>();

  /** Dạng câu theo phiên bản – nhẹ, dùng khi lưu nháp (kiểm tra kiểu câu trả lời) thay vì nạp đầy đủ câu hỏi */
  async questionTypesByVersion(versionIds: string[], db: DbOrTx = this.dbs.db): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const id of versionIds) {
      const t = this.versionTypeCache.get(id);
      if (t) out.set(id, t);
      else missing.push(id);
    }
    if (missing.length) {
      const rows = await db
        .select({ id: catalogQuestionVersions.id, type: catalogQuestions.questionTypeCode })
        .from(catalogQuestionVersions)
        .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
        .where(inArray(catalogQuestionVersions.id, missing));
      for (const r of rows) {
        out.set(r.id, r.type);
        if (this.versionTypeCache.size > 50_000) this.versionTypeCache.clear();
        this.versionTypeCache.set(r.id, r.type);
      }
    }
    return out;
  }

  /** Nạp theo question_version_id (review/explain) */
  async loadByVersionIds(versionIds: string[], db: DbOrTx = this.dbs.db): Promise<Map<string, LoadedQuestion>> {
    if (versionIds.length === 0) return new Map();
    const rows = await db
      .select({ q: catalogQuestions, v: catalogQuestionVersions, s: catalogSections, skill: catalogSkills.code, p: catalogPassages, topic: catalogTopics.code })
      .from(catalogQuestionVersions)
      .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(inArray(catalogQuestionVersions.id, versionIds));
    const subskills = await this.subskillsFor(rows.map((r) => r.q.id), db);
    const out = new Map<string, LoadedQuestion>();
    for (const r of rows) out.set(r.v.id, this.toLoaded(r.q, r.v, { id: r.s.id, code: r.s.code, skill: r.skill }, r.p, r.topic, subskills.get(r.q.id) ?? [], { group_key: null, order_no: 0, points: 1 }));
    return out;
  }

  /** Câu ngẫu nhiên đã phát hành theo bộ lọc (practice/drill) */
  async randomQuestions(program: string, filter: { section_code?: string; question_type?: string; topic?: string; subskill?: string; count: number; excludeQuestionIds?: string[]; onlyQuestionIds?: string[] }): Promise<LoadedQuestion[]> {
    if (filter.onlyQuestionIds && filter.onlyQuestionIds.length === 0) return [];
    const rows = await this.dbs.db
      .select({ q: catalogQuestions, v: catalogQuestionVersions, s: catalogSections, skill: catalogSkills.code, p: catalogPassages, topic: catalogTopics.code })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(
        and(
          eq(catalogQuestions.programCode, program),
          eq(catalogQuestions.status, 'published'),
          filter.section_code ? eq(catalogSections.code, filter.section_code) : sql`true`,
          filter.question_type ? eq(catalogQuestions.questionTypeCode, filter.question_type) : sql`true`,
          filter.topic ? eq(catalogTopics.code, filter.topic) : sql`true`,
          filter.subskill ? sql`exists (select 1 from catalog.question_subskills qs join catalog.subskills ss on ss.id = qs.subskill_id where qs.question_id = ${catalogQuestions.id} and ss.code = ${filter.subskill})` : sql`true`,
          filter.excludeQuestionIds?.length ? sql`${catalogQuestions.id} <> all(${filter.excludeQuestionIds}::uuid[])` : sql`true`,
          filter.onlyQuestionIds?.length ? inArray(catalogQuestions.id, filter.onlyQuestionIds) : sql`true`,
        ),
      )
      .orderBy(sql`random()`)
      .limit(filter.count);
    const subskills = await this.subskillsFor(rows.map((r) => r.q.id));
    return rows.map((r, i) => this.toLoaded(r.q, r.v, { id: r.s.id, code: r.s.code, skill: r.skill }, r.p, r.topic, subskills.get(r.q.id) ?? [], { group_key: null, order_no: i + 1, points: 1 }));
  }

  private async subskillsFor(questionIds: string[], db: DbOrTx = this.dbs.db): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (questionIds.length === 0) return map;
    const rows = await db
      .select({ qid: catalogQuestionSubskills.questionId, code: catalogSubskills.code })
      .from(catalogQuestionSubskills)
      .innerJoin(catalogSubskills, eq(catalogSubskills.id, catalogQuestionSubskills.subskillId))
      .where(inArray(catalogQuestionSubskills.questionId, questionIds));
    for (const r of rows) map.set(r.qid, [...(map.get(r.qid) ?? []), r.code]);
    return map;
  }

  private toLoaded(
    q: typeof catalogQuestions.$inferSelect,
    v: typeof catalogQuestionVersions.$inferSelect,
    s: { id: string; code: string; skill: string },
    p: typeof catalogPassages.$inferSelect | null,
    topic: string | null,
    subskills: string[],
    item: { group_key: string | null; order_no: number; points: number },
  ): LoadedQuestion {
    const parsed = questionContentSchema.safeParse(v.content);
    if (!parsed.success) throw new Error(`question_version ${v.id} có content không hợp lệ: ${parsed.error.issues[0]?.message}`);
    return {
      question_id: q.id,
      question_version_id: v.id,
      question_type: parsed.data.type,
      section_id: s.id,
      section_code: s.code,
      skill_code: s.skill,
      group_key: item.group_key,
      order_no: item.order_no,
      points: item.points,
      content: parsed.data,
      passage: p ? { id: p.id, kind: p.kind, title: p.title ?? null, body: p.body ?? null, media_asset_id: p.mediaAssetId ?? null } : null,
      topic_code: topic,
      subskill_codes: subskills,
      exposure_count: q.exposureCount,
      correct_count: q.correctCount,
    };
  }

  /** URL media (presigned/external) cho các asset id */
  async mediaUrls(assetIds: string[]): Promise<Map<string, { id: string; kind: string; url: string; duration_ms: number | null }>> {
    const out = new Map<string, { id: string; kind: string; url: string; duration_ms: number | null }>();
    const ids = [...new Set(assetIds.filter(Boolean))];
    if (ids.length === 0) return out;
    // Chỉ phát asset đã xử lý xong (uploading/processing/failed → không trả URL)
    const rows = await this.dbs.db.select().from(catalogMediaAssets).where(and(inArray(catalogMediaAssets.id, ids), eq(catalogMediaAssets.status, 'ready')));
    for (const m of rows) {
      let url = m.externalUrl ?? '';
      if (!url && m.storageKey) {
        try {
          url = await this.storage.presignGet('media', m.storageKey);
        } catch {
          url = '';
        }
      }
      out.set(m.id, { id: m.id, kind: m.kind, url, duration_ms: m.durationMs ?? null });
    }
    return out;
  }

  /** Chuyển LoadedQuestion → QuestionPublic (không answer_key) + media URL */
  async toPublic(questions: LoadedQuestion[]): Promise<QuestionPublic[]> {
    const assetIds: string[] = [];
    for (const q of questions) {
      const m = q.content.media;
      if (m?.audio_asset_id) assetIds.push(m.audio_asset_id);
      if (m?.image_asset_id) assetIds.push(m.image_asset_id);
      if ('image_asset_id' in q.content && q.content.image_asset_id) assetIds.push(q.content.image_asset_id);
      if (q.passage?.media_asset_id) assetIds.push(q.passage.media_asset_id);
    }
    const urls = await this.mediaUrls(assetIds);
    return questions.map((q) => {
      const media: QuestionPublic['media'] = [];
      const push = (id?: string) => {
        if (id && urls.has(id)) media.push(urls.get(id)!);
      };
      push(q.content.media?.audio_asset_id);
      push(q.content.media?.image_asset_id);
      if ('image_asset_id' in q.content) push(q.content.image_asset_id);
      return {
        question_id: q.question_id,
        question_version_id: q.question_version_id,
        question_type: q.question_type,
        section_code: q.section_code,
        group_key: q.group_key,
        order_no: q.order_no,
        content: toPublicContent(q.content),
        media,
        passage: q.passage ? { id: q.passage.id, kind: q.passage.kind, title: q.passage.title, body: q.passage.body, media_url: q.passage.media_asset_id ? (urls.get(q.passage.media_asset_id)?.url ?? null) : null } : null,
      };
    });
  }

  /** Cập nhật thống kê exposure/correct sau khi chấm (gọi trong transaction submit) */
  async bumpQuestionStats(tx: DbOrTx, updates: Array<{ question_id: string; correct: boolean; time_ms: number | null }>): Promise<void> {
    for (const u of updates) {
      await tx
        .update(catalogQuestions)
        .set({
          exposureCount: sql`${catalogQuestions.exposureCount} + 1`,
          correctCount: sql`${catalogQuestions.correctCount} + ${u.correct ? 1 : 0}`,
          avgTimeMs: u.time_ms !== null ? sql`coalesce((${catalogQuestions.avgTimeMs} * ${catalogQuestions.exposureCount} + ${u.time_ms}) / (${catalogQuestions.exposureCount} + 1), ${u.time_ms})` : catalogQuestions.avgTimeMs,
        })
        .where(eq(catalogQuestions.id, u.question_id));
    }
  }

  async requireTestSetPublished(id: string) {
    const row = await this.testSetById(id);
    if (!row || row.ts.status !== 'published') throw new NotFound('test_set', id);
    return row;
  }

  async lessons(program: string) {
    return this.dbs.db.select().from(schema.catalogLessons).where(and(eq(schema.catalogLessons.programCode, program), eq(schema.catalogLessons.status, 'published'))).orderBy(schema.catalogLessons.sortOrder);
  }

  async lessonWithSteps(id: string) {
    const [lesson] = await this.dbs.db.select().from(schema.catalogLessons).where(eq(schema.catalogLessons.id, id)).limit(1);
    if (!lesson) return null;
    const steps = await this.dbs.db.select().from(schema.catalogLessonSteps).where(eq(schema.catalogLessonSteps.lessonId, id)).orderBy(schema.catalogLessonSteps.sortOrder);
    return { lesson, steps };
  }

  async vocabLists(program: string) {
    return this.dbs.db.select().from(schema.catalogVocabLists).where(eq(schema.catalogVocabLists.programCode, program)).orderBy(schema.catalogVocabLists.sortOrder);
  }

  async vocabListItems(listId: string) {
    return this.dbs.db
      .select({ item: schema.catalogVocabItems, sort: schema.catalogVocabListItems.sortOrder })
      .from(schema.catalogVocabListItems)
      .innerJoin(schema.catalogVocabItems, eq(schema.catalogVocabItems.id, schema.catalogVocabListItems.vocabItemId))
      .where(eq(schema.catalogVocabListItems.listId, listId))
      .orderBy(schema.catalogVocabListItems.sortOrder);
  }


}
