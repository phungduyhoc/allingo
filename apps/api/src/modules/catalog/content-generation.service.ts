import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import { contentRoleOf, DEFAULT_DUPLICATE_THRESHOLD, JOB_NAMES, programCodeSchema, questionContentSchema, questionContentSchemasByType, questionTypeCodeSchema, type GenerateQuestionsOutput, type QuestionContent } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { JobsService, type JobContext } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { AiGatewayService } from '../ai-gateway/core/ai-gateway.service.js';
import { UsersService } from '../iam/index.js';
import { ContentAiCheckService } from './content-ai-check.service.js';
import { ContentWorkflowService, type Actor } from './content-workflow.service.js';

const { catalogSections, catalogSubskills, catalogQuestions, catalogQuestionVersions, catalogPassages } = schema;

const DIFFICULTIES = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1', 'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7_9', 'mixed']);
/** Số câu mỗi lần gọi model (max_tokens 6000 của generate_questions) */
const BATCH = 10;
const EMBED_ENTITY = 'question_version';

export const generateQuestionsInputSchema = z.object({
  program: programCodeSchema,
  section: z.string().min(1).max(32),
  question_type: questionTypeCodeSchema,
  topic: z.string().max(64).optional(),
  difficulty: z.string().max(10).optional(),
  count: z.number().int().min(1).max(50),
  passage_id: z.uuid().optional(),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsInputSchema>;

export interface GeneratedItemResult {
  index: number;
  status: 'created' | 'invalid';
  question_id: string | null;
  question_version_id: string | null;
  external_ref: string | null;
  workflow_status: string | null;
  verdict: 'pass' | 'needs_change' | 'fail' | null;
  issues: Array<{ field?: string; severity: string; message: string }>;
  ai_check_task_id: string | null;
  duplicate: { flagged: boolean; method: 'embedding' | 'trigram' | 'in_batch' | null; of_question_id: string | null; of_index: number | null; similarity: number | null; embedding_similarity: number | null; trigram_similarity: number | null };
  content: QuestionContent | null;
  errors?: string[];
}

/** Văn bản dùng để so trùng: đề bài (fallback evidence/phương án) – chuẩn hoá khoảng trắng */
export function dedupText(content: { stem?: string; evidence?: string; options?: Array<{ text: string }> }): string {
  const stem = (content.stem ?? '').replace(/\s+/g, ' ').trim();
  if (stem.length >= 12) return stem;
  return [stem, content.evidence ?? '', ...(content.options ?? []).map((o) => o.text)].join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Sinh câu hỏi AI cho CMS (S5): POST /admin/generate/questions (202 + job_id) → job `content.generate`:
 * generate_questions (AiGateway, không trừ credit) theo lô 10 → validate Zod nội dung → draft `source=ai` qua ContentWorkflowService
 * (ADR-0024, external_ref `ai-gen:<job>:<n>`) → check_question tự động (review stage ai_check) → dedup:
 * embedding cosine ≥ AI_DEDUP_COSINE_THRESHOLD (0,92) với câu PUBLISHED cùng chương trình+section (ai.embeddings/pgvector)
 * + pg_trgm ≥ 0,85 với catalog + trùng trong lô → cờ trong `question_versions.metadata.duplicate`.
 * Kết quả job (từng câu, verdict, cờ trùng) đọc qua GET /admin/generate/questions/{jobId} (CMS: /internal/content/questions/generate/{jobId}).
 */
@Injectable()
export class ContentGenerationService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'catalog.generate' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly workflow: ContentWorkflowService,
    private readonly aiCheck: ContentAiCheckService,
    private readonly jobs: JobsService,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('content', JOB_NAMES.CONTENT_GENERATE, async (payload, ctx) => {
      const input = generateQuestionsInputSchema.parse(payload.input);
      const actor = payload.actor as Actor;
      return this.run(ctx.businessId, input, actor, ctx);
    });
  }

  /** Actor cho CMS (không có JWT): email tài khoản API tương ứng (apiUserEmail) phải có vai trò nội dung */
  async actorByEmail(email: string | undefined): Promise<Actor> {
    if (!email) throw new ValidationFailed({ issues: [{ path: 'requested_by_email', message: 'requested_by_email is required' }] });
    const u = await this.users.findByEmail(email);
    if (!u) throw new Forbidden('No API account for requested_by_email (CMS users.apiUserEmail)', { requested_by_email: email });
    const roles = await this.users.getRoles(u.id);
    if (!contentRoleOf(roles)) throw new Forbidden('Content role required (editor/teacher/admin)', { requested_by_email: email });
    return { id: u.id, roles };
  }

  async start(actor: Actor, input: GenerateQuestionsInput): Promise<{ job_id: string; status: string; mode: string; poll_url: string }> {
    if (!contentRoleOf(actor.roles)) throw new Forbidden('Content role required', { required: ['editor', 'teacher', 'admin'] });
    const [section] = await this.dbs.db.select({ id: catalogSections.id }).from(catalogSections).where(and(eq(catalogSections.programCode, input.program), eq(catalogSections.code, input.section))).limit(1);
    if (!section) throw new ValidationFailed({ issues: [{ path: 'section', message: `section ${input.section} not found in ${input.program}` }] });
    if (input.passage_id) {
      const [p] = await this.dbs.db.select({ id: catalogPassages.id }).from(catalogPassages).where(eq(catalogPassages.id, input.passage_id)).limit(1);
      if (!p) throw new NotFound('passage', input.passage_id);
    }
    const jobId = randomUUID();
    await this.jobs.patchStatus(JOB_NAMES.CONTENT_GENERATE, jobId, { status: 'queued', meta: { input, requested_by: actor.id } });
    const d = await this.jobs.dispatch('content', JOB_NAMES.CONTENT_GENERATE, jobId, { input, actor });
    return { job_id: jobId, status: 'queued', mode: d.mode, poll_url: `/v1/admin/generate/questions/${jobId}` };
  }

  async status(jobId: string) {
    const s = await this.jobs.getStatus(JOB_NAMES.CONTENT_GENERATE, jobId);
    if (!s) throw new NotFound('generation_job', jobId);
    return { job_id: jobId, status: s.status, input: (s.meta as { input?: unknown } | undefined)?.input ?? null, progress: s.progress ?? null, result: s.result ?? null, error: s.error ?? null, created_at: s.created_at, updated_at: s.updated_at };
  }

  /** Câu published (bản hiện hành) cùng chương trình + section: id phiên bản + văn bản so trùng */
  private async publishedBank(program: string, sectionId: string): Promise<Array<{ question_id: string; version_id: string; text: string }>> {
    const rows = await this.dbs.db
      .select({ qid: catalogQuestions.id, vid: catalogQuestionVersions.id, content: catalogQuestionVersions.content })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .where(and(eq(catalogQuestions.programCode, program), eq(catalogQuestions.sectionId, sectionId), eq(catalogQuestions.status, 'published')));
    return rows.map((r) => ({ question_id: r.qid, version_id: r.vid, text: dedupText(r.content as { stem?: string }) })).filter((r) => r.text.length > 0);
  }

  async run(jobId: string, input: GenerateQuestionsInput, actor: Actor, ctx?: JobContext): Promise<{ items: GeneratedItemResult[]; summary: Record<string, unknown> }> {
    const [section] = await this.dbs.db.select().from(catalogSections).where(and(eq(catalogSections.programCode, input.program), eq(catalogSections.code, input.section))).limit(1);
    if (!section) throw new ValidationFailed({ issues: [{ path: 'section', message: 'section not found' }] });
    const subskills = (await this.dbs.db.select({ code: catalogSubskills.code }).from(catalogSubskills).where(eq(catalogSubskills.programCode, input.program))).map((s) => s.code);
    const bank = await this.publishedBank(input.program, section.id);
    const recent = await this.dbs.db
      .select({ content: catalogQuestionVersions.content })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .where(and(eq(catalogQuestions.programCode, input.program), eq(catalogQuestions.sectionId, section.id), eq(catalogQuestions.status, 'published')))
      .orderBy(desc(catalogQuestions.updatedAt))
      .limit(20);
    const forbidden = recent.map((r) => (r.content as { stem?: string }).stem ?? '').filter(Boolean);
    let passage: string | null = null;
    if (input.passage_id) {
      const [p] = await this.dbs.db.select({ body: catalogPassages.body }).from(catalogPassages).where(eq(catalogPassages.id, input.passage_id)).limit(1);
      passage = p?.body?.slice(0, 6000) ?? null;
    }
    const typeSchema = questionContentSchemasByType[input.question_type];
    const contentSchema = typeSchema ? z.toJSONSchema(typeSchema, { io: 'input', unrepresentable: 'any' }) : {};
    const difficulty = input.difficulty && DIFFICULTIES.has(input.difficulty) ? input.difficulty : undefined;

    // 1) Sinh theo lô
    const generated: Array<GenerateQuestionsOutput['questions'][number]> = [];
    const genTaskIds: string[] = [];
    for (let done = 0; done < input.count; done += BATCH) {
      const n = Math.min(BATCH, input.count - done);
      const r = await this.gateway.runTask<GenerateQuestionsOutput>({
        taskCode: 'generate_questions',
        userId: null,
        chargeCredits: false,
        program: input.program,
        variables: {
          program: input.program,
          program_name: input.program.toUpperCase(),
          section_code: input.section,
          question_type: input.question_type,
          count: n,
          difficulty_target: { level: difficulty ?? 'B1', irt_b: 0 },
          topic: input.topic ?? 'general',
          allowed_subskills: subskills,
          section_rules: section.rules ?? {},
          content_schema: contentSchema,
          passage,
          forbidden_recent_stems: [...forbidden, ...generated.map((g) => (g.content as { stem?: string }).stem ?? '')].slice(0, 40),
        },
        inputRef: { purpose: 'content_generate', job_id: jobId, batch: done / BATCH },
      });
      generated.push(...r.data.questions.slice(0, n));
      genTaskIds.push(r.aiTaskId);
      await ctx?.status({ progress: { phase: 'generate', generated: generated.length, total: input.count } });
    }

    // 2) Validate + tạo draft + AI check
    const items: GeneratedItemResult[] = [];
    const created: Array<{ idx: number; versionId: string; text: string; externalRef: string }> = [];
    for (let i = 0; i < generated.length; i++) {
      const g = generated[i]!;
      const empty: GeneratedItemResult['duplicate'] = { flagged: false, method: null, of_question_id: null, of_index: null, similarity: null, embedding_similarity: null, trigram_similarity: null };
      const parsed = questionContentSchema.safeParse({ ...(g.content as Record<string, unknown>), type: input.question_type });
      const errors: string[] = [];
      if (!parsed.success) errors.push(...parsed.error.issues.slice(0, 5).map((x) => `${x.path.join('.')}: ${x.message}`));
      const content = parsed.success ? parsed.data : null;
      if (content && 'answer_key' in content && 'correct' in content.answer_key && typeof g.answer === 'string' && content.answer_key.correct !== g.answer) errors.push(`answer (${g.answer}) ≠ content.answer_key.correct (${String(content.answer_key.correct)})`);
      if (!content || errors.length) {
        items.push({ index: i, status: 'invalid', question_id: null, question_version_id: null, external_ref: null, workflow_status: null, verdict: null, issues: [], ai_check_task_id: null, duplicate: empty, content: content ?? null, errors });
        continue;
      }
      const externalRef = `ai-gen:${jobId}:${i + 1}`;
      const dto = await this.workflow.create(actor, {
        program: input.program,
        section_code: input.section,
        question_type: input.question_type,
        passage_id: input.passage_id,
        topic_code: input.topic,
        subskill_codes: g.subskill_codes.filter((c) => subskills.includes(c)),
        difficulty_target: difficulty,
        source: 'ai',
        content,
        metadata: { external_ref: externalRef, generation: { job_id: jobId, ai_task_id: genTaskIds[Math.floor(i / BATCH)] ?? null, trap_type: g.trap_type, keywords: g.keywords, distractor_rationale: g.distractor_rationale, explanation_seed: g.explanation_seed, difficulty_estimate: g.difficulty_estimate, topic: input.topic ?? null } },
      });
      let verdict: GeneratedItemResult['verdict'] = null;
      let issues: GeneratedItemResult['issues'] = [];
      let checkTask: string | null = null;
      let wf = dto.workflow_status;
      try {
        const chk = await this.aiCheck.runForQuestion(actor, dto.id);
        verdict = chk.ai_check.verdict;
        issues = chk.ai_check.issues;
        checkTask = chk.ai_check.ai_task_id;
        wf = chk.question.workflow_status;
      } catch (err) {
        issues = [{ severity: 'error', message: `AI check failed: ${(err as Error).message.slice(0, 200)}` }];
      }
      items.push({ index: i, status: 'created', question_id: dto.id, question_version_id: dto.head_version.id, external_ref: externalRef, workflow_status: wf, verdict, issues, ai_check_task_id: checkTask, duplicate: empty, content });
      created.push({ idx: items.length - 1, versionId: dto.head_version.id, text: dedupText(content), externalRef });
      await ctx?.status({ progress: { phase: 'check', created: created.length, total: generated.length } });
    }

    // 3) Dedup: embedding với câu published + pg_trgm + trong lô
    const threshold = this.env.AI_DEDUP_COSINE_THRESHOLD;
    if (created.length) {
      await this.gateway.embeddings.ensure(EMBED_ENTITY, bank.map((b) => ({ id: b.version_id, text: b.text })));
      await this.gateway.embeddings.upsert(EMBED_ENTITY, created.map((c) => ({ id: c.versionId, text: c.text })));
      const vectors = await this.gateway.embeddings.embed(created.map((c) => c.text));
      const bankByVersion = new Map(bank.map((b) => [b.version_id, b.question_id]));
      const trigram = await this.workflow.findDuplicates(input.program, created.map((c) => c.text), DEFAULT_DUPLICATE_THRESHOLD, created.map((c) => c.externalRef));
      for (let k = 0; k < created.length; k++) {
        const c = created[k]!;
        const item = items[c.idx]!;
        const [best] = await this.gateway.embeddings.nearest(EMBED_ENTITY, vectors[k]!, { limit: 1, candidateIds: bank.map((b) => b.version_id) });
        const tri = trigram.existing.find((e) => e.index === k);
        const inBatch = trigram.in_batch.find((d) => d.index === k);
        const dup = item.duplicate;
        dup.embedding_similarity = best?.similarity ?? null;
        dup.trigram_similarity = tri?.similarity ?? null;
        if (best && best.similarity >= threshold) Object.assign(dup, { flagged: true, method: 'embedding', of_question_id: bankByVersion.get(best.entity_id) ?? null, similarity: best.similarity });
        else if (tri) Object.assign(dup, { flagged: true, method: 'trigram', of_question_id: tri.question_id, similarity: tri.similarity });
        else if (inBatch) Object.assign(dup, { flagged: true, method: 'in_batch', of_index: created[inBatch.duplicate_of] ? items[created[inBatch.duplicate_of]!.idx]!.index : null, similarity: inBatch.similarity });
        await this.dbs.db
          .update(catalogQuestionVersions)
          .set({ metadata: sql`${catalogQuestionVersions.metadata} || ${JSON.stringify({ duplicate: { ...dup, threshold, embedding_model: this.gateway.embeddings.model, checked_at: new Date().toISOString() } })}::jsonb` })
          .where(eq(catalogQuestionVersions.id, c.versionId));
      }
    }

    const verdicts = { pass: 0, needs_change: 0, fail: 0 };
    for (const it of items) if (it.verdict) verdicts[it.verdict]++;
    const summary = {
      requested: input.count,
      generated: generated.length,
      created: created.length,
      invalid: items.filter((x) => x.status === 'invalid').length,
      flagged_duplicates: items.filter((x) => x.duplicate.flagged).length,
      verdicts,
      generate_task_ids: genTaskIds,
      embedding_model: this.gateway.embeddings.model,
      cosine_threshold: threshold,
      mock: this.gateway.embeddings.isMock,
      bank_size: bank.length,
    };
    this.logger.info({ job_id: jobId, ...summary }, 'content.generate finished');
    return { items, summary };
  }
}
