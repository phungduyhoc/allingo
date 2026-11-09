import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import { costUsd, JOB_NAMES, priceFor, type AiTaskCode, type ExplainMcqOutput } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { JobsService } from '../../../shared/queue/jobs.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { checkThresholds, thresholdsFor } from './eval-thresholds.js';
import { ModelRouter } from './model-router.js';
import { PromptRenderer } from './prompt-renderer.js';
import { validateOutput, extractJson } from './structured-output.js';
import { TaskRegistry } from './task-registry.js';
import type { ResolvedTask } from './types.js';

const { aiEvalSets, aiEvalItems, aiEvalRuns, aiEvalRunItems, aiPromptVersions } = schema;

/** Một dòng eval/data/explain_mcq_v1.jsonl (C3/S169: cả explain_mcq_ielts_v1.jsonl – dạng nhiều mục có `items`, có thể < 2 lựa chọn) */
export const explainEvalLineSchema = z.object({
  key: z.string().min(1),
  vars: z.object({
    program: z.string(),
    section_code: z.string(),
    question_type: z.string(),
    learner_level: z.string().default('B1'),
    explanation_seed: z.string().default(''),
    related_codes: z.array(z.string()).default([]),
    stem: z.string(),
    options: z.array(z.object({ key: z.string(), text: z.string() })).default([]),
    /** C3/S169: hướng dẫn đề + mục đánh số của câu nhiều mục (describeQuestion) */
    instructions: z.string().default(''),
    items: z.array(z.record(z.string(), z.unknown())).default([]),
    correct_option: z.string(),
    chosen_option: z.string().default('null'),
    excerpt: z.string().default(''),
  }),
  gold: z.object({ correct_option: z.string() }),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ExplainEvalLine = z.infer<typeof explainEvalLineSchema>;

export const evalRunCreateSchema = z.object({ eval_set_id: z.uuid(), prompt_version_id: z.uuid(), model: z.string().max(64).optional() });

/** Rubric giám khảo LLM – cùng nội dung `teacher_proxy_rating` trong docs/spec/allingo-promptfoo.yaml */
const JUDGE_RUBRIC =
  'The explanation is factually correct for this question, names the grammar/vocabulary point precisely, cites the deciding words, is in Vietnamese with English examples kept in English, and could be read in under a minute. Score 1–5; pass if ≥ 4.';

export interface ExplainItemScore {
  schema_valid: boolean;
  correct_option_match: boolean;
  covers_all_distractors: boolean;
  teacher_proxy_rating: number | null;
  latency_ms: number;
  cost_usd: number | null;
  est_cost_usd_primary: number;
  tokens_in: number | null;
  tokens_out: number | null;
}

const pctl = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v: number | null, d = 4) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * Eval AI (S5): eval set/item trong ai.eval_sets/eval_items, mỗi lần chạy ghi ai.eval_runs + ai.eval_run_items.
 * - Gọi model qua AiGateway (taskOverride = đúng phiên bản prompt cần đánh giá; không trừ credit).
 * - Metric explain_mcq: schema_valid, correct_option_match, covers_all_distractors, teacher_proxy_rating (LLM giám khảo khi có khoá
 *   thật; provider mock → điểm heuristic), factual_error_rate, latency_p95_ms, cost_usd (TB/câu), ước tính chi phí/1.000 explain.
 * - Provider mock: `metrics.mock = true`, `passed = false` LUÔN (would_pass chỉ để tham khảo) → không mở được cổng kích hoạt.
 */
@Injectable()
export class EvalService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'ai.eval' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly registry: TaskRegistry,
    private readonly router: ModelRouter,
    private readonly renderer: PromptRenderer,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('content', JOB_NAMES.EVAL_RUN, async (payload) => this.executeRun(String(payload.run_id), { limit: typeof payload.limit === 'number' ? payload.limit : undefined }));
  }

  get isMock(): boolean {
    return this.router.mode === 'mock';
  }

  async ensureEvalSet(input: { taskCode: AiTaskCode; name: string; program?: string | null; description?: string; thresholds: Record<string, number> }): Promise<string> {
    const [existing] = await this.dbs.db.select({ id: aiEvalSets.id }).from(aiEvalSets).where(and(eq(aiEvalSets.taskCode, input.taskCode), eq(aiEvalSets.name, input.name))).limit(1);
    if (existing) {
      await this.dbs.db.update(aiEvalSets).set({ thresholds: input.thresholds, description: input.description ?? null }).where(eq(aiEvalSets.id, existing.id));
      return existing.id;
    }
    const [row] = await this.dbs.db.insert(aiEvalSets).values({ taskCode: input.taskCode, programCode: input.program ?? null, name: input.name, description: input.description ?? null, thresholds: input.thresholds }).returning({ id: aiEvalSets.id });
    return row!.id;
  }

  /** Upsert eval item theo `notes = key:<key>` (idempotent khi build lại dataset) */
  async upsertItems(evalSetId: string, items: Array<{ key: string; input: Record<string, unknown>; gold: Record<string, unknown> }>): Promise<{ inserted: number; updated: number }> {
    const existing = await this.dbs.db.select({ id: aiEvalItems.id, notes: aiEvalItems.notes }).from(aiEvalItems).where(eq(aiEvalItems.evalSetId, evalSetId));
    const byKey = new Map(existing.map((e) => [e.notes ?? '', e.id]));
    let inserted = 0;
    let updated = 0;
    for (const it of items) {
      const id = byKey.get(`key:${it.key}`);
      if (id) {
        await this.dbs.db.update(aiEvalItems).set({ input: it.input, gold: it.gold }).where(eq(aiEvalItems.id, id));
        updated++;
      } else {
        await this.dbs.db.insert(aiEvalItems).values({ evalSetId, input: it.input, gold: it.gold, notes: `key:${it.key}` });
        inserted++;
      }
    }
    return { inserted, updated };
  }

  /** Nạp tệp JSONL explain_mcq vào eval set (tạo set nếu chưa có) – trả id set */
  async importExplainDataset(lines: ExplainEvalLine[], opts: { name?: string; promptVersionId?: string | null } = {}): Promise<{ evalSetId: string; inserted: number; updated: number; thresholds: Record<string, number> }> {
    const versionId = opts.promptVersionId ?? (await this.gateway.currentPromptVersionId('explain_mcq', null, null));
    const task = versionId ? await this.registry.loadVersion(versionId) : null;
    const policyEval = task?.modelPolicy.eval?.thresholds ?? null;
    const thresholds = thresholdsFor('explain_mcq', policyEval);
    const evalSetId = await this.ensureEvalSet({ taskCode: 'explain_mcq', name: opts.name ?? 'explain_mcq_v1', program: null, description: 'Ngân hàng published demo (Reading 01, Listening 01 Part 3/4, Part 5 demo) – sinh bởi pnpm eval:build', thresholds });
    const r = await this.upsertItems(evalSetId, lines.map((l) => ({ key: l.key, input: l.vars, gold: l.gold })));
    return { evalSetId, ...r, thresholds };
  }

  /** Tạo bản ghi run (đang chạy) */
  async createRun(evalSetId: string, promptVersionId: string, model: string | null, triggeredBy: string): Promise<string> {
    const [set] = await this.dbs.db.select().from(aiEvalSets).where(eq(aiEvalSets.id, evalSetId)).limit(1);
    if (!set) throw new NotFound('eval_set', evalSetId);
    const [v] = await this.dbs.db.select({ id: aiPromptVersions.id }).from(aiPromptVersions).where(eq(aiPromptVersions.id, promptVersionId)).limit(1);
    if (!v) throw new NotFound('prompt_version', promptVersionId);
    if (set.taskCode !== 'explain_mcq') throw new ValidationFailed({ issues: [{ path: 'eval_set_id', message: `Eval runner for ${set.taskCode} is not implemented yet (Sprint 5 covers explain_mcq)` }] });
    const [row] = await this.dbs.db
      .insert(aiEvalRuns)
      .values({ evalSetId, promptVersionId, model: model ?? (this.isMock ? 'mock:mock-1' : 'route'), metrics: { status: 'running', mock: this.isMock, model_override: model }, passed: false, triggeredBy: this.isMock ? `${triggeredBy}-mock` : triggeredBy })
      .returning({ id: aiEvalRuns.id });
    return row!.id;
  }

  /** POST /admin/eval-runs → 202 { run_id } (job eval.run) */
  async startRun(input: z.infer<typeof evalRunCreateSchema>, actorId: string): Promise<{ run_id: string; status: string; mock: boolean; job_id: string; mode: string }> {
    const runId = await this.createRun(input.eval_set_id, input.prompt_version_id, input.model ?? null, 'manual');
    const d = await this.jobs.dispatch('content', JOB_NAMES.EVAL_RUN, runId, { run_id: runId, actor_id: actorId });
    return { run_id: runId, status: 'queued', mock: this.isMock, job_id: d.jobId, mode: d.mode };
  }

  private async judge(task: ResolvedTask, vars: Record<string, unknown>, out: ExplainMcqOutput): Promise<{ score: number; judge: string } | null> {
    if (this.isMock) return null;
    for (const alias of ['anthropic:claude-sonnet', 'openai:gpt', 'google:gemini-pro']) {
      const model = this.router.resolveAlias(alias);
      const adapter = this.router.adapterOf(model.provider);
      if (!adapter?.isConfigured() || !this.router.breaker(model.provider).canRequest()) continue;
      try {
        const r = await adapter.generate({
          model,
          messages: [
            { role: 'system', content: `You are a strict TOEIC/IELTS teacher grading an AI explanation. Rubric: ${JUDGE_RUBRIC} Return ONLY JSON {"score": <1-5 integer>, "reason": "<≤ 30 words>"}.` },
            { role: 'user', content: `<data>\n${JSON.stringify({ question: { stem: vars.stem, options: vars.options, correct_option: vars.correct_option, learner_chosen_option: vars.chosen_option }, explanation: out })}\n</data>` },
          ],
          temperature: 0,
          topP: 1,
          maxTokens: 200,
          timeoutMs: 30_000,
          taskCode: task.taskCode,
          jsonMode: 'json',
        });
        const j = extractJson(r.text) as { score?: unknown } | undefined;
        const s = Number(j?.score);
        if (Number.isFinite(s) && s >= 1 && s <= 5) return { score: s, judge: alias };
      } catch (err) {
        this.logger.warn({ judge: alias, err: (err as Error).message.slice(0, 200) }, 'eval judge failed');
      }
    }
    return null;
  }

  /** Điểm heuristic khi chạy mock (không phải đánh giá thật – chỉ kiểm tra đường ống) */
  static heuristicRating(vars: { options: Array<{ key: string }>; correct_option: string; chosen_option: string }, out: ExplainMcqOutput | null, schemaValid: boolean): number {
    if (!schemaValid || !out) return 1;
    let r = 5;
    if (out.correct_option !== vars.correct_option) r = Math.min(r, 2);
    // Dạng nhiều mục (IELTS – < 2 lựa chọn) không có phương án nhiễu để giải thích
    if (vars.options.length >= 2 && Object.keys(out.why_others_wrong).length !== vars.options.length - 1) r -= 1;
    const chosen = vars.chosen_option && vars.chosen_option !== 'null' ? vars.chosen_option : null;
    if (chosen && chosen !== vars.correct_option && !out.chosen_option_trap) r -= 1;
    if (out.why_correct.length < 20 || out.how_to_spot.length < 10) r -= 1;
    return Math.max(1, r);
  }

  /** Chạy một run explain_mcq đã tạo; ghi metrics + passed; trả tóm tắt */
  async executeRun(runId: string, opts: { limit?: number; concurrency?: number } = {}) {
    const [run] = await this.dbs.db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, runId)).limit(1);
    if (!run) throw new NotFound('eval_run', runId);
    const [set] = await this.dbs.db.select().from(aiEvalSets).where(eq(aiEvalSets.id, run.evalSetId)).limit(1);
    const base = await this.registry.loadVersion(run.promptVersionId);
    if (!set || !base) throw new NotFound('eval_set/prompt_version', runId);
    const override = (run.metrics as { model_override?: string | null }).model_override ?? null;
    const task: ResolvedTask = override ? { ...base, route: { ...base.route, primaryModel: override, fallbackModels: [] } } : base;
    const items = await this.dbs.db.select().from(aiEvalItems).where(eq(aiEvalItems.evalSetId, set.id)).orderBy(aiEvalItems.notes);
    const list = opts.limit ? items.slice(0, opts.limit) : items;
    const primaryPrice = priceFor(task.route.primaryModel, (task.route.params as { pricing?: Record<string, unknown> }).pricing ?? null);
    const scores: ExplainItemScore[] = [];
    const models = new Map<string, number>();
    let judgeName: string | null = this.isMock ? 'heuristic-mock' : null;
    const started = Date.now();

    const runOne = async (item: (typeof list)[number]) => {
      const vars = item.input as ExplainEvalLine['vars'];
      const gold = item.gold as { correct_option: string };
      const messages = this.renderer.render(task, { ...vars, explain_locale: 'vi' });
      const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
      let out: ExplainMcqOutput | null = null;
      let schemaValid = false;
      let latency = 0;
      let cost: number | null = null;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let error: string | null = null;
      try {
        const r = await this.gateway.runTask<ExplainMcqOutput>({ taskCode: 'explain_mcq', userId: null, chargeCredits: false, variables: vars, locale: 'vi', program: vars.program, taskOverride: task, inputRef: { purpose: 'eval', eval_run_id: runId, eval_item_id: item.id } });
        out = r.data;
        schemaValid = validateOutput('explain_mcq', JSON.stringify(r.data)).ok;
        latency = r.latencyMs;
        cost = r.costUsd;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
        if (r.model) models.set(r.model.alias, (models.get(r.model.alias) ?? 0) + 1);
      } catch (err) {
        error = (err as Error).message.slice(0, 300);
      }
      const correct = !!out && out.correct_option === gold.correct_option;
      const covers = !!out && (vars.options.length < 2 || Object.keys(out.why_others_wrong).length === vars.options.length - 1);
      let rating: number | null;
      if (this.isMock) rating = EvalService.heuristicRating(vars, out, schemaValid);
      else {
        const j = out ? await this.judge(task, vars, out) : { score: 1, judge: 'error' };
        if (j?.judge && j.judge !== 'error') judgeName = j.judge;
        rating = j?.score ?? null;
      }
      // Ước tính chi phí với giá model primary: token thật nếu provider thật; mock → ~4 ký tự/token vào, ~3 ký tự/token ra (tiếng Việt)
      const estIn = !this.isMock && tokensIn !== null ? tokensIn : Math.ceil(promptChars / 4);
      const estOut = !this.isMock && tokensOut !== null ? tokensOut : Math.ceil(JSON.stringify(out ?? {}).length / 3);
      const score: ExplainItemScore = { schema_valid: schemaValid, correct_option_match: correct, covers_all_distractors: covers, teacher_proxy_rating: rating, latency_ms: latency, cost_usd: cost, est_cost_usd_primary: costUsd(primaryPrice, estIn, estOut) ?? 0, tokens_in: tokensIn, tokens_out: tokensOut };
      scores.push(score);
      await this.dbs.db
        .insert(aiEvalRunItems)
        .values({ runId, evalItemId: item.id, output: { output: out, error, scores: score, mock: this.isMock }, diff: correct ? '0' : '1' })
        .onConflictDoUpdate({ target: [aiEvalRunItems.runId, aiEvalRunItems.evalItemId], set: { output: { output: out, error, scores: score, mock: this.isMock }, diff: correct ? '0' : '1' } });
    };

    const conc = Math.max(1, opts.concurrency ?? (this.isMock ? 4 : 3));
    for (let i = 0; i < list.length; i += conc) await Promise.all(list.slice(i, i + conc).map(runOne));

    const n = scores.length;
    const rate = (k: 'schema_valid' | 'correct_option_match' | 'covers_all_distractors') => (n ? scores.filter((s) => s[k]).length / n : null);
    const ratings = scores.map((s) => s.teacher_proxy_rating).filter((x): x is number => x !== null);
    const costs = scores.map((s) => s.cost_usd).filter((x): x is number => x !== null);
    const estCosts = scores.map((s) => s.est_cost_usd_primary);
    const correctRate = rate('correct_option_match');
    const metrics: Record<string, unknown> = {
      status: 'completed',
      mock: this.isMock,
      provider_mode: this.router.mode,
      n,
      schema_valid: round(rate('schema_valid')),
      correct_option_match: round(correctRate),
      covers_all_distractors: round(rate('covers_all_distractors')),
      teacher_rating_mean: ratings.length === n && n > 0 ? round(mean(ratings), 3) : null,
      teacher_proxy_rating_judge: judgeName,
      factual_error_rate: correctRate === null ? null : round(1 - correctRate),
      latency_p95_ms: pctl(scores.map((s) => s.latency_ms), 95),
      latency_mean_ms: round(mean(scores.map((s) => s.latency_ms)), 0),
      cost_usd: this.isMock ? round(mean(estCosts), 6) : round(mean(costs), 6),
      cost_usd_is_estimate: this.isMock,
      est_cost_per_1000_explain_usd: round((mean(estCosts) ?? 0) * 1000, 4),
      est_cost_basis: { primary_model: task.route.primaryModel, price_usd_per_mtok: primaryPrice, method: this.isMock ? 'chars/4 prompt + chars/3 output (mock)' : 'actual tokens × price' },
      models_used: Object.fromEntries(models),
      model_override: override,
      duration_ms: Date.now() - started,
    };
    const thresholds = thresholdsFor('explain_mcq', (set.thresholds as Record<string, unknown>) ?? null);
    const check = checkThresholds(metrics, thresholds);
    metrics.thresholds = thresholds;
    metrics.threshold_checks = check.checks;
    metrics.would_pass = check.ok;
    const passed = !this.isMock && check.ok;
    const modelLabel = this.isMock ? 'mock:mock-1' : override ?? ([...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? task.route.primaryModel);
    await this.dbs.db.update(aiEvalRuns).set({ metrics, passed, model: modelLabel }).where(eq(aiEvalRuns.id, runId));
    this.logger.info({ run_id: runId, n, passed, mock: this.isMock, correct_option_match: metrics.correct_option_match, teacher_rating_mean: metrics.teacher_rating_mean }, 'eval run finished');
    return { run_id: runId, eval_set_id: set.id, prompt_version_id: run.promptVersionId, model: modelLabel, passed, metrics };
  }

  /** GET /admin/eval-runs */
  async listRuns(q: { task_code?: string; prompt_version_id?: string; eval_set_id?: string; cursor?: string; limit: number }) {
    const conds: SQL[] = [];
    if (q.task_code) conds.push(eq(aiEvalSets.taskCode, q.task_code));
    if (q.prompt_version_id) conds.push(eq(aiEvalRuns.promptVersionId, q.prompt_version_id));
    if (q.eval_set_id) conds.push(eq(aiEvalRuns.evalSetId, q.eval_set_id));
    const cur = q.cursor ? decodeCursor<{ t: string; id: string }>(q.cursor) : null;
    if (cur) conds.push(sql`(${aiEvalRuns.runAt}, ${aiEvalRuns.id}) < (${cur.t}::timestamptz, ${cur.id}::uuid)`);
    const rows = await this.dbs.db
      .select({ r: aiEvalRuns, set: { id: aiEvalSets.id, name: aiEvalSets.name, task_code: aiEvalSets.taskCode }, versionNo: aiPromptVersions.versionNo, versionStatus: aiPromptVersions.status })
      .from(aiEvalRuns)
      .innerJoin(aiEvalSets, eq(aiEvalSets.id, aiEvalRuns.evalSetId))
      .innerJoin(aiPromptVersions, eq(aiPromptVersions.id, aiEvalRuns.promptVersionId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(aiEvalRuns.runAt), desc(aiEvalRuns.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map(({ r, set, versionNo, versionStatus }) => ({
        id: r.id,
        eval_set: set,
        prompt_version_id: r.promptVersionId,
        prompt_version_no: versionNo,
        prompt_version_status: versionStatus,
        model: r.model,
        passed: r.passed,
        mock: !!(r.metrics as { mock?: boolean }).mock,
        status: ((r.metrics as { status?: string }).status ?? 'completed'),
        metrics: r.metrics,
        triggered_by: r.triggeredBy ?? null,
        run_at: r.runAt.toISOString(),
      })),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.r.runAt.toISOString(), id: last.r.id }) : null,
    };
  }

  /** Chi tiết item của một run (CLI/report) */
  async runItems(runId: string) {
    return this.dbs.db.select().from(aiEvalRunItems).where(eq(aiEvalRunItems.runId, runId));
  }
}
