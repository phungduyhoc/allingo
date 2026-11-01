import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { costUsd, DEFAULT_MODEL_PRICING, type AiProvider } from '@allingo/schemas';
import { ENV, type Env } from '../../src/config/env.js';
import { FakeClock, useClock } from '../../src/shared/clock/clock.module.js';
import { DbService } from '../../src/shared/db/db.module.js';
import { AiGatewayService, AiTaskFailedError, ExplainService, ModelRouter, type ModelProviderAdapter, type ProviderCallOptions, type ProviderResult } from '../../src/modules/ai-gateway/index.js';
import { buildMock } from '../../src/modules/ai-gateway/providers/mock.provider.js';
import { CatalogQueryService } from '../../src/modules/catalog/index.js';
import { CreditService } from '../../src/modules/billing/index.js';
import { bootTestApp, client } from './setup.js';

type Step = 'ok' | 'invalid' | number | 'timeout';

/** Adapter giả lập provider thật: kịch bản theo lần gọi (ok | invalid | HTTP status | timeout) */
class ScriptedAdapter implements ModelProviderAdapter {
  calls = 0;
  streamCalls = 0;
  constructor(
    readonly provider: AiProvider,
    private readonly script: Step[],
    private readonly configured = true,
    private readonly streamFailStatus: number | null = null,
  ) {}
  isConfigured() {
    return this.configured;
  }
  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls++;
    if (typeof step === 'number') throw Object.assign(new Error(`HTTP ${step} from ${this.provider}`), { statusCode: step });
    if (step === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const user = opts.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    // Repair prompt không có biến → dựng lại từ prompt gốc (user đầu tiên)
    const original = opts.messages.find((m) => m.role === 'user' && m.content.includes('<user_input>'))?.content ?? user;
    const text = step === 'invalid' ? '{"oops": true}' : JSON.stringify(buildMock(opts.taskCode, original));
    return { text, tokensIn: 1000, tokensOut: 400, costUsd: null, modelId: opts.model.modelId, provider: this.provider };
  }
  async *stream(opts: ProviderCallOptions) {
    this.streamCalls++;
    if (this.streamFailStatus) throw Object.assign(new Error(`HTTP ${this.streamFailStatus}`), { statusCode: this.streamFailStatus });
    const r = await this.generate(opts);
    yield { type: 'delta' as const, text: r.text.slice(0, 10) };
    yield { type: 'delta' as const, text: r.text.slice(10) };
    yield { type: 'final' as const, result: r };
  }
}

/**
 * Sprint 5 – AI Gateway mức sản xuất (provider giả lập, không khoá thật): fallback khi tắt khoá primary, retry jitter,
 * circuit breaker 5 lỗi/60 s + half-open, repair, failed không trừ credit, rollback khi persist lỗi, timeout,
 * ai_tasks đủ trường (prompt_version_id, model, tokens, cost_usd theo bảng giá route, latency, cache_hit, fallback_used, error_code),
 * /v1/metrics được bảo vệ, báo cáo chi phí theo ngày/task/model.
 */
describe('AI Gateway production (integration)', () => {
  let app: NestFastifyApplication;
  let env: Env;
  let router: ModelRouter;
  let gateway: AiGatewayService;
  let dbs: DbService;
  let variables: Record<string, unknown>;
  const originals: Partial<Record<AiProvider, ModelProviderAdapter | undefined>> = {};
  let restoreClock: (() => void) | null = null;
  const clock = new FakeClock(Date.now());
  let learnerId = '';

  const setAdapters = (map: Partial<Record<'google' | 'openai' | 'anthropic', ModelProviderAdapter>>) => {
    for (const [p, a] of Object.entries(map)) router.setAdapter(p as AiProvider, a);
  };
  const lastTask = async () => (await dbs.db.select().from(schema.aiAiTasks).where(eq(schema.aiAiTasks.taskCode, 'explain_mcq')).orderBy(desc(schema.aiAiTasks.createdAt)).limit(1))[0]!;
  const run = () => gateway.runTask({ taskCode: 'explain_mcq', userId: null, chargeCredits: false, variables, program: 'toeic', inputRef: { purpose: 'test' } });

  beforeAll(async () => {
    app = await bootTestApp();
    env = app.get(ENV);
    router = app.get(ModelRouter);
    gateway = app.get(AiGatewayService);
    dbs = app.get(DbService);
    for (const p of ['google', 'openai', 'anthropic'] as const) originals[p] = router.adapterOf(p);
    const [qv] = await dbs.db
      .select({ id: schema.catalogQuestionVersions.id })
      .from(schema.catalogQuestions)
      .innerJoin(schema.catalogQuestionVersions, eq(schema.catalogQuestionVersions.id, schema.catalogQuestions.currentVersionId))
      .where(and(eq(schema.catalogQuestions.status, 'published'), eq(schema.catalogQuestions.questionTypeCode, 'mcq_single'), sql`${schema.catalogQuestionVersions.content} ->> 'stem' <> ''`))
      .limit(1);
    const q = (await app.get(CatalogQueryService).loadByVersionIds([qv!.id])).get(qv!.id)!;
    variables = ExplainService.variablesOf(q, 'B', 'vi');
    const [u] = await dbs.db.select({ id: schema.iamUsers.id }).from(schema.iamUsers).where(eq(schema.iamUsers.email, 'learner_free@allingo.dev'));
    learnerId = u!.id;
    await dbs.db.transaction((tx) => app.get(CreditService).grant(tx, learnerId, 50, 'admin_adjust', { note: 'it-ai-gateway-s5' }));
    restoreClock = useClock(clock);
  });

  afterEach(() => {
    env.AI_PROVIDER = 'mock';
    env.AI_RETRY_MAX = 2;
    env.AI_RETRY_BASE_MS = 300;
    for (const [p, a] of Object.entries(originals)) if (a) router.setAdapter(p as AiProvider, a);
    router.resetBreakers();
  });

  afterAll(async () => {
    restoreClock?.();
    await app?.close();
  });

  it('tắt khoá Gemini → explain dùng fallback theo model_routes; ai_tasks ghi đủ trường + fallback_used = true', async () => {
    env.AI_PROVIDER = 'live';
    const openai = new ScriptedAdapter('openai', ['ok']);
    setAdapters({ google: new ScriptedAdapter('google', ['ok'], false), openai, anthropic: new ScriptedAdapter('anthropic', ['ok']) });
    const r = await run();
    expect(r.fallbackUsed).toBe(true);
    expect(r.model?.alias).toBe('openai:gpt-mini');
    expect(openai.calls).toBe(1);
    const t = await lastTask();
    const [route] = await dbs.db.select().from(schema.aiModelRoutes).where(eq(schema.aiModelRoutes.taskCode, 'explain_mcq'));
    const pricing = (route!.params as { pricing: Record<string, { in: number; out: number }> }).pricing;
    expect(pricing['openai:gpt-mini']).toMatchObject({ in: DEFAULT_MODEL_PRICING['openai:gpt-mini']!.in });
    expect(t).toMatchObject({ status: 'succeeded', fallbackUsed: true, cacheHit: false, modelUsed: 'gpt-5-mini', provider: 'openai', tokensIn: 1000, tokensOut: 400, errorCode: null, promptVersionId: r.promptVersionId });
    expect(Number(t.costUsd)).toBeCloseTo(costUsd({ model: 'x', ...pricing['openai:gpt-mini']! }, 1000, 400)!, 6);
    expect(t.latencyMs).toBeGreaterThanOrEqual(0);
    expect(t.output).toMatchObject({ _redacted: true });
  });

  it('lỗi tạm thời (503) được retry có jitter trên cùng model → thành công, không fallback', async () => {
    env.AI_PROVIDER = 'live';
    env.AI_RETRY_MAX = 2;
    env.AI_RETRY_BASE_MS = 1;
    const google = new ScriptedAdapter('google', [503, 'ok']);
    const openai = new ScriptedAdapter('openai', ['ok']);
    setAdapters({ google, openai, anthropic: new ScriptedAdapter('anthropic', ['ok'], false) });
    const r = await run();
    expect(google.calls).toBe(2);
    expect(openai.calls).toBe(0);
    expect(r.fallbackUsed).toBe(false);
    expect((await lastTask()).fallbackUsed).toBe(false);
  });

  it('5 lỗi liên tiếp → breaker mở (bỏ qua Gemini), sau 60 s half-open probe thành công → đóng', async () => {
    env.AI_PROVIDER = 'live';
    env.AI_RETRY_MAX = 0;
    const google = new ScriptedAdapter('google', [503, 503, 503, 503, 503, 'ok']);
    const openai = new ScriptedAdapter('openai', ['ok']);
    setAdapters({ google, openai, anthropic: new ScriptedAdapter('anthropic', ['ok'], false) });
    for (let i = 0; i < 5; i++) {
      const r = await run();
      expect(r.fallbackUsed).toBe(true);
    }
    expect(google.calls).toBe(5);
    expect(router.isOpen('google')).toBe(true);
    await run();
    expect(google.calls).toBe(5); // breaker mở: không gọi Gemini
    expect(openai.calls).toBe(6);
    const metrics = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/v1/metrics', headers: { 'x-internal-token': env.INTERNAL_API_TOKEN } });
    expect(metrics.body).toContain('ai_provider_circuit_state{provider="google"} 2');
    clock.advance(60_000);
    const r = await run();
    expect(google.calls).toBe(6); // half-open: 1 probe
    expect(r.fallbackUsed).toBe(false);
    expect(router.breakerSnapshot().google?.state).toBe('closed');
  });

  it('đầu ra sai schema → repair 1 lần cùng model; vẫn sai → model kế tiếp; hết model → failed (invalid_output), không trừ credit', async () => {
    env.AI_PROVIDER = 'live';
    const google = new ScriptedAdapter('google', ['invalid', 'ok']);
    setAdapters({ google, openai: new ScriptedAdapter('openai', ['ok']), anthropic: new ScriptedAdapter('anthropic', ['ok'], false) });
    const r = await run();
    expect(r.repaired).toBe(true);
    expect(google.calls).toBe(2);
    expect((await lastTask()).error).toBe('repaired');

    setAdapters({ google: new ScriptedAdapter('google', [400]), openai: new ScriptedAdapter('openai', ['invalid']), anthropic: new ScriptedAdapter('anthropic', ['invalid']) });
    const credits = app.get(CreditService);
    const before = await credits.balance(learnerId);
    const err = await gateway.runTask({ taskCode: 'explain_mcq', userId: learnerId, variables, program: 'toeic' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiTaskFailedError);
    expect((err as AiTaskFailedError).reason).toBe('invalid_output');
    const t = await lastTask();
    expect(t).toMatchObject({ status: 'failed', errorCode: 'invalid_output', creditsCharged: 0, fallbackUsed: true });
    expect(await credits.balance(learnerId)).toBe(before);
  });

  it('timeout → status timeout; persist lỗi → rollback credit + task failed (persist_failed)', async () => {
    env.AI_PROVIDER = 'live';
    setAdapters({ google: new ScriptedAdapter('google', ['timeout']), openai: new ScriptedAdapter('openai', ['ok'], false), anthropic: new ScriptedAdapter('anthropic', ['ok'], false) });
    await expect(run()).rejects.toMatchObject({ reason: 'timeout' });
    expect(await lastTask()).toMatchObject({ status: 'timeout', errorCode: 'timeout' });

    setAdapters({ google: new ScriptedAdapter('google', ['ok']) });
    const credits = app.get(CreditService);
    const before = await credits.balance(learnerId);
    await expect(
      gateway.runTask({ taskCode: 'explain_mcq', userId: learnerId, variables, program: 'toeic' }, async () => {
        throw new Error('business write failed');
      }),
    ).rejects.toThrow('business write failed');
    expect(await credits.balance(learnerId)).toBe(before);
    expect(await lastTask()).toMatchObject({ status: 'failed', errorCode: 'persist_failed', creditsCharged: 0 });
  });

  it('stream: primary lỗi 401 trước delta → fallback không stream, vẫn có result; fallback_used = true', async () => {
    env.AI_PROVIDER = 'live';
    const google = new ScriptedAdapter('google', ['ok'], true, 401);
    const openai = new ScriptedAdapter('openai', ['ok']);
    setAdapters({ google, openai, anthropic: new ScriptedAdapter('anthropic', ['ok'], false) });
    const events = [];
    for await (const ev of gateway.streamTask({ taskCode: 'explain_mcq', userId: null, chargeCredits: false, variables, program: 'toeic' })) events.push(ev);
    expect(events.map((e) => e.event)).toEqual(['start', 'result', 'done']);
    expect(google.streamCalls).toBe(1);
    expect(google.calls).toBe(0);
    expect(openai.calls).toBe(1);
    expect((await lastTask()).fallbackUsed).toBe(true);
  });

  it('/v1/metrics: 401 khi thiếu token; 200 text Prometheus khi có token nội bộ', async () => {
    const f = app.getHttpAdapter().getInstance();
    expect((await f.inject({ method: 'GET', url: '/v1/metrics' })).statusCode).toBe(401);
    expect((await f.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const ok = await f.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${env.INTERNAL_API_TOKEN}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/plain');
    for (const m of ['ai_task_duration_seconds_bucket', 'ai_task_cost_usd_total', 'ai_task_failures_total{task="explain_mcq"', 'ai_task_fallbacks_total']) expect(ok.body).toContain(m);
    expect(ok.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('GET /admin/reports/ai-costs: theo ngày/task/model, tổng khớp tổng các dòng', async () => {
    const admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: 'Allingo@2026' })).status).toBe(200);
    const r = await admin.call('GET', '/admin/reports/ai-costs');
    expect(r.status).toBe(200);
    expect(r.body.timezone).toBe('Asia/Ho_Chi_Minh');
    const rowsCost = r.body.rows.reduce((s: number, x: { cost_usd: number }) => s + x.cost_usd, 0);
    expect(r.body.totals.cost_usd).toBeCloseTo(rowsCost, 6);
    expect(r.body.by_model['gpt-5-mini'].fallbacks).toBeGreaterThan(0);
    expect(Object.keys(r.body.by_day).length).toBeGreaterThan(0);
    expect(r.body.by_task.explain_mcq.failed).toBeGreaterThan(0);
    const learner = client(app);
    await learner.call('POST', '/auth/guest', {});
    expect((await learner.call('GET', '/admin/reports/ai-costs')).status).toBe(403);
  });
});
