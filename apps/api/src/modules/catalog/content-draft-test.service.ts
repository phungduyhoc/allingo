import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import {
  CONTENT_ROLES,
  JOB_NAMES,
  allocateDifficulty,
  contentRoleOf,
  planGroups,
  questionContentSchema,
  questionContentSchemasByType,
  type DraftTestInput,
  type GenerateItemSetOutput,
  type GenerateQuestionsOutput,
  type QuestionContent,
} from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { JobsService, type JobContext } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { AiGatewayService } from '../ai-gateway/core/ai-gateway.service.js';
import { ContentAiCheckService } from './content-ai-check.service.js';
import { ContentDedupService } from './content-dedup.service.js';
import { ContentPassageService } from './content-passage.service.js';
import { ContentWorkflowService, type Actor } from './content-workflow.service.js';

const { catalogSections, catalogSkills, catalogSubskills, catalogTestSets, catalogTestSetSections, catalogTestSetItems, catalogQuestions, catalogQuestionVersions } = schema;

const BATCH = 10;
/** Giây/câu ước tính thời lượng đề nháp (như mini generator – Listening 27 s, Reading 45 s) */
const SEC_PER_QUESTION: Record<string, number> = { listening: 27, reading: 45 };

export interface DraftSectionPlan {
  section_code: string;
  section_id: string;
  skill: string;
  sort_order: number;
  count: number;
  rules: Record<string, unknown>;
  mode: 'single' | 'group';
  passage_kind: 'reading_passage' | 'audio_script';
  /** Kích thước từng nhóm passage (mode group) */
  groups: number[];
  /** Số văn bản của từng nhóm (Part 7 bộ đôi/bộ ba) */
  text_counts: number[];
}

export interface DraftItemResult {
  question_id: string;
  question_version_id: string;
  section_code: string;
  sort_order: number;
  group_key: string | null;
  passage_id: string | null;
  difficulty: string;
  verdict: 'pass' | 'needs_change' | 'fail' | null;
  duplicate_flagged: boolean;
}

/** Kích thước nhóm từ blueprint hoặc catalog.sections.rules.group_size (số hoặc mảng); không có → câu đơn */
export function groupSizesOf(rules: Record<string, unknown>, fromBlueprint?: number[]): number[] | null {
  if (fromBlueprint?.length) return fromBlueprint;
  const g = rules.group_size;
  if (typeof g === 'number') return [g];
  if (Array.isArray(g) && g.every((x) => typeof x === 'number')) return g;
  return null;
}

/**
 * Kế hoạch soạn đề theo blueprint (thuần, kiểm tra trước khi tạo job): mỗi Part đơn → lô generate_questions; Part có passage →
 * nhóm generate_item_set (kích thước nhóm theo planGroups). Lỗi blueprint (Part lạ, vượt số câu chuẩn, không chia được nhóm) → issues.
 */
export function buildDraftPlan(
  input: DraftTestInput,
  sections: ReadonlyArray<{ id: string; code: string; skill: string; sort_order: number; question_count: number | null; rules: Record<string, unknown> }>,
): { plan: DraftSectionPlan[]; issues: Array<{ path: string; message: string }> } {
  const issues: Array<{ path: string; message: string }> = [];
  const byCode = new Map(sections.map((s) => [s.code, s]));
  const plan: DraftSectionPlan[] = [];
  const seen = new Set<string>();
  input.blueprint.sections.forEach((b, i) => {
    const spec = byCode.get(b.section_code);
    if (!spec) return issues.push({ path: `blueprint.sections.${i}.section_code`, message: `unknown section ${b.section_code}` });
    if (seen.has(b.section_code)) return issues.push({ path: `blueprint.sections.${i}.section_code`, message: `duplicate section ${b.section_code}` });
    seen.add(b.section_code);
    if (spec.question_count !== null && b.count > spec.question_count) return issues.push({ path: `blueprint.sections.${i}.count`, message: `${b.section_code} allows at most ${spec.question_count} questions` });
    const sizes = groupSizesOf(spec.rules, b.group_sizes);
    const audio = spec.rules.audio_once === true;
    if (!sizes) {
      plan.push({ section_code: spec.code, section_id: spec.id, skill: spec.skill, sort_order: spec.sort_order, count: b.count, rules: spec.rules, mode: 'single', passage_kind: audio ? 'audio_script' : 'reading_passage', groups: [], text_counts: [] });
      return;
    }
    const groups = planGroups(b.count, sizes);
    if (!groups) return issues.push({ path: `blueprint.sections.${i}.count`, message: `${b.count} questions cannot be split into groups of ${sizes.join('/')}` });
    const texts = b.multi_passage_texts ?? 1;
    plan.push({ section_code: spec.code, section_id: spec.id, skill: spec.skill, sort_order: spec.sort_order, count: b.count, rules: spec.rules, mode: 'group', passage_kind: audio ? 'audio_script' : 'reading_passage', groups, text_counts: groups.map((g) => (g >= 5 ? texts : 1)) });
  });
  if (input.kind === 'part_drill' && plan.length > 1) issues.push({ path: 'blueprint.sections', message: 'part_drill must have exactly one section' });
  return { plan: plan.sort((a, b) => a.sort_order - b.sort_order), issues };
}

const jobParamSchema = z.object({ input: z.unknown(), actor: z.object({ id: z.string(), roles: z.array(z.string()) }), test_set_id: z.uuid(), code: z.string() });

/**
 * B2 – AI soạn nháp cả đề theo blueprint (biên tập viên chọn chương trình + số câu mỗi Part + phân bố độ khó + chủ đề):
 * POST /admin/generate/test-sets → test set NHÁP trong catalog (metadata.source = ai_draft) + job `content.draft_test` (idempotent
 * theo job id; câu đã tạo nhận diện qua external_ref `ai-draft:<job>:<part>:<n>` nên chạy lại không tạo trùng):
 * Part đơn → generate_questions theo lô 10; Part có passage → generate_item_set mỗi nhóm (passage + passage_parts + câu, một
 * transaction/nhóm); mọi lời gọi qua AiGateway (Zod/repair/fallback – CLAUDE.md §5.3) → draft `source = ai` → check_question →
 * lọc trùng (embedding/pg_trgm) → câu vào hàng chờ duyệt, gắn vào đề nháp (test_set_items). Tiến độ qua polling GET …/{jobId}.
 */
@Injectable()
export class ContentDraftTestService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'catalog.draft-test' });

  constructor(
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly workflow: ContentWorkflowService,
    private readonly aiCheck: ContentAiCheckService,
    private readonly dedup: ContentDedupService,
    private readonly passages: ContentPassageService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('content', JOB_NAMES.CONTENT_DRAFT_TEST, async (payload, ctx) => {
      const p = jobParamSchema.parse(payload);
      return this.run(ctx.businessId, p.input as DraftTestInput, p.actor, p.test_set_id, ctx);
    });
  }

  private requireStaff(actor: Actor) {
    const role = contentRoleOf(actor.roles);
    if (!role) throw new Forbidden('Content role required', { required: [...CONTENT_ROLES] });
    return role;
  }

  private async sections(program: string) {
    const rows = await this.dbs.db
      .select({ id: catalogSections.id, code: catalogSections.code, skill: catalogSkills.code, sortOrder: catalogSections.sortOrder, questionCount: catalogSections.questionCount, rules: catalogSections.rules })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogSections.programCode, program));
    return rows.map((r) => ({ id: r.id, code: r.code, skill: r.skill, sort_order: r.sortOrder, question_count: r.questionCount ?? null, rules: (r.rules as Record<string, unknown>) ?? {} }));
  }

  async start(actor: Actor, input: DraftTestInput) {
    this.requireStaff(actor);
    const { plan, issues } = buildDraftPlan(input, await this.sections(input.program));
    if (issues.length) throw new ValidationFailed({ issues });
    const jobId = randomUUID();
    const total = plan.reduce((n, s) => n + s.count, 0);
    const code = input.code ?? `${input.program}-ai-draft-${jobId.slice(0, 8)}`;
    const title = input.title ?? { vi: `Đề nháp AI ${input.program.toUpperCase()} – ${total} câu`, en: `${input.program.toUpperCase()} AI draft – ${total} questions` };
    const durationSec = Math.ceil(plan.reduce((sum, s) => sum + s.count * (SEC_PER_QUESTION[s.skill] ?? 60), 0) / 60) * 60;
    // Đề nháp tạo NGAY (hàng chờ duyệt lọc theo test_set_id trong khi job chạy); không hiện cho người học (status draft)
    const testSetId = await this.dbs.db.transaction(async (tx) => {
      const [ts] = await tx
        .insert(catalogTestSets)
        .values({ programCode: input.program, code, title, kind: input.kind, isFree: false, durationSec, status: 'draft', metadata: { source: 'ai_draft', job_id: jobId, blueprint: input.blueprint, kind: input.kind, requested_by: actor.id, total } })
        .returning({ id: catalogTestSets.id });
      await tx.insert(catalogTestSetSections).values(plan.map((s, i) => ({ testSetId: ts!.id, sectionId: s.section_id, sortOrder: i + 1, durationSec: null })));
      await this.audit.log({ action: 'test_set.ai_draft_started', actorUserId: actor.id, actorRole: contentRoleOf(actor.roles), entityType: 'test_set', entityId: ts!.id, after: { code, job_id: jobId, total, sections: plan.map((s) => ({ section_code: s.section_code, count: s.count, groups: s.groups })) } }, tx);
      return ts!.id;
    }).catch((err: unknown) => {
      if ((err as { code?: string }).code === '23505') throw new ValidationFailed({ issues: [{ path: 'code', message: `test set code ${code} already exists` }] });
      throw err;
    });
    await this.jobs.patchStatus(JOB_NAMES.CONTENT_DRAFT_TEST, jobId, { status: 'queued', meta: { input, requested_by: actor.id, test_set_id: testSetId, code, total } });
    const d = await this.jobs.dispatch('content', JOB_NAMES.CONTENT_DRAFT_TEST, jobId, { input, actor, test_set_id: testSetId, code });
    return { job_id: jobId, status: 'queued', mode: d.mode, poll_url: `/v1/admin/generate/test-sets/${jobId}`, test_set_id: testSetId, code, total, plan: plan.map((s) => ({ section_code: s.section_code, count: s.count, mode: s.mode, groups: s.groups, text_counts: s.text_counts })) };
  }

  async status(actor: Actor, jobId: string) {
    this.requireStaff(actor);
    const s = await this.jobs.getStatus(JOB_NAMES.CONTENT_DRAFT_TEST, jobId);
    if (!s) throw new NotFound('draft_test_job', jobId);
    const meta = (s.meta ?? {}) as { test_set_id?: string; code?: string; total?: number; input?: unknown };
    return { job_id: jobId, status: s.status, test_set_id: meta.test_set_id ?? null, code: meta.code ?? null, total: meta.total ?? null, input: meta.input ?? null, progress: s.progress ?? null, result: s.result ?? null, error: s.error ?? null, created_at: s.created_at, updated_at: s.updated_at };
  }

  /** Câu đã tạo của job (chạy lại job không tạo trùng) */
  private async existingRefs(jobId: string): Promise<Map<string, { question_id: string; version_id: string }>> {
    const rows = await this.dbs.db
      .select({ ref: sql<string>`${catalogQuestionVersions.metadata} ->> 'external_ref'`, qid: catalogQuestionVersions.questionId, vid: catalogQuestionVersions.id })
      .from(catalogQuestionVersions)
      .where(sql`${catalogQuestionVersions.metadata} ->> 'external_ref' like ${`ai-draft:${jobId}:%`}`);
    return new Map(rows.map((r) => [r.ref, { question_id: r.qid, version_id: r.vid }]));
  }

  private validContent(raw: unknown, type: string, answer: unknown): { content: QuestionContent | null; errors: string[] } {
    const parsed = questionContentSchema.safeParse({ ...(raw as Record<string, unknown>), type });
    const errors: string[] = parsed.success ? [] : parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.')}: ${x.message}`);
    const content = parsed.success ? parsed.data : null;
    if (content && 'answer_key' in content && 'correct' in content.answer_key && typeof answer === 'string' && content.answer_key.correct !== answer) errors.push(`answer (${answer}) ≠ answer_key.correct`);
    return { content: errors.length ? null : content, errors };
  }

  async run(jobId: string, input: DraftTestInput, actor: Actor, testSetId: string, ctx?: JobContext) {
    const { plan } = buildDraftPlan(input, await this.sections(input.program));
    const total = plan.reduce((n, s) => n + s.count, 0);
    const levels = allocateDifficulty(total, input.blueprint.difficulty_mix);
    const topics = input.blueprint.topics.length ? input.blueprint.topics : ['general'];
    const subskills = (await this.dbs.db.select({ code: catalogSubskills.code }).from(catalogSubskills).where(eq(catalogSubskills.programCode, input.program))).map((s) => s.code);
    const existing = await this.existingRefs(jobId);
    const items: DraftItemResult[] = [];
    const invalid: Array<{ section_code: string; index: number; errors: string[] }> = [];
    const shortfall: Array<{ section_code: string; requested: number; created: number; reason: string }> = [];
    const titles: string[] = [];
    let sort = 0;
    let call = 0;
    let done = 0;
    const progress = (phase: string, section: string) => ctx?.status({ progress: { phase, section, done, total } });

    const addItem = async (tx: DbOrTx | null, it: Omit<DraftItemResult, 'sort_order' | 'verdict' | 'duplicate_flagged'>) => {
      sort += 1;
      const db = tx ?? this.dbs.db;
      await db.insert(catalogTestSetItems).values({ testSetId, questionId: it.question_id, sectionId: plan.find((p) => p.section_code === it.section_code)!.section_id, sortOrder: sort, groupKey: it.group_key, points: '1' }).onConflictDoNothing();
      items.push({ ...it, sort_order: sort, verdict: null, duplicate_flagged: false });
    };

    for (const sec of plan) {
      const contentSchema = z.toJSONSchema(questionContentSchemasByType.mcq_single, { io: 'input', unrepresentable: 'any' });
      let created = 0;
      if (sec.mode === 'single') {
        for (let offset = 0; offset < sec.count; offset += BATCH) {
          const n = Math.min(BATCH, sec.count - offset);
          const level = levels[done] ?? 'B1';
          const topic = topics[call % topics.length]!;
          call++;
          const refs = Array.from({ length: n }, (_, k) => `ai-draft:${jobId}:${sec.section_code}:${offset + k + 1}`);
          let generated: GenerateQuestionsOutput['questions'] = [];
          let aiTaskId: string | null = null;
          if (refs.some((r) => !existing.has(r))) {
            const r = await this.gateway.runTask<GenerateQuestionsOutput>({
              taskCode: 'generate_questions',
              userId: null,
              chargeCredits: false,
              program: input.program,
              variables: { program: input.program, program_name: input.program.toUpperCase(), section_code: sec.section_code, question_type: 'mcq_single', count: n, difficulty_target: { level, irt_b: 0 }, topic, allowed_subskills: subskills, section_rules: sec.rules, content_schema: contentSchema, passage: null, forbidden_recent_stems: [] },
              inputRef: { purpose: 'content_draft_test', job_id: jobId, section: sec.section_code, batch: offset / BATCH },
            });
            generated = r.data.questions.slice(0, n);
            aiTaskId = r.aiTaskId;
          }
          for (let k = 0; k < n; k++) {
            const ref = refs[k]!;
            const prior = existing.get(ref);
            const lv = levels[done] ?? level;
            done++;
            if (prior) {
              await addItem(null, { question_id: prior.question_id, question_version_id: prior.version_id, section_code: sec.section_code, group_key: null, passage_id: null, difficulty: lv });
              created++;
              continue;
            }
            const g = generated[k];
            const v = g ? this.validContent(g.content, 'mcq_single', g.answer) : { content: null, errors: ['missing item in model output'] };
            if (!g || !v.content) {
              invalid.push({ section_code: sec.section_code, index: offset + k, errors: v.errors });
              continue;
            }
            const dto = await this.workflow.create(
              actor,
              {
                program: input.program,
                section_code: sec.section_code,
                question_type: 'mcq_single',
                topic_code: topic === 'general' ? undefined : topic,
                subskill_codes: g.subskill_codes.filter((c) => subskills.includes(c)),
                difficulty_target: lv,
                source: 'ai',
                content: v.content,
                metadata: { external_ref: ref, generation: { job_id: jobId, kind: 'draft_test', test_set_id: testSetId, ai_task_id: aiTaskId, trap_type: g.trap_type, keywords: g.keywords, distractor_rationale: g.distractor_rationale, explanation_seed: g.explanation_seed, difficulty_estimate: g.difficulty_estimate, topic } },
              },
              { dedup: false },
            );
            await addItem(null, { question_id: dto.id, question_version_id: dto.head_version.id, section_code: sec.section_code, group_key: null, passage_id: null, difficulty: lv });
            created++;
          }
          await progress('generate', sec.section_code);
        }
      } else {
        let qIndex = 0;
        for (let gi = 0; gi < sec.groups.length; gi++) {
          const size = sec.groups[gi]!;
          const textCount = sec.text_counts[gi] ?? 1;
          const level = levels[done] ?? 'B1';
          const topic = topics[call % topics.length]!;
          call++;
          const refs = Array.from({ length: size }, (_, k) => `ai-draft:${jobId}:${sec.section_code}:${qIndex + k + 1}`);
          qIndex += size;
          if (refs.every((r) => existing.has(r))) {
            // Nhóm đã tạo ở lần chạy trước – chỉ gắn lại vào đề
            const prior = refs.map((r) => existing.get(r)!);
            const [pq] = await this.dbs.db.select({ passageId: catalogQuestions.passageId }).from(catalogQuestions).where(eq(catalogQuestions.id, prior[0]!.question_id)).limit(1);
            for (const pr of prior) {
              await addItem(null, { question_id: pr.question_id, question_version_id: pr.version_id, section_code: sec.section_code, group_key: pq?.passageId ?? null, passage_id: pq?.passageId ?? null, difficulty: level });
              done++;
            }
            created += prior.length;
            continue;
          }
          const r = await this.gateway.runTask<GenerateItemSetOutput>({
            taskCode: 'generate_item_set',
            userId: null,
            chargeCredits: false,
            program: input.program,
            variables: { program: input.program, program_name: input.program.toUpperCase(), section_code: sec.section_code, question_type: 'mcq_single', count: size, text_count: textCount, difficulty_target: { level, irt_b: 0 }, topic, allowed_subskills: subskills, passage_kind: sec.passage_kind, section_rules: sec.rules, content_schema: contentSchema, forbidden_recent_titles: titles.slice(-20) },
            inputRef: { purpose: 'content_draft_test', job_id: jobId, section: sec.section_code, group: gi },
          });
          const out = r.data;
          titles.push(out.passage.title);
          const valid = out.questions.slice(0, size).map((g) => ({ g, v: this.validContent(g.content, 'mcq_single', g.answer) }));
          valid.forEach((x, k) => {
            if (!x.v.content) invalid.push({ section_code: sec.section_code, index: qIndex - size + k, errors: x.v.errors });
          });
          const good = valid.filter((x) => x.v.content);
          if (!good.length) {
            done += size;
            continue;
          }
          // Passage + part + câu của nhóm trong MỘT transaction (nhóm luôn trọn vẹn)
          await this.dbs.db.transaction(async (tx) => {
            const texts = out.passage.texts.slice(0, Math.max(1, textCount));
            const passageId = await this.passages.create(tx, { program: input.program, kind: out.passage.kind, title: out.passage.title, body: texts.length === 1 ? texts[0]!.body : null, parts: texts.length > 1 ? texts : [], source: 'ai', difficulty: level, createdBy: actor.id });
            for (let k = 0; k < good.length; k++) {
              const { g, v } = good[k]!;
              const lv = levels[done + k] ?? level;
              const dto = await this.workflow.create(
                actor,
                {
                  program: input.program,
                  section_code: sec.section_code,
                  question_type: 'mcq_single',
                  passage_id: passageId,
                  topic_code: topic === 'general' ? undefined : topic,
                  subskill_codes: g.subskill_codes.filter((c) => subskills.includes(c)),
                  difficulty_target: lv,
                  source: 'ai',
                  content: v.content!,
                  metadata: { external_ref: refs[k]!, number: k + 1, generation: { job_id: jobId, kind: 'draft_test', test_set_id: testSetId, ai_task_id: r.aiTaskId, trap_type: g.trap_type, keywords: g.keywords, distractor_rationale: g.distractor_rationale, explanation_seed: g.explanation_seed, difficulty_estimate: g.difficulty_estimate, topic, passage_texts: texts.length } },
                },
                { tx, dedup: false },
              );
              await addItem(tx, { question_id: dto.id, question_version_id: dto.head_version.id, section_code: sec.section_code, group_key: passageId, passage_id: passageId, difficulty: lv });
            }
          });
          done += size;
          created += good.length;
          await progress('generate', sec.section_code);
        }
      }
      if (created < sec.count) shortfall.push({ section_code: sec.section_code, requested: sec.count, created, reason: 'invalid_model_output' });
    }

    // AI kiểm tra từng câu mới (draft → ai_checked; fail giữ draft, chặn gửi duyệt)
    const verdicts = { pass: 0, needs_change: 0, fail: 0 };
    for (const it of items) {
      try {
        const chk = await this.aiCheck.runForQuestion(actor, it.question_id);
        it.verdict = chk.ai_check.verdict;
        verdicts[chk.ai_check.verdict]++;
      } catch (err) {
        this.logger.warn({ job_id: jobId, err: (err as Error).message.slice(0, 200) }, 'ai check skipped');
      }
      await ctx?.status({ progress: { phase: 'check', done: items.indexOf(it) + 1, total: items.length } });
    }
    // Lọc trùng (embedding → pg_trgm) với ngân hàng và giữa các câu của đề nháp (trừ câu cùng passage)
    await ctx?.status({ progress: { phase: 'dedup', done: 0, total: items.length } });
    const flags = await this.dedup.checkVersions(items.map((i) => i.question_version_id));
    for (const it of items) it.duplicate_flagged = flags.get(it.question_version_id)?.flagged === true;

    const bySection: Record<string, number> = {};
    for (const it of items) bySection[it.section_code] = (bySection[it.section_code] ?? 0) + 1;
    const summary = { requested: total, created: items.length, invalid: invalid.length, flagged_duplicates: items.filter((i) => i.duplicate_flagged).length, verdicts, by_section: bySection, shortfall };
    await this.dbs.db
      .update(catalogTestSets)
      .set({ metadata: sql`${catalogTestSets.metadata} || ${JSON.stringify({ summary, completed_at: new Date().toISOString() })}::jsonb` })
      .where(eq(catalogTestSets.id, testSetId));
    await this.audit.log({ action: 'test_set.ai_drafted', actorUserId: actor.id, actorRole: contentRoleOf(actor.roles), entityType: 'test_set', entityId: testSetId, after: summary });
    await ctx?.status({ progress: { phase: 'done', done: items.length, total } });
    this.logger.info({ job_id: jobId, test_set_id: testSetId, ...summary }, 'content.draft_test finished');
    return { test_set_id: testSetId, summary, items, invalid };
  }
}
