import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { VercelProvider } from '../../src/modules/ai-gateway/providers/vercel.provider.js';
import { MockEmbeddingProvider, cosine, normalizeForEmbedding } from '../../src/modules/ai-gateway/providers/embedding.provider.js';
import { buildMock, extractVars } from '../../src/modules/ai-gateway/providers/mock.provider.js';
import { AiTelemetry, HttpLangfuseClient, type LangfuseEvent } from '../../src/modules/ai-gateway/core/ai-telemetry.js';
import { MetricsRegistry } from '../../src/shared/telemetry/metrics.js';
import { numericFidelity } from '../../src/modules/learning/attempt-summary.service.js';
import type { ProviderCallOptions } from '../../src/modules/ai-gateway/core/types.js';
import type { Env } from '../../src/config/env.js';

const usage = (i: number, o: number) => ({ inputTokens: { total: i, noCache: i, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: o, text: o, reasoning: 0 } });
const opts = (provider: 'google' | 'anthropic' | 'openai'): ProviderCallOptions => ({
  model: { alias: `${provider}:x`, provider, modelId: 'model-x' },
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
  ],
  temperature: 0.2,
  topP: 0.9,
  maxTokens: 100,
  timeoutMs: 5000,
  taskCode: 'explain_mcq',
});

describe('VercelProvider với MockLanguageModelV4 (không gọi mạng)', () => {
  it('generate: trả text + token; bật JSON mode cho google/openai, không cho anthropic; SDK không tự retry', async () => {
    for (const provider of ['google', 'openai', 'anthropic'] as const) {
      const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(12, 5), warnings: [] }) });
      const p = new VercelProvider(provider, 'k', () => model);
      const r = await p.generate(opts(provider));
      expect(r).toMatchObject({ text: '{"a":1}', tokensIn: 12, tokensOut: 5, provider, modelId: 'model-x', costUsd: null });
      const call = model.doGenerateCalls[0]!;
      if (provider === 'anthropic') expect(call.responseFormat?.type ?? 'text').toBe('text');
      else expect(call.responseFormat?.type).toBe('json');
      expect(call.abortSignal).toBeDefined();
      // AI SDK 7: system prompt đi qua `instructions` (không nằm trong messages) nhưng vẫn tới model ở đầu prompt
      expect(call.prompt[0]).toMatchObject({ role: 'system', content: 'sys' });
      expect(call.prompt.filter((m) => m.role === 'system')).toHaveLength(1);
    }
  });

  it('JSON mode trả văn bản không phải JSON → trả text để AiGateway repair (không ném lỗi provider)', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: 'not json at all' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(3, 4), warnings: [] }) });
    const r = await new VercelProvider('google', 'k', () => model).generate(opts('google'));
    expect(r.text).toBe('not json at all');
  });

  it('lỗi HTTP của provider được ném nguyên (để gateway phân loại retry/breaker)', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => Promise.reject(Object.assign(new Error('overloaded'), { statusCode: 529 })) });
    await expect(new VercelProvider('anthropic', 'k', () => model).generate(opts('anthropic'))).rejects.toMatchObject({ statusCode: 529 });
  });

  it('stream: delta theo từng phần + final có token', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: '{"a":' },
            { type: 'text-delta', id: '1', delta: '1}' },
            { type: 'text-end', id: '1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(7, 3) },
          ],
        }),
      }),
    });
    const chunks = [];
    for await (const c of new VercelProvider('openai', 'k', () => model).stream(opts('openai'))) chunks.push(c);
    expect(chunks.filter((c) => c.type === 'delta').map((c) => c.text).join('')).toBe('{"a":1}');
    expect(chunks.at(-1)).toMatchObject({ type: 'final', result: { text: '{"a":1}', tokensIn: 7, tokensOut: 3 } });
  });

  it('không có khoá → isConfigured = false', () => {
    expect(new VercelProvider('google', undefined).isConfigured()).toBe(false);
  });
});

describe('MockProvider – biến dạng `a: x | b: y` và đầu ra bám dữ liệu', () => {
  it('extractVars tách nhiều khoá trên một dòng, bỏ chú thích cuối dòng', () => {
    const v = extractVars('program: toeic | section: part5 | question_type: mcq_single | count: 10\ndifficulty_target: {"level":"B2","irt_b":0}   # {level, irt_b}\nstem: A | B is fine');
    expect(v).toMatchObject({ program: 'toeic', section: 'part5', count: '10', difficulty_target: '{"level":"B2","irt_b":0}', stem: 'A | B is fine' });
  });

  it('generate_questions: đúng count (≤ 50), câu cuối lặp forbidden stem khi count ≥ 5 (kiểm chứng cờ trùng)', () => {
    const user = 'program: toeic | section: part5 | question_type: mcq_single | count: 10\ntopic: logistics | allowed_subskills: ["verb_tense"]\nforbidden_recent_stems: ["The invoice must be ______ by Friday."]';
    const out = buildMock('generate_questions', user) as { questions: Array<{ content: { stem: string } }> };
    expect(out.questions).toHaveLength(10);
    expect(out.questions[0]!.content.stem).toContain('logistics');
    expect(out.questions[9]!.content.stem).toBe('The invoice must be ______ by Friday.');
    expect(new Set(out.questions.slice(0, 9).map((q) => q.content.stem)).size).toBe(9);
  });

  it('summarize_attempt mock vượt kiểm tra numeric fidelity', () => {
    const data = { program: 'toeic', scaled_score: 645, by_section: { part5: { correct: 6, total: 10 } }, by_subskill: { verb_tense: { correct: 1, total: 4 } }, allowed_task_types: ['part_drill'] };
    const user = `program: toeic | mode: drill | scaled_score: 645 | previous_scores: []\nby_section: ${JSON.stringify(data.by_section)}\nby_subskill: ${JSON.stringify(data.by_subskill)}\nallowed_task_types: ["part_drill"]`;
    const out = buildMock('summarize_attempt', user) as Parameters<typeof numericFidelity>[0];
    expect(out.weakest.evidence).toBe('wrong 3/4 in verb_tense');
    expect(numericFidelity(out, data)).toEqual([]);
    expect(numericFidelity({ ...out, headline: 'Tăng 87 điểm' }, data)).toEqual(['87']);
  });
});

describe('Embedding giả lập tất định (1536 chiều, cosine)', () => {
  it('giống hệt → 1; sửa nhẹ vẫn cao; khác chủ đề thấp; chuẩn hoá L2', async () => {
    const p = new MockEmbeddingProvider();
    const [a, b, c, d] = (await p.embed(['The invoice must be paid by Friday.', 'The invoice must be paid by Friday.', 'The invoice must be paid by next Friday.', 'Ms. Tran enjoys hiking in the mountains on weekends.'])).vectors;
    expect(a).toHaveLength(1536);
    expect(cosine(a!, b!)).toBeCloseTo(1, 6);
    expect(cosine(a!, c!)).toBeGreaterThan(0.8);
    expect(cosine(a!, d!)).toBeLessThan(0.3);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 6);
    expect(normalizeForEmbedding('  The ___ Café!! ')).toBe('the ___ café');
  });
});

describe('Quan sát: Prometheus registry, span ai.task, Langfuse (client giả)', () => {
  it('render text exposition có HELP/TYPE, nhãn escape, histogram bucket/+Inf/sum/count', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('ai_task_failures_total', 'x', ['task', 'model']);
    c.inc({ task: 'explain_mcq', model: 'google:"flash"' });
    c.inc({ task: 'explain_mcq', model: 'google:"flash"' }, 2);
    const h = reg.histogram('ai_task_duration_seconds', 'y', ['task'], [0.5, 1]);
    h.observe({ task: 'explain_mcq' }, 0.7);
    const out = reg.render();
    expect(out).toContain('# TYPE ai_task_failures_total counter');
    expect(out).toContain('ai_task_failures_total{task="explain_mcq",model="google:\\"flash\\""} 3');
    expect(out).toContain('ai_task_duration_seconds_bucket{task="explain_mcq",le="0.5"} 0');
    expect(out).toContain('ai_task_duration_seconds_bucket{task="explain_mcq",le="1"} 1');
    expect(out).toContain('ai_task_duration_seconds_bucket{task="explain_mcq",le="+Inf"} 1');
    expect(out).toContain('ai_task_duration_seconds_count{task="explain_mcq"} 1');
  });

  const baseEnv = { AUTH_SECRET: 'x'.repeat(40), APP_ENV: 'test', LANGFUSE_FLUSH_INTERVAL_MS: 1000 } as Env;
  const trace0 = (over = {}) => ({ aiTaskId: '00000000-0000-4000-8000-000000000001', traceId: 'trace-1', taskCode: 'explain_mcq', userId: 'f6a1c7c2-0000-4000-8000-000000000009', promptVersionId: 'pv-1', modelAlias: 'google:gemini-flash', modelId: 'gemini-2.5-flash', provider: 'google', status: 'succeeded' as const, errorCode: null, tokensIn: 900, tokensOut: 300, costUsd: 0.00102, latencyMs: 1500, cacheHit: false, fallbackUsed: true, repaired: false, startedAt: new Date(0), finishedAt: new Date(1500), input: [{ role: 'user' as const, content: 'stem: SECRET ESSAY TEXT' }], output: { why_correct: 'SECRET OUTPUT' }, ...over });

  it('Langfuse: user_id băm (HMAC), không gửi nội dung khi AI_TRACE_CONTENT=false; gửi khi true; cost = cost_usd', async () => {
    const batches: LangfuseEvent[][] = [];
    const tel = new AiTelemetry({ ...baseEnv, AI_TRACE_CONTENT: false });
    tel.setLangfuseClient({ ingest: async (b) => void batches.push(b) });
    tel.record(trace0());
    await tel.flush();
    const json = JSON.stringify(batches);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('f6a1c7c2-0000-4000-8000-000000000009');
    const gen = batches[0]!.find((e) => e.type === 'generation-create')!;
    expect(gen.body).toMatchObject({ id: '00000000-0000-4000-8000-000000000001', traceId: 'trace-1', model: 'gemini-2.5-flash', usage: { input: 900, output: 300, totalCost: 0.00102 }, metadata: { fallback_used: true, prompt_version_id: 'pv-1' } });
    const tr = batches[0]!.find((e) => e.type === 'trace-create')!;
    expect(String(tr.body.userId)).toMatch(/^u_[0-9a-f]{24}$/);
    expect(tel.hashUserId('f6a1c7c2-0000-4000-8000-000000000009')).toBe(tr.body.userId);

    const withContent = new AiTelemetry({ ...baseEnv, AI_TRACE_CONTENT: true });
    const b2: LangfuseEvent[][] = [];
    withContent.setLangfuseClient({ ingest: async (b) => void b2.push(b) });
    withContent.record(trace0());
    await withContent.flush();
    expect(JSON.stringify(b2)).toContain('SECRET OUTPUT');
  });

  it('HttpLangfuseClient: POST /api/public/ingestion với Basic auth; lỗi không làm hỏng flush', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 207 }));
    await new HttpLangfuseClient('https://lf.example', 'pk', 'sk', fetchImpl as unknown as typeof fetch).ingest([]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://lf.example/api/public/ingestion');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('pk:sk').toString('base64')}`);
    const tel = new AiTelemetry(baseEnv);
    tel.setLangfuseClient({ ingest: async () => Promise.reject(new Error('down')) });
    tel.record(trace0());
    await expect(tel.flush()).resolves.toBeUndefined();
  });

  it('span OTel `ai.task` có thuộc tính task/model/cost/fallback, không nội dung', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    try {
      const tel = new AiTelemetry(baseEnv);
      const span = tel.startSpan({ taskCode: 'explain_mcq', promptVersionId: 'pv-1', aiTaskId: 'task-1' });
      tel.record(trace0(), span);
      const [s] = exporter.getFinishedSpans();
      expect(s!.name).toBe('ai.task');
      expect(s!.attributes).toMatchObject({ 'ai.task_code': 'explain_mcq', 'ai.model': 'google:gemini-flash', 'ai.fallback_used': true, 'ai.cost_usd': 0.00102, 'ai.tokens_in': 900, 'ai.status': 'succeeded' });
      expect(JSON.stringify(s!.attributes)).not.toContain('SECRET');
    } finally {
      trace.disable();
    }
  });
});
