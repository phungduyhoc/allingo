import { Inject, Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import { AI_TASK_CODES, MODEL_ALIASES, programCodeSchema, type AiTaskCode } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { AppError, Conflict, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { checkThresholds, thresholdsFor, type ThresholdCheck } from './eval-thresholds.js';
import { ExplanationCacheService } from './explanation-cache.service.js';
import { TaskRegistry } from './task-registry.js';

const { aiPromptTemplates, aiPromptVersions, aiModelRoutes, aiEvalRuns } = schema;
type VersionRow = typeof aiPromptVersions.$inferSelect;

const aliasSchema = z.string().refine((a) => (MODEL_ALIASES as readonly string[]).includes(a) || /^(google|anthropic|openai):[\w.-]+$/.test(a), 'unknown model alias');

export const promptTemplateCreateSchema = z.object({
  code: z.enum(AI_TASK_CODES),
  program: programCodeSchema.nullish(),
  description: z.string().max(500).optional(),
});
export const promptVersionInputSchema = z.object({
  system_prompt: z.string().min(1).max(40_000),
  user_template: z.string().min(1).max(40_000),
  few_shots: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  rubric: z.record(z.string(), z.unknown()).optional(),
  output_schema: z.record(z.string(), z.unknown()),
  model_policy: z.object({
    primary: aliasSchema,
    fallbacks: z.array(aliasSchema).max(5).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().min(16).max(32_000).optional(),
  }),
  change_note: z.string().max(500).optional(),
});
export const promptStatusInputSchema = z.object({
  status: z.enum(['draft', 'canary', 'active', 'retired']),
  canary_percent: z.number().int().min(1).max(50).optional(),
});
export type PromptTemplateCreate = z.infer<typeof promptTemplateCreateSchema>;
export type PromptVersionInput = z.infer<typeof promptVersionInputSchema>;
export type PromptStatusInput = z.infer<typeof promptStatusInputSchema>;

export interface Actor {
  id: string;
  roles: string[];
}

export interface EvalGate {
  ok: boolean;
  bypassed: boolean;
  eval_run_id: string | null;
  reason: 'passed' | 'no_eval_run' | 'eval_not_passed' | 'mock_only' | 'bypassed_dev';
  checks: ThresholdCheck[];
}

/**
 * Vòng đời prompt (S5, OpenAPI nhóm Admin): template → version draft → canary (x% người dùng) → active → retired.
 * Cổng eval: canary/active chỉ khi có `ai.eval_runs` passed=true, KHÔNG phải mock, và metrics đạt `eval.thresholds` của
 * phiên bản (allingo-prompts.yaml) → thiếu → 409 `conflict` (reason eval_required). ALLOW_UNEVALUATED_ACTIVATION=true chỉ
 * có hiệu lực ở APP_ENV development/test (ghi audit `bypassed`).
 * Active đổi: active cũ → retired, cache giải thích của phiên bản cũ bị xoá, registry làm mới ngay.
 */
@Injectable()
export class PromptAdminService {
  private readonly logger = getLogger({ component: 'ai.prompts' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly registry: TaskRegistry,
    private readonly cache: ExplanationCacheService,
    private readonly audit: AuditService,
  ) {}

  private versionDto(v: VersionRow, latestEval?: { id: string; passed: boolean; mock: boolean; run_at: string } | null) {
    const policy = (v.modelPolicy ?? {}) as Record<string, unknown>;
    return {
      id: v.id,
      template_id: v.templateId,
      version_no: v.versionNo,
      status: v.status,
      canary_percent: v.canaryPercent,
      system_prompt: v.systemPrompt,
      user_template: v.userTemplate,
      few_shots: v.fewShots,
      rubric: v.rubric ?? null,
      output_schema: v.outputSchema,
      model_policy: { primary: policy.primary, fallbacks: policy.fallbacks ?? [], temperature: policy.temperature, top_p: policy.top_p, max_tokens: policy.max_tokens, cache_key: policy.cache_key ?? null, eval: policy.eval ?? null },
      eval_run_id: v.evalRunId ?? null,
      latest_eval: latestEval ?? null,
      created_by: v.createdBy ?? null,
      created_at: v.createdAt.toISOString(),
    };
  }

  /** GET /admin/prompts – template + phiên bản + route + eval mới nhất (không gồm partial common_system) */
  async list() {
    const templates = await this.dbs.db.select().from(aiPromptTemplates).orderBy(aiPromptTemplates.code, aiPromptTemplates.programCode);
    const versions = await this.dbs.db.select().from(aiPromptVersions).orderBy(desc(aiPromptVersions.versionNo));
    const routes = await this.dbs.db.select().from(aiModelRoutes);
    const evals = await this.dbs.db.execute<{ prompt_version_id: string; id: string; passed: boolean; mock: boolean; run_at: Date }>(sql`
      select distinct on (prompt_version_id) prompt_version_id, id, passed, coalesce((metrics->>'mock')::boolean, false) as mock, run_at
        from ai.eval_runs order by prompt_version_id, run_at desc`);
    const evalBy = new Map([...evals].map((e) => [e.prompt_version_id, { id: e.id, passed: e.passed, mock: e.mock, run_at: new Date(e.run_at).toISOString() }]));
    return {
      data: templates.map((t) => {
        const route = routes.find((r) => r.taskCode === t.code);
        return {
          id: t.id,
          code: t.code,
          program: t.programCode ?? null,
          description: t.description ?? null,
          route: route ? { primary_model: route.primaryModel, fallback_models: route.fallbackModels, timeout_ms: route.timeoutMs, credits_cost: route.creditsCost, params: route.params } : null,
          versions: versions.filter((v) => v.templateId === t.id).map((v) => this.versionDto(v, evalBy.get(v.id) ?? null)),
        };
      }),
    };
  }

  /** POST /admin/prompts – tạo template (mã task thuộc 14 task_code có Zod đầu ra) */
  async createTemplate(actor: Actor, input: PromptTemplateCreate) {
    const program = input.program ?? null;
    const [dup] = await this.dbs.db
      .select({ id: aiPromptTemplates.id })
      .from(aiPromptTemplates)
      .where(and(eq(aiPromptTemplates.code, input.code), program ? eq(aiPromptTemplates.programCode, program) : sql`${aiPromptTemplates.programCode} is null`))
      .limit(1);
    if (dup) throw new Conflict('Prompt template already exists', { template_id: dup.id, code: input.code, program });
    const [row] = await this.dbs.db.insert(aiPromptTemplates).values({ code: input.code, programCode: program, description: input.description ?? null }).returning();
    await this.audit.log({ action: 'prompt.template_created', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'prompt_template', entityId: row!.id, after: { code: input.code, program } });
    this.registry.invalidate();
    return { id: row!.id, code: row!.code, program: row!.programCode ?? null, description: row!.description ?? null, route: null, versions: [] };
  }

  /** POST /admin/prompts/{templateId}/versions – phiên bản draft mới (version_no = max + 1) */
  async createVersion(actor: Actor, templateId: string, input: PromptVersionInput) {
    const [tpl] = await this.dbs.db.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, templateId)).limit(1);
    if (!tpl) throw new NotFound('prompt_template', templateId);
    // Handlebars phải biên dịch được (lỗi cú pháp → 400 trước khi tới người dùng)
    for (const [path, src] of [['system_prompt', input.system_prompt], ['user_template', input.user_template]] as const) {
      try {
        Handlebars.precompile(src);
      } catch (err) {
        throw new ValidationFailed({ issues: [{ path, message: `Invalid Handlebars template: ${(err as Error).message.split('\n')[0]}` }] });
      }
    }
    if (input.output_schema.type !== 'object') throw new ValidationFailed({ issues: [{ path: 'output_schema.type', message: 'output_schema must be a JSON Schema of type object' }] });
    // Kế thừa partial common_system, cache_key, eval (ngưỡng) từ phiên bản mới nhất để render/kích hoạt nhất quán với seed
    const [latest] = await this.dbs.db.select().from(aiPromptVersions).where(eq(aiPromptVersions.templateId, templateId)).orderBy(desc(aiPromptVersions.versionNo)).limit(1);
    const inherited = (latest?.modelPolicy ?? {}) as Record<string, unknown>;
    const modelPolicy = {
      primary: input.model_policy.primary,
      fallbacks: input.model_policy.fallbacks ?? [],
      temperature: input.model_policy.temperature ?? (inherited.temperature as number | undefined) ?? 0.3,
      top_p: input.model_policy.top_p ?? (inherited.top_p as number | undefined) ?? 0.9,
      max_tokens: input.model_policy.max_tokens ?? (inherited.max_tokens as number | undefined) ?? 1024,
      cache_key: inherited.cache_key ?? null,
      eval: inherited.eval ?? null,
      partials: inherited.partials ?? {},
      change_note: input.change_note ?? null,
    };
    const [{ n } = { n: 0 }] = await this.dbs.db.select({ n: max(aiPromptVersions.versionNo) }).from(aiPromptVersions).where(eq(aiPromptVersions.templateId, templateId));
    const [row] = await this.dbs.db
      .insert(aiPromptVersions)
      .values({ templateId, versionNo: (n ?? 0) + 1, systemPrompt: input.system_prompt, userTemplate: input.user_template, fewShots: input.few_shots ?? [], rubric: input.rubric ?? null, outputSchema: input.output_schema, modelPolicy, status: 'draft', canaryPercent: 0, createdBy: actor.id })
      .returning();
    await this.audit.log({ action: 'prompt.version_created', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'prompt_version', entityId: row!.id, after: { template_id: templateId, code: tpl.code, version_no: row!.versionNo } });
    return this.versionDto(row!, null);
  }

  /** Cổng eval cho canary/active */
  async evalGate(v: VersionRow, taskCode: string): Promise<EvalGate> {
    const thresholds = thresholdsFor(taskCode, ((v.modelPolicy as { eval?: { thresholds?: Record<string, unknown> } } | null)?.eval?.thresholds) ?? null);
    const runs = await this.dbs.db.select().from(aiEvalRuns).where(eq(aiEvalRuns.promptVersionId, v.id)).orderBy(desc(aiEvalRuns.runAt)).limit(20);
    const real = runs.filter((r) => !(r.metrics as { mock?: boolean }).mock);
    for (const r of real) {
      if (!r.passed) continue;
      const res = checkThresholds(r.metrics as Record<string, unknown>, thresholds);
      if (res.ok) return { ok: true, bypassed: false, eval_run_id: r.id, reason: 'passed', checks: res.checks };
    }
    const devBypass = this.env.ALLOW_UNEVALUATED_ACTIVATION && (this.env.APP_ENV === 'development' || this.env.APP_ENV === 'test');
    const latestReal = real[0];
    const checks = latestReal ? checkThresholds(latestReal.metrics as Record<string, unknown>, thresholds).checks : [];
    const reason: EvalGate['reason'] = runs.length === 0 ? 'no_eval_run' : real.length === 0 ? 'mock_only' : 'eval_not_passed';
    if (devBypass) return { ok: true, bypassed: true, eval_run_id: latestReal?.id ?? null, reason: 'bypassed_dev', checks };
    return { ok: false, bypassed: false, eval_run_id: latestReal?.id ?? null, reason, checks };
  }

  /** PATCH /admin/prompts/versions/{versionId}/status */
  async setStatus(actor: Actor, versionId: string, input: PromptStatusInput) {
    const [row] = await this.dbs.db
      .select({ v: aiPromptVersions, code: aiPromptTemplates.code })
      .from(aiPromptVersions)
      .innerJoin(aiPromptTemplates, eq(aiPromptTemplates.id, aiPromptVersions.templateId))
      .where(eq(aiPromptVersions.id, versionId))
      .limit(1);
    if (!row) throw new NotFound('prompt_version', versionId);
    const v = row.v;
    const from = v.status;
    const to = input.status;
    const allowed: Record<string, string[]> = { draft: ['canary', 'active', 'retired'], canary: ['draft', 'active', 'retired'], active: ['retired'], retired: ['draft'] };
    if (from === to && to !== 'canary') return { version: this.versionDto(v), changed: false, eval_gate: null, invalidated_cache_rows: 0 };
    if (from !== to && !allowed[from]?.includes(to)) throw new Conflict(`Transition ${from} → ${to} is not allowed`, { from, to, reason: 'invalid_transition' });

    let gate: EvalGate | null = null;
    if (to === 'canary' || to === 'active') {
      gate = await this.evalGate(v, row.code);
      if (!gate.ok) throw new AppError('conflict', 'Prompt version has no passing (non-mock) eval run meeting the thresholds', 409, { reason: 'eval_required', eval_gate: gate });
    }
    let invalidated = 0;
    let retiredIds: string[] = [];
    await this.dbs.db.transaction(async (tx) => {
      if (to === 'retired' && from === 'active') {
        const [other] = await tx.select({ id: aiPromptVersions.id }).from(aiPromptVersions).where(and(eq(aiPromptVersions.templateId, v.templateId), eq(aiPromptVersions.status, 'canary'))).limit(1);
        if (!other) throw new Conflict('Cannot retire the only active version; activate another version first', { reason: 'no_replacement' });
      }
      if (to === 'active') {
        const prev = await tx.update(aiPromptVersions).set({ status: 'retired', canaryPercent: 0 }).where(and(eq(aiPromptVersions.templateId, v.templateId), eq(aiPromptVersions.status, 'active'))).returning({ id: aiPromptVersions.id });
        retiredIds = prev.map((p) => p.id).filter((id) => id !== v.id);
      }
      if (to === 'canary') {
        // Mỗi template tối đa một canary
        await tx.update(aiPromptVersions).set({ status: 'draft', canaryPercent: 0 }).where(and(eq(aiPromptVersions.templateId, v.templateId), eq(aiPromptVersions.status, 'canary'), sql`${aiPromptVersions.id} <> ${v.id}`));
      }
      await tx
        .update(aiPromptVersions)
        .set({ status: to, canaryPercent: to === 'canary' ? (input.canary_percent ?? (v.canaryPercent || 10)) : 0, evalRunId: gate?.eval_run_id ?? v.evalRunId })
        .where(eq(aiPromptVersions.id, v.id));
      await this.audit.log({ action: `prompt.status.${to}`, actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'prompt_version', entityId: v.id, before: { status: from, canary_percent: v.canaryPercent }, after: { status: to, canary_percent: input.canary_percent ?? null, eval_run_id: gate?.eval_run_id ?? null, eval_bypassed: gate?.bypassed ?? false, retired: retiredIds } }, tx);
    });
    // Phiên bản bị thay/retired → cache giải thích của nó không còn hợp lệ
    for (const id of [...retiredIds, ...(to === 'retired' || to === 'draft' ? [v.id] : [])]) invalidated += await this.cache.invalidateByPromptVersion(id);
    this.registry.invalidate();
    if (gate?.bypassed) this.logger.warn({ version_id: v.id, code: row.code, to }, 'prompt activated WITHOUT passing eval (ALLOW_UNEVALUATED_ACTIVATION – dev only)');
    const [fresh] = await this.dbs.db.select().from(aiPromptVersions).where(eq(aiPromptVersions.id, v.id));
    return { version: this.versionDto(fresh!), changed: true, eval_gate: gate, retired_version_ids: retiredIds, invalidated_cache_rows: invalidated };
  }

  /** Phiên bản active của task (dùng cho runner eval mặc định) */
  async activeVersionId(taskCode: AiTaskCode, program: string | null = null): Promise<string | null> {
    const rows = await this.dbs.db
      .select({ id: aiPromptVersions.id, program: aiPromptTemplates.programCode })
      .from(aiPromptVersions)
      .innerJoin(aiPromptTemplates, eq(aiPromptTemplates.id, aiPromptVersions.templateId))
      .where(and(eq(aiPromptTemplates.code, taskCode), inArray(aiPromptVersions.status, ['active'])));
    return (rows.find((r) => r.program === program) ?? rows.find((r) => r.program === null) ?? rows[0])?.id ?? null;
  }
}
