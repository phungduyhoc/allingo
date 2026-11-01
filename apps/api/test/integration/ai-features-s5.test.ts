import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../src/config/env.js';
import { FakeClock, useClock } from '../../src/shared/clock/clock.module.js';
import { DbService } from '../../src/shared/db/db.module.js';
import { EvalService, ExplanationCacheService, MockProvider, ModelRouter, TaskRegistry } from '../../src/modules/ai-gateway/index.js';
import { CatalogQueryService } from '../../src/modules/catalog/index.js';
import { QuotaService } from '../../src/modules/billing/index.js';
import { buildExplainDataset } from '../../scripts/lib/explain-dataset.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const uniq = () => Math.random().toString(36).slice(2, 8);
const sseResult = (raw: string) => {
  const m = /event: result\ndata: (.*)\n/.exec(raw);
  return m ? (JSON.parse(m[1]!) as { data: Record<string, unknown>; ai_task_id: string }) : null;
};

/**
 * Sprint 5 – tính năng AI: explain (cache theo prompt version, ai_task_id cả khi cache hit) + feedback chủ task,
 * vòng đời prompt (cổng eval 409, canary, active → invalidation cache), eval run lưu DB (mock bị đánh dấu),
 * quota Free 10 explain/ngày reset 00:00 giờ VN (đồng hồ giả) + chốt usage_counters.
 */
describe('AI features S5 (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let env: Env;
  let admin: ReturnType<typeof client>;
  let learner: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  let mcqVersions: string[] = [];
  let explainTemplateId = '';
  let v1Id = '';
  const createdTemplateIds: string[] = [];

  const register = async (api: ReturnType<typeof client>) => {
    const r = await api.call('POST', '/auth/register', { email: `s5-${uniq()}@example.com`, password: 'Password123!', display_name: 'S5', accept_terms: true });
    expect(r.status).toBe(201);
    return r.body.user.id as string;
  };

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    app = await bootTestApp();
    dbs = app.get(DbService);
    env = app.get(ENV);
    // .env dev có thể bật ALLOW_UNEVALUATED_ACTIVATION – test cổng eval cần tắt
    env.ALLOW_UNEVALUATED_ACTIVATION = false;
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    learner = client(app);
    await register(learner);
    other = client(app);
    await register(other);
    const rows = await dbs.db
      .select({ id: schema.catalogQuestionVersions.id })
      .from(schema.catalogQuestions)
      .innerJoin(schema.catalogQuestionVersions, eq(schema.catalogQuestionVersions.id, schema.catalogQuestions.currentVersionId))
      .innerJoin(schema.catalogSections, eq(schema.catalogSections.id, schema.catalogQuestions.sectionId))
      .where(and(eq(schema.catalogQuestions.status, 'published'), eq(schema.catalogQuestions.questionTypeCode, 'mcq_single'), eq(schema.catalogSections.code, 'part5')))
      .orderBy(asc(schema.catalogQuestionVersions.id))
      .limit(14);
    mcqVersions = rows.map((r) => r.id);
    const cache = app.get(ExplanationCacheService);
    for (const id of mcqVersions) await cache.invalidateVersion(id);
    const [tpl] = await dbs.db.select().from(schema.aiPromptTemplates).where(and(eq(schema.aiPromptTemplates.code, 'explain_mcq'), sql`${schema.aiPromptTemplates.programCode} is null`));
    explainTemplateId = tpl!.id;
    const [v1] = await dbs.db.select().from(schema.aiPromptVersions).where(and(eq(schema.aiPromptVersions.templateId, explainTemplateId), eq(schema.aiPromptVersions.versionNo, 1)));
    v1Id = v1!.id;
  });

  afterAll(async () => {
    // Trả registry explain_mcq về như seed (v1 active) để test khác không bị ảnh hưởng
    if (explainTemplateId) {
      await dbs.db.update(schema.aiPromptVersions).set({ status: 'retired', canaryPercent: 0 }).where(and(eq(schema.aiPromptVersions.templateId, explainTemplateId), sql`${schema.aiPromptVersions.versionNo} > 1`));
      await dbs.db.update(schema.aiPromptVersions).set({ status: 'active', canaryPercent: 0 }).where(eq(schema.aiPromptVersions.id, v1Id));
    }
    if (createdTemplateIds.length) await dbs.db.delete(schema.aiPromptTemplates).where(inArray(schema.aiPromptTemplates.id, createdTemplateIds));
    app?.get(TaskRegistry).invalidate();
    env.ALLOW_UNEVALUATED_ACTIVATION = false;
    await app?.close();
  });

  it('explain: SSE lần đầu → cache hit JSON có ai_task_id + prompt_version_id; ai_tasks cache_hit', async () => {
    const qv = mcqVersions[12]!;
    const r1 = await learner.call('POST', '/ai/explain', { question_version_id: qv, chosen_option: 'A' });
    expect(r1.status).toBe(200);
    const res = sseResult(r1.raw)!;
    expect(res.data.prompt_version_id).toBe(v1Id);
    const r2 = await learner.call('POST', '/ai/explain', { question_version_id: qv, chosen_option: 'A' });
    expect(String(r2.headers['content-type'])).toContain('application/json');
    expect(r2.body).toMatchObject({ cached: true, prompt_version_id: v1Id });
    expect(r2.body.ai_task_id).toBeTruthy();
    const [t] = await dbs.db.select().from(schema.aiAiTasks).where(eq(schema.aiAiTasks.id, r2.body.ai_task_id));
    expect(t).toMatchObject({ cacheHit: true, modelUsed: 'cache', creditsCharged: 0, status: 'succeeded', promptVersionId: v1Id });
  });

  it('feedback: chủ task 201 (gửi lại → cập nhật), người khác 403, không tồn tại 404; quality_score cache', async () => {
    const qv = mcqVersions[12]!;
    const r = await learner.call('POST', '/ai/explain', { question_version_id: qv, chosen_option: 'A' });
    const taskId = r.body.ai_task_id as string;
    const f1 = await learner.call('POST', '/ai/feedback', { ai_task_id: taskId, rating: 'not_helpful', comment: 'Khó hiểu phần B' });
    expect(f1.status).toBe(201);
    expect(f1.body).toMatchObject({ ok: true, updated: false, rating: 'not_helpful' });
    const f2 = await learner.call('POST', '/ai/feedback', { ai_task_id: taskId, rating: 'helpful' });
    expect(f2.body.updated).toBe(true);
    expect(f2.body.id).toBe(f1.body.id);
    expect((await other.call('POST', '/ai/feedback', { ai_task_id: taskId, rating: 'wrong' })).status).toBe(403);
    expect((await learner.call('POST', '/ai/feedback', { ai_task_id: '00000000-0000-4000-8000-000000000000', rating: 'helpful' })).status).toBe(404);
    const rows = await dbs.db.select().from(schema.aiFeedback).where(eq(schema.aiFeedback.aiTaskId, taskId));
    expect(rows).toHaveLength(1);
    const [c] = await dbs.db.select({ q: schema.aiExplanationCache.qualityScore }).from(schema.aiExplanationCache).where(and(eq(schema.aiExplanationCache.questionVersionId, qv), eq(schema.aiExplanationCache.chosenOption, 'A')));
    expect(Number(c!.q)).toBeGreaterThan(0);
  });

  it('prompt lifecycle: tạo template (409 trùng), version (400 Handlebars sai), canary/active thiếu eval → 409', async () => {
    const list = await admin.call('GET', '/admin/prompts');
    expect(list.status).toBe(200);
    const explain = list.body.data.find((t: { code: string; program: string | null }) => t.code === 'explain_mcq' && t.program === null);
    expect(explain.versions.find((v: { id: string }) => v.id === v1Id).status).toBe('active');
    expect(explain.route.credits_cost).toBe(1);
    const t1 = await admin.call('POST', '/admin/prompts', { code: 'plan_adjust', program: 'jlpt', description: 'it' });
    expect(t1.status).toBe(201);
    createdTemplateIds.push(t1.body.id);
    expect((await admin.call('POST', '/admin/prompts', { code: 'plan_adjust', program: 'jlpt' })).status).toBe(409);
    const v1 = explain.versions.find((v: { id: string }) => v.id === v1Id);
    const bad = await admin.call('POST', `/admin/prompts/${explainTemplateId}/versions`, { system_prompt: '{{#if}}', user_template: 'x', output_schema: { type: 'object' }, model_policy: { primary: 'google:gemini-flash' } });
    expect(bad.status).toBe(400);
    const v2 = await admin.call('POST', `/admin/prompts/${explainTemplateId}/versions`, { system_prompt: `${v1.system_prompt}\nKeep it short.`, user_template: v1.user_template, output_schema: v1.output_schema, model_policy: { primary: 'google:gemini-flash', fallbacks: ['openai:gpt-mini'] }, change_note: 'it' });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ status: 'draft', version_no: expect.any(Number) });
    const denied = await admin.call('PATCH', `/admin/prompts/versions/${v2.body.id}/status`, { status: 'active' });
    expect(denied.status).toBe(409);
    expect(denied.body.error.details).toMatchObject({ reason: 'eval_required', eval_gate: { ok: false, reason: 'no_eval_run' } });
    (globalThis as { __v2?: string }).__v2 = v2.body.id;
  });

  it('eval run lưu ai.eval_runs/eval_run_items; mock bị đánh dấu (passed=false) → vẫn 409; GET /admin/eval-runs', async () => {
    const v2 = (globalThis as { __v2?: string }).__v2!;
    const evals = app.get(EvalService);
    const lines = await buildExplainDataset(dbs, app.get(CatalogQueryService), { limit: 6 });
    expect(lines).toHaveLength(6);
    for (const l of lines) expect(l.vars.correct_option).toBe(l.gold.correct_option);
    const imp = await evals.importExplainDataset(lines, { name: `explain_mcq_it_${uniq()}`, promptVersionId: v2 });
    expect(imp.inserted).toBe(6);
    expect(imp.thresholds).toMatchObject({ teacher_rating_mean_min: 4, correct_option_match_min: 1 });
    // POST /admin/eval-runs (job eval.run – inline ở test)
    const start = await admin.call('POST', '/admin/eval-runs', { eval_set_id: imp.evalSetId, prompt_version_id: v2 });
    expect(start.status).toBe(202);
    expect(start.body.mock).toBe(true);
    let run: Record<string, unknown> | undefined;
    for (let i = 0; i < 60 && !(run && run.status === 'completed'); i++) {
      await new Promise((r) => setTimeout(r, 250));
      const runs = await admin.call('GET', `/admin/eval-runs?prompt_version_id=${v2}`);
      run = runs.body.data.find((x: { id: string }) => x.id === start.body.run_id);
    }
    expect(run).toMatchObject({ status: 'completed', mock: true, passed: false, model: 'mock:mock-1' });
    expect((run!.metrics as Record<string, unknown>)).toMatchObject({ n: 6, correct_option_match: 1, schema_valid: 1, would_pass: true });
    const items = await dbs.db.select().from(schema.aiEvalRunItems).where(eq(schema.aiEvalRunItems.runId, start.body.run_id));
    expect(items).toHaveLength(6);
    const denied = await admin.call('PATCH', `/admin/prompts/versions/${v2}/status`, { status: 'canary', canary_percent: 30 });
    expect(denied.status).toBe(409);
    expect(denied.body.error.details.eval_gate.reason).toBe('mock_only');
  });

  it('eval thật đạt ngưỡng → canary 30 % → active: v1 retired, cache của v1 bị xoá, registry phục vụ v2', async () => {
    const v2 = (globalThis as { __v2?: string }).__v2!;
    const [set] = await dbs.db.select().from(schema.aiEvalSets).where(eq(schema.aiEvalSets.taskCode, 'explain_mcq')).limit(1);
    // Mô phỏng một run THẬT (provider live) đạt ngưỡng – môi trường test không có khoá AI
    await dbs.db.insert(schema.aiEvalRuns).values({ evalSetId: set!.id, promptVersionId: v2, model: 'google:gemini-flash', passed: true, triggeredBy: 'ci', metrics: { mock: false, n: 120, teacher_rating_mean: 4.3, factual_error_rate: 0.01, latency_p95_ms: 4200, cost_usd: 0.0012, correct_option_match: 1, schema_valid: 1 } });
    const canary = await admin.call('PATCH', `/admin/prompts/versions/${v2}/status`, { status: 'canary', canary_percent: 30 });
    expect(canary.status).toBe(200);
    expect(canary.body.version).toMatchObject({ status: 'canary', canary_percent: 30 });
    expect(canary.body.eval_gate).toMatchObject({ ok: true, reason: 'passed', bypassed: false });
    const cache = app.get(ExplanationCacheService);
    const before = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(schema.aiExplanationCache).where(eq(schema.aiExplanationCache.promptVersionId, v1Id));
    expect(before[0]!.n).toBeGreaterThan(0);
    const act = await admin.call('PATCH', `/admin/prompts/versions/${v2}/status`, { status: 'active' });
    expect(act.status).toBe(200);
    expect(act.body.retired_version_ids).toContain(v1Id);
    expect(act.body.invalidated_cache_rows).toBeGreaterThan(0);
    const after = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(schema.aiExplanationCache).where(eq(schema.aiExplanationCache.promptVersionId, v1Id));
    expect(after[0]!.n).toBe(0);
    expect(await cache.get(mcqVersions[12]!, 'A', 'vi', v1Id)).toBeNull();
    const r = await learner.call('POST', '/ai/explain', { question_version_id: mcqVersions[12]!, chosen_option: 'A' });
    expect(String(r.headers['content-type'])).toContain('text/event-stream');
    expect(sseResult(r.raw)!.data.prompt_version_id).toBe(v2);
    // active duy nhất không retire được khi không có canary thay thế
    expect((await admin.call('PATCH', `/admin/prompts/versions/${v2}/status`, { status: 'retired' })).status).toBe(409);
    // ALLOW_UNEVALUATED_ACTIVATION chỉ có tác dụng ở development/test
    const v3 = await admin.call('POST', `/admin/prompts/${explainTemplateId}/versions`, { system_prompt: 'S {{> common_system}}', user_template: 'U {{stem}}', output_schema: { type: 'object' }, model_policy: { primary: 'google:gemini-flash' } });
    env.ALLOW_UNEVALUATED_ACTIVATION = true;
    const bypass = await admin.call('PATCH', `/admin/prompts/versions/${v3.body.id}/status`, { status: 'canary', canary_percent: 5 });
    expect(bypass.status).toBe(200);
    expect(bypass.body.eval_gate).toMatchObject({ ok: true, bypassed: true });
    env.APP_ENV = 'staging';
    const prodLike = await admin.call('PATCH', `/admin/prompts/versions/${v3.body.id}/status`, { status: 'active' });
    env.APP_ENV = 'test';
    env.ALLOW_UNEVALUATED_ACTIVATION = false;
    expect(prodLike.status).toBe(409);
    // Thu hồi canary v3 (canary → draft) để test quota không phụ thuộc nhóm canary của người dùng mới (canary không ghi cache chung – A57)
    expect((await admin.call('PATCH', `/admin/prompts/versions/${v3.body.id}/status`, { status: 'draft' })).status).toBe(200);
  });

  it('Free: explain lần 11 trong ngày → 429 remaining 0; 00:00 giờ VN reset; hoàn quota khi AI lỗi; usage_counters chốt đúng', async () => {
    const clock = new FakeClock(Date.parse('2026-11-01T16:55:00.000Z')); // 23:55 giờ VN
    const restore = useClock(clock);
    try {
      const fresh = client(app);
      const userId = await register(fresh);
      for (let i = 0; i < 10; i++) {
        const r = await fresh.call('POST', '/ai/explain', { question_version_id: mcqVersions[i]!, chosen_option: 'C' });
        expect(r.status).toBe(200);
        expect(r.raw).toContain('event: result');
      }
      const ent = await fresh.call('GET', '/me/entitlements?program=toeic');
      expect(ent.body.quotas.find((q: { feature: string }) => q.feature === 'ai_explain')).toMatchObject({ limit: 10, used: 10, remaining: 0, reset_at: '2026-11-01T17:00:00.000Z' });
      const over = await fresh.call('POST', '/ai/explain', { question_version_id: mcqVersions[10]!, chosen_option: 'C' });
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('quota_exceeded');
      expect(over.body.error.details.quota).toMatchObject({ feature: 'ai_explain', period: 'day', limit: 10, used: 10, remaining: 0, resets_at: '2026-11-01T17:00:00.000Z' });
      // Cache hit không tính lượt (đã giải thích câu 0 với 'C')
      expect((await fresh.call('POST', '/ai/explain', { question_version_id: mcqVersions[0]!, chosen_option: 'C' })).status).toBe(200);

      clock.set(Date.parse('2026-11-01T17:00:01.000Z')); // 00:00:01 ngày 02/11 giờ VN
      const ok = await fresh.call('POST', '/ai/explain', { question_version_id: mcqVersions[10]!, chosen_option: 'C' });
      expect(ok.status).toBe(200);
      expect(ok.raw).toContain('event: result');
      // AI lỗi → sự kiện error, quota được hoàn
      const router = app.get(ModelRouter);
      const original = router.mock;
      router.setAdapter('mock', new MockProvider({ failTaskCodes: new Set(['explain_mcq']) }));
      const failed = await fresh.call('POST', '/ai/explain', { question_version_id: mcqVersions[11]!, chosen_option: 'C' });
      router.setAdapter('mock', original);
      expect(failed.raw).toContain('event: error');
      const e2 = await fresh.call('GET', '/me/entitlements?program=toeic');
      expect(e2.body.quotas.find((q: { feature: string }) => q.feature === 'ai_explain')).toMatchObject({ used: 1, remaining: 9, reset_at: '2026-11-02T17:00:00.000Z' });

      const n = await app.get(QuotaService).flushToDb({ userIds: [userId] });
      expect(n).toBeGreaterThanOrEqual(2);
      const counters = await dbs.db.select().from(schema.billingUsageCounters).where(and(eq(schema.billingUsageCounters.userId, userId), eq(schema.billingUsageCounters.featureCode, 'ai_explain')));
      const byKey = Object.fromEntries(counters.map((c) => [c.periodKey, c.used]));
      expect(byKey).toMatchObject({ 'day:2026-11-01': 10, 'day:2026-11-02': 1 });
    } finally {
      restore();
    }
  });
});
