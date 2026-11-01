import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, localizedTextSchema, programCodeSchema, questionContentSchema, questionTypeCodeSchema } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { NotFound, ValidationFailed } from '../../shared/http/errors.js';

const { catalogQuestions, catalogQuestionVersions, catalogSections, catalogTopics, catalogSubskills, catalogQuestionSubskills, catalogTestSets, catalogTestSetItems, catalogTestSetSections } = schema;

export const publishQuestionSchema = z.object({
  external_ref: z.string().min(1).max(128),
  program: programCodeSchema,
  section_code: z.string().min(1).max(32),
  question_type: questionTypeCodeSchema,
  content: questionContentSchema,
  difficulty: z.string().max(10).optional(),
  topic_code: z.string().max(64).optional(),
  subskill_codes: z.array(z.string().max(64)).max(10).optional(),
  source: z.enum(['human', 'ai', 'licensed']).default('human'),
  change_note: z.string().max(500).optional(),
  created_by_email: z.string().max(254).optional(),
});
export type PublishQuestionInput = z.infer<typeof publishQuestionSchema>;

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

/**
 * Phát hành nội dung từ CMS vào catalog (ADR-0019). Idempotent theo external_ref (lưu trong question_versions.metadata.external_ref
 * và test_sets.code). Sửa nội dung đã phát hành → version mới; attempt cũ vẫn trỏ version cũ (CLAUDE.md §5.9).
 */
@Injectable()
export class ContentPublishService {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
  ) {}

  async publishQuestion(input: PublishQuestionInput): Promise<{ question_id: string; question_version_id: string; version_no: number; changed: boolean }> {
    if (input.content.type !== input.question_type) throw new ValidationFailed({ issues: [{ path: 'content.type', message: 'content.type must match question_type' }] });
    return this.dbs.db.transaction(async (tx) => {
      const [section] = await tx.select({ id: catalogSections.id }).from(catalogSections).where(and(eq(catalogSections.programCode, input.program), eq(catalogSections.code, input.section_code))).limit(1);
      if (!section) throw new NotFound('section', input.section_code);
      const topic = input.topic_code ? (await tx.select({ id: catalogTopics.id }).from(catalogTopics).where(eq(catalogTopics.code, input.topic_code)).limit(1))[0] : undefined;

      const [existing] = await tx
        .select({ questionId: catalogQuestionVersions.questionId, versionId: catalogQuestionVersions.id, versionNo: catalogQuestionVersions.versionNo, content: catalogQuestionVersions.content })
        .from(catalogQuestionVersions)
        .where(sql`${catalogQuestionVersions.metadata} ->> 'external_ref' = ${input.external_ref}`)
        .orderBy(sql`${catalogQuestionVersions.versionNo} desc`)
        .limit(1);

      let questionId: string;
      let versionNo = 1;
      if (existing) {
        questionId = existing.questionId;
        if (JSON.stringify(existing.content) === JSON.stringify(input.content)) {
          await tx.update(catalogQuestions).set({ status: 'published', updatedAt: new Date(), retiredAt: null }).where(eq(catalogQuestions.id, questionId));
          return { question_id: questionId, question_version_id: existing.versionId, version_no: existing.versionNo, changed: false };
        }
        versionNo = existing.versionNo + 1;
      } else {
        const [q] = await tx
          .insert(catalogQuestions)
          .values({ programCode: input.program, sectionId: section.id, questionTypeCode: input.question_type, topicId: topic?.id ?? null, status: 'published', source: input.source, difficultyTarget: (input.difficulty as never) ?? null })
          .returning({ id: catalogQuestions.id });
        questionId = q!.id;
      }
      const [version] = await tx
        .insert(catalogQuestionVersions)
        .values({ questionId, versionNo, content: input.content, metadata: { external_ref: input.external_ref, source: 'cms', created_by_email: input.created_by_email ?? null }, changeNote: input.change_note ?? null })
        .returning({ id: catalogQuestionVersions.id });
      await tx
        .update(catalogQuestions)
        .set({ currentVersionId: version!.id, status: 'published', sectionId: section.id, questionTypeCode: input.question_type, topicId: topic?.id ?? null, difficultyTarget: (input.difficulty as never) ?? null, updatedAt: new Date(), retiredAt: null })
        .where(eq(catalogQuestions.id, questionId));
      if (input.subskill_codes?.length) {
        await tx.delete(catalogQuestionSubskills).where(eq(catalogQuestionSubskills.questionId, questionId));
        const subs = await tx.select({ id: catalogSubskills.id, code: catalogSubskills.code }).from(catalogSubskills).where(and(eq(catalogSubskills.programCode, input.program), inArray(catalogSubskills.code, input.subskill_codes)));
        for (const s of subs) await tx.insert(catalogQuestionSubskills).values({ questionId, subskillId: s.id, weight: '1' }).onConflictDoNothing();
      }
      await this.outbox.write(tx, { aggregateType: 'question', aggregateId: questionId, eventType: DOMAIN_EVENTS.CONTENT_PUBLISHED, payload: { entity: 'question', question_id: questionId, question_version_id: version!.id, version_no: versionNo, program: input.program } });
      return { question_id: questionId, question_version_id: version!.id, version_no: versionNo, changed: true };
    });
  }

  async publishTestSet(input: PublishTestSetInput): Promise<{ test_set_id: string }> {
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
      return { test_set_id: testSetId };
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
