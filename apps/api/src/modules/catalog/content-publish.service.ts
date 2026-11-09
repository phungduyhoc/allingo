import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, contentRoleOf, localizedTextSchema, markCount, programCodeSchema, programDef, questionContentSchema, runTestSetChecks, validateTestSetStructure, type SectionSpec, type StructureReport, type TestSetCheckResult, type TestSetKind } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { AppError, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';

const { catalogQuestions, catalogQuestionVersions, catalogPassages, catalogSections, catalogTopics, catalogSubskills, catalogTestSets, catalogTestSetItems, catalogTestSetSections, catalogSkills } = schema;

export const publishTestSetSchema = z.object({
  external_ref: z.string().min(1).max(128),
  program: programCodeSchema,
  code: z.string().min(1).max(64),
  title: localizedTextSchema,
  kind: z.enum(['full', 'mini', 'part_drill', 'diagnostic', 'topic_pack']),
  is_free: z.boolean().default(true),
  duration_sec: z.number().int().positive().nullable().default(null),
  level: z.string().max(16).optional(),
  sections: z.array(z.object({ section_code: z.string(), duration_sec: z.number().int().positive().nullable().optional() })).min(1),
  items: z.array(z.object({ question_external_ref: z.string(), section_code: z.string(), sort_order: z.number().int(), group_key: z.string().nullable().optional(), points: z.number().positive().default(1) })).min(1),
});
export type PublishTestSetInput = z.infer<typeof publishTestSetSchema>;

/** C3: số mục đánh số của nội dung câu (IELTS đếm cấu trúc đề theo mục) – nội dung lỗi/không đọc được tính 1 */
const marksOfRaw = (raw: unknown): number => {
  const p = questionContentSchema.safeParse(raw);
  return p.success ? markCount(p.data) : 1;
};
const markingOf = (program: string) => programDef(program)?.marking ?? 'per_question';

/** Báo cáo cấu trúc + kiểm tra cấp bộ đề (C3 – `runTestSetChecks`) */
export type TestSetReport = StructureReport & { checks: TestSetCheckResult[] };

interface CheckedItem {
  ref: string;
  section_code: string;
  sort_order: number;
  group_key: string | null;
  /** nội dung câu (bản hiện hành) – null khi không tìm thấy */
  content: unknown;
  passage_media: string | null;
}

/** Audio của câu: audio riêng trong nội dung hoặc audio của passage (part Listening) */
const audioKeyOf = (content: unknown, passageMedia: string | null): string | null => {
  const p = questionContentSchema.safeParse(content);
  return (p.success ? (p.data.media?.audio_asset_id ?? null) : null) ?? passageMedia;
};

/**
 * Cấu trúc (`validateTestSetStructure` – đếm theo mục với chương trình per_item) + kiểm tra cấp bộ đề (`runTestSetChecks`: đánh số
 * liên tục, IELTS đúng 40 câu hỏi mỗi kỹ năng/từng part, part Listening có audio). Lỗi của kiểm tra cấp bộ đề chỉ CHẶN phát hành với
 * chương trình đếm theo mục (IELTS – C3); chương trình khác chỉ trả để tham khảo (giữ hành vi TOEIC trước C3).
 */
function checkTestSet(program: string, kind: TestSetKind, sections: readonly SectionSpec[], items: readonly CheckedItem[]): TestSetReport {
  const marking = markingOf(program);
  const structure = validateTestSetStructure(
    kind,
    sections,
    items.map((i) => ({ question_ref: i.ref, section_code: i.section_code, sort_order: i.sort_order, group_key: i.group_key, marks: i.content === null ? undefined : marksOfRaw(i.content) })),
    { marking },
  );
  const checks = runTestSetChecks({
    program,
    kind,
    sections,
    items: items.map((i) => {
      const audio = audioKeyOf(i.content, i.passage_media);
      return { section_code: i.section_code, sort_order: i.sort_order, group_key: i.group_key, marks: i.content === null ? null : marksOfRaw(i.content), has_audio: !!audio, audio_key: audio };
    }),
  });
  const blocking = marking === 'per_item' && checks.some((c) => c.level === 'error');
  return { ...structure, ok: structure.ok && !blocking, checks };
}

const reportIssues = (r: TestSetReport) => [
  ...r.issues.map((i) => ({ path: `items${i.section ? `.${i.section}` : ''}`, message: i.message, code: i.code })),
  ...r.checks.filter((c) => c.level === 'error').map((c) => ({ path: `items${c.params?.section ? `.${c.params.section}` : ''}`, message: c.code, code: c.code, params: c.params ?? {} })),
];

/**
 * Phát hành bộ đề từ CMS vào catalog (ADR-0019/0024). Idempotent theo test_sets(program, code).
 * Câu hỏi đi qua ContentWorkflowService (đồng bộ mọi trạng thái). Bộ đề phải đạt kiểm tra cấu trúc trước khi phát hành.
 */
@Injectable()
export class ContentPublishService {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * B2 – phát hành đề NHÁP trong catalog (vd. đề AI soạn nháp sau khi các câu đã duyệt xong): teacher/admin; mọi câu phải `published`,
   * cấu trúc đạt `validateTestSetStructure(kind)` → status published + outbox content.published + audit. Đề đã phát hành → 409.
   */
  async publishDraft(actor: { id: string; roles: string[] }, testSetId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const role = contentRoleOf(actor.roles);
    if (role !== 'teacher' && role !== 'admin') throw new Forbidden('Only teacher/admin can publish test sets', { required: ['teacher', 'admin'] });
    const [ts] = await this.dbs.db.select().from(catalogTestSets).where(eq(catalogTestSets.id, testSetId)).limit(1);
    if (!ts) throw new NotFound('test_set', testSetId);
    if (ts.status === 'published') throw new AppError('conflict', 'Test set already published', 409, { reason: 'already_published' });
    const items = await this.dbs.db
      .select({ questionId: catalogTestSetItems.questionId, sortOrder: catalogTestSetItems.sortOrder, groupKey: catalogTestSetItems.groupKey, status: catalogQuestions.status, sectionCode: catalogSections.code, content: catalogQuestionVersions.content, passageMedia: catalogPassages.mediaAssetId })
      .from(catalogTestSetItems)
      .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogTestSetItems.questionId))
      .leftJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogTestSetItems.sectionId))
      .where(eq(catalogTestSetItems.testSetId, testSetId));
    const unpublished = items.filter((i) => i.status !== 'published');
    if (unpublished.length) throw new AppError('conflict', `${unpublished.length} question(s) are not published yet`, 409, { reason: 'unpublished_items', count: unpublished.length, question_ids: unpublished.slice(0, 20).map((u) => u.questionId) });
    const sections = await this.dbs.db
      .select({ code: catalogSections.code, skill: catalogSkills.code, questionCount: catalogSections.questionCount, sortOrder: catalogSections.sortOrder })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogSections.programCode, ts.programCode));
    const structure = checkTestSet(
      ts.programCode,
      ts.kind,
      sections.map((x) => ({ code: x.code, skill: x.skill, question_count: x.questionCount ?? null, sort_order: x.sortOrder })),
      items.map((i) => ({ ref: i.questionId, section_code: i.sectionCode, sort_order: i.sortOrder, group_key: i.groupKey ?? null, content: i.content ?? null, passage_media: i.passageMedia ?? null })),
    );
    if (!structure.ok) throw new ValidationFailed({ issues: reportIssues(structure), structure });
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(catalogTestSets).set({ status: 'published', publishedAt: new Date() }).where(eq(catalogTestSets.id, testSetId));
      await this.outbox.write(tx, { aggregateType: 'test_set', aggregateId: testSetId, eventType: DOMAIN_EVENTS.CONTENT_PUBLISHED, payload: { entity: 'test_set', test_set_id: testSetId, program: ts.programCode, code: ts.code } });
      await this.audit.log({ action: 'test_set.published', actorUserId: actor.id, actorRole: role, entityType: 'test_set', entityId: testSetId, after: { code: ts.code, items: items.length }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
    });
    return { test_set_id: testSetId, code: ts.code, status: 'published' as const, structure };
  }

  /** Kiểm tra cấu trúc (TOEIC L&R: Part 1–7 đúng số câu với đề full) – dùng cho test set builder và trước khi phát hành */
  async validateTestSet(input: Pick<PublishTestSetInput, 'program' | 'kind' | 'items'>): Promise<TestSetReport> {
    const sections = await this.dbs.db
      .select({ code: catalogSections.code, skill: catalogSkills.code, questionCount: catalogSections.questionCount, sortOrder: catalogSections.sortOrder })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogSections.programCode, input.program));
    // C3: nội dung câu (số mục) + audio của câu/passage theo external_ref – bản mới nhất thắng
    const byRef = new Map<string, { content: unknown; passage_media: string | null }>();
    if (input.items.length) {
      const rows = await this.dbs.db
        .select({ ref: sql<string>`${catalogQuestionVersions.metadata} ->> 'external_ref'`, content: catalogQuestionVersions.content, passageMedia: catalogPassages.mediaAssetId })
        .from(catalogQuestionVersions)
        .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
        .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
        .where(inArray(sql`${catalogQuestionVersions.metadata} ->> 'external_ref'`, input.items.map((i) => i.question_external_ref)))
        .orderBy(catalogQuestionVersions.createdAt);
      for (const r of rows) byRef.set(r.ref, { content: r.content, passage_media: r.passageMedia ?? null });
    }
    return checkTestSet(
      input.program,
      input.kind,
      sections.map((s) => ({ code: s.code, skill: s.skill, question_count: s.questionCount ?? null, sort_order: s.sortOrder })),
      input.items.map((i) => ({ ref: i.question_external_ref, section_code: i.section_code, sort_order: i.sort_order, group_key: i.group_key ?? null, content: byRef.get(i.question_external_ref)?.content ?? null, passage_media: byRef.get(i.question_external_ref)?.passage_media ?? null })),
    );
  }

  async publishTestSet(input: PublishTestSetInput): Promise<{ test_set_id: string; structure: TestSetReport }> {
    const structure = await this.validateTestSet(input);
    if (!structure.ok) throw new ValidationFailed({ issues: reportIssues(structure), structure });
    return this.dbs.db.transaction(async (tx) => {
      const sections = await tx.select({ id: catalogSections.id, code: catalogSections.code }).from(catalogSections).where(eq(catalogSections.programCode, input.program));
      const sectionId = new Map(sections.map((s) => [s.code, s.id]));
      for (const s of input.sections) if (!sectionId.has(s.section_code)) throw new NotFound('section', s.section_code);

      const refs = input.items.map((i) => i.question_external_ref);
      const qrows = await tx
        .select({ ref: sql<string>`${catalogQuestionVersions.metadata} ->> 'external_ref'`, questionId: catalogQuestionVersions.questionId })
        .from(catalogQuestionVersions)
        .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
        .where(and(inArray(sql`${catalogQuestionVersions.metadata} ->> 'external_ref'`, refs), eq(catalogQuestions.status, 'published')));
      const questionId = new Map(qrows.map((r) => [r.ref, r.questionId]));
      const missing = refs.filter((r) => !questionId.has(r));
      if (missing.length) throw new ValidationFailed({ issues: missing.map((m) => ({ path: 'items', message: `question ${m} chưa phát hành` })) });

      const [ts] = await tx
        .insert(catalogTestSets)
        .values({ programCode: input.program, code: input.code, title: input.title, kind: input.kind, level: input.level ?? null, isFree: input.is_free, durationSec: input.duration_sec, status: 'published', publishedAt: new Date() })
        .onConflictDoUpdate({ target: [catalogTestSets.programCode, catalogTestSets.code], set: { title: input.title, kind: input.kind, level: input.level ?? null, isFree: input.is_free, durationSec: input.duration_sec, status: 'published', publishedAt: new Date() } })
        .returning({ id: catalogTestSets.id });
      const testSetId = ts!.id;
      await tx.delete(catalogTestSetSections).where(eq(catalogTestSetSections.testSetId, testSetId));
      await tx.insert(catalogTestSetSections).values(input.sections.map((s, i) => ({ testSetId, sectionId: sectionId.get(s.section_code)!, sortOrder: i + 1, durationSec: s.duration_sec ?? null })));
      await tx.delete(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, testSetId));
      await tx.insert(catalogTestSetItems).values(input.items.map((i) => ({ testSetId, questionId: questionId.get(i.question_external_ref)!, sectionId: sectionId.get(i.section_code)!, sortOrder: i.sort_order, groupKey: i.group_key ?? null, points: String(i.points) })));
      await this.outbox.write(tx, { aggregateType: 'test_set', aggregateId: testSetId, eventType: DOMAIN_EVENTS.CONTENT_PUBLISHED, payload: { entity: 'test_set', test_set_id: testSetId, program: input.program, code: input.code } });
      return { test_set_id: testSetId, structure };
    });
  }

  async reference() {
    const [programs, sections, topics, subskills, qtypes] = await Promise.all([
      this.dbs.db.select({ code: schema.catalogPrograms.code, name: schema.catalogPrograms.name }).from(schema.catalogPrograms).orderBy(schema.catalogPrograms.sortOrder),
      this.dbs.db.select({ program: catalogSections.programCode, code: catalogSections.code, name: catalogSections.name, level: catalogSections.level }).from(catalogSections).orderBy(catalogSections.programCode, catalogSections.sortOrder),
      this.dbs.db.select({ code: catalogTopics.code, name: catalogTopics.name }).from(catalogTopics),
      this.dbs.db.select({ program: catalogSubskills.programCode, code: catalogSubskills.code, name: catalogSubskills.name }).from(catalogSubskills),
      this.dbs.db.select({ code: schema.catalogQuestionTypes.code, name: schema.catalogQuestionTypes.name }).from(schema.catalogQuestionTypes),
    ]);
    return { programs, sections, topics, subskills, question_types: qtypes };
  }
}
