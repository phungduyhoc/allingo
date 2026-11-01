import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { FEATURE_CODES, pageSchema, programCodeSchema, programSchema, sectionSchema, testSetListQuerySchema, testSetSchema, testSetSummarySchema, type TestSetSummary } from '@allingo/schemas';
import { CurrentUser, Public, type AuthUser } from '../../shared/auth/auth.guard.js';
import { DbService } from '../../shared/db/db.module.js';
import { NotFound } from '../../shared/http/errors.js';
import { encodeCursor, decodeCursor } from '../../shared/http/cursor.js';
import { ApiZod, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { EntitlementService } from '../billing/index.js';
import { CatalogQueryService } from './catalog-query.service.js';

const programParam = z.object({ program: programCodeSchema });
const levelQuery = z.object({ level: z.string().max(16).optional() });
const idParam = z.object({ testSetId: z.uuid() });
const lessonParam = z.object({ lessonId: z.uuid() });
const listParam = z.object({ listId: z.uuid() });
const programQuery = z.object({ program: programCodeSchema.default('toeic') });

@ApiTags('Catalog')
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogQueryService,
    private readonly entitlements: EntitlementService,
    private readonly dbs: DbService,
  ) {}

  @Public()
  @Get('programs')
  @ApiZod({ responses: { 200: z.array(programSchema) } })
  programs() {
    return this.catalog.programs();
  }

  @Public()
  @Get('programs/:program/sections')
  @ApiZod({ query: levelQuery, responses: { 200: z.array(sectionSchema) } })
  sections(@ZodParams(programParam) p: z.infer<typeof programParam>, @ZodQuery(levelQuery) q: z.infer<typeof levelQuery>) {
    return this.catalog.sections(p.program, q.level);
  }

  @Get('programs/:program/test-sets')
  @ApiZod({ query: testSetListQuerySchema, responses: { 200: pageSchema(testSetSummarySchema) } })
  async testSets(@CurrentUser() user: AuthUser, @ZodParams(programParam) p: z.infer<typeof programParam>, @ZodQuery(testSetListQuerySchema) q: z.infer<typeof testSetListQuerySchema>) {
    const cursor = decodeCursor<{ id: string }>(q.cursor);
    const rows = await this.catalog.testSets(p.program, { kind: q.kind, level: q.level, limit: q.limit, cursorId: cursor?.id ?? null });
    const page = rows.slice(0, q.limit);
    const data = await this.summaries(user, p.program, page);
    return { data, next_cursor: rows.length > q.limit ? encodeCursor({ id: page.at(-1)!.ts.id }) : null };
  }

  @Get('test-sets/:testSetId')
  @ApiZod({ responses: { 200: testSetSchema, 402: 'empty' } })
  async testSet(@CurrentUser() user: AuthUser, @ZodParams(idParam) p: z.infer<typeof idParam>) {
    const row = await this.catalog.testSetById(p.testSetId);
    if (!row || row.ts.status !== 'published') throw new NotFound('test_set', p.testSetId);
    const [summary] = await this.summaries(user, row.ts.programCode, [row]);
    const sections = await this.catalog.testSetSections(p.testSetId);
    const [inProgress] = await this.dbs.db
      .select({ id: schema.learnAttempts.id })
      .from(schema.learnAttempts)
      .where(and(eq(schema.learnAttempts.userId, user.id), eq(schema.learnAttempts.testSetId, p.testSetId), eq(schema.learnAttempts.status, 'in_progress')))
      .orderBy(desc(schema.learnAttempts.startedAt))
      .limit(1);
    return { ...summary!, sections: sections.map((s) => ({ id: s.id, code: s.code, skill: s.skill, name: s.name, level: s.level, duration_sec: s.test_duration_sec ?? s.duration_sec, question_count: s.question_count, rules: s.rules })), in_progress_attempt_id: inProgress?.id ?? null };
  }

  /** Tóm tắt đề kèm khoá/điểm của người dùng (đọc learn.attempts để tổng hợp – cho phép vì chỉ đọc theo user) */
  private async summaries(user: AuthUser, program: string, rows: Array<{ ts: typeof schema.catalogTestSets.$inferSelect; count: number }>): Promise<TestSetSummary[]> {
    const ctx = await this.entitlements.getContext(user.id, program);
    const ids = rows.map((r) => r.ts.id);
    const stats = ids.length
      ? await this.dbs.db
          .select({
            testSetId: schema.learnAttempts.testSetId,
            attempts: sql<number>`count(*)`.mapWith(Number),
            best: sql<string | null>`max(${schema.learnAttempts.scaledScore})`,
            last: sql<string | null>`(array_agg(${schema.learnAttempts.scaledScore} order by ${schema.learnAttempts.submittedAt} desc))[1]`,
          })
          .from(schema.learnAttempts)
          .where(and(eq(schema.learnAttempts.userId, user.id), inArray(schema.learnAttempts.testSetId, ids), eq(schema.learnAttempts.status, 'graded')))
          .groupBy(schema.learnAttempts.testSetId)
      : [];
    const statMap = new Map(stats.map((s) => [s.testSetId, s]));
    return rows.map((r) => {
      const s = statMap.get(r.ts.id);
      const locked = !r.ts.isFree && !ctx.features.has(r.ts.kind === 'full' ? FEATURE_CODES.FULL_TEST : FEATURE_CODES.MINI_TEST);
      return {
        id: r.ts.id,
        code: r.ts.code,
        title: r.ts.title,
        kind: r.ts.kind,
        level: r.ts.level ?? null,
        is_free: r.ts.isFree,
        locked,
        duration_sec: r.ts.durationSec ?? null,
        question_count: r.count,
        last_score: s?.last !== null && s?.last !== undefined ? Number(s.last) : null,
        best_score: s?.best !== null && s?.best !== undefined ? Number(s.best) : null,
        attempts_count: s?.attempts ?? 0,
      };
    });
  }

  @Public()
  @Get('lessons')
  @ApiZod({ query: programQuery, responses: { 200: z.array(z.record(z.string(), z.unknown())) } })
  async lessons(@ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    const rows = await this.catalog.lessons(q.program);
    return rows.map((l) => ({ id: l.id, program: l.programCode, kind: l.kind, title: l.title, summary: l.summary, est_minutes: l.estMinutes, is_free: l.isFree, level: l.level }));
  }

  @Public()
  @Get('lessons/:lessonId')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()) } })
  async lesson(@ZodParams(lessonParam) p: z.infer<typeof lessonParam>) {
    const r = await this.catalog.lessonWithSteps(p.lessonId);
    if (!r) throw new NotFound('lesson', p.lessonId);
    return { id: r.lesson.id, program: r.lesson.programCode, kind: r.lesson.kind, title: r.lesson.title, summary: r.lesson.summary, est_minutes: r.lesson.estMinutes, is_free: r.lesson.isFree, steps: r.steps.map((s) => ({ step_no: s.sortOrder, type: s.stepType, content: s.content })) };
  }

  @Public()
  @Get('vocab/lists')
  @ApiZod({ query: programQuery, responses: { 200: z.array(z.record(z.string(), z.unknown())) } })
  async vocabLists(@ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    const rows = await this.catalog.vocabLists(q.program);
    return rows.map((l) => ({ id: l.id, program: l.programCode, kind: l.kind, title: l.title, is_free: l.isFree }));
  }

  @Public()
  @Get('vocab/lists/:listId/items')
  @ApiZod({ responses: { 200: z.array(z.record(z.string(), z.unknown())) } })
  async vocabItems(@ZodParams(listParam) p: z.infer<typeof listParam>) {
    const rows = await this.catalog.vocabListItems(p.listId);
    return rows.map((r) => ({ id: r.item.id, headword: r.item.headword, pos: r.item.pos, ipa_uk: r.item.ipaUk, ipa_us: r.item.ipaUs, meanings: r.item.meanings, examples: r.item.examples, level: r.item.level, sort_order: r.sort }));
  }
}
