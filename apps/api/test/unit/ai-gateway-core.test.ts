import { describe, expect, it, vi } from 'vitest';
import { costUsd, DEFAULT_MODEL_PRICING, priceFor, pricingForAliases } from '@allingo/schemas';
import { FakeClock } from '../../src/shared/clock/clock.module.js';
import { CircuitBreaker } from '../../src/modules/ai-gateway/core/circuit-breaker.js';
import { backoffDelay, errorCodeOf, isTransientError, withRetry } from '../../src/modules/ai-gateway/core/retry.js';
import { checkThresholds, thresholdsFor } from '../../src/modules/ai-gateway/core/eval-thresholds.js';
import { ModelRouter } from '../../src/modules/ai-gateway/core/model-router.js';
import { bucket } from '../../src/modules/ai-gateway/core/task-registry.js';
import type { ModelProviderAdapter, ResolvedTask } from '../../src/modules/ai-gateway/core/types.js';
import type { Env } from '../../src/config/env.js';

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { statusCode: status });

describe('CircuitBreaker (5 lỗi / 60 s → OPEN, half-open sau 60 s)', () => {
  const make = (clock: FakeClock, events = {}) => new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 60_000 }, clock, events);

  it('mở sau 5 lỗi trong cửa sổ 60 s và gọi onOpen (log cảnh báo)', () => {
    const clock = new FakeClock(0);
    const onOpen = vi.fn();
    const b = make(clock, { onOpen });
    for (let i = 0; i < 4; i++) {
      b.onFailure();
      clock.advance(1000);
    }
    expect(b.state).toBe('closed');
    b.onFailure();
    expect(b.state).toBe('open');
    expect(b.canRequest()).toBe(false);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ failures: 5 }));
  });

  it('lỗi rải ngoài cửa sổ 60 s không mở breaker', () => {
    const clock = new FakeClock(0);
    const b = make(clock);
    for (let i = 0; i < 10; i++) {
      b.onFailure();
      clock.advance(20_000);
    }
    expect(b.state).toBe('closed');
  });

  it('sau 60 s → HALF_OPEN chỉ cho 1 probe; probe thành công → CLOSED, thất bại → OPEN lại', () => {
    const clock = new FakeClock(0);
    const onClose = vi.fn();
    const onHalfOpen = vi.fn();
    const b = make(clock, { onClose, onHalfOpen });
    for (let i = 0; i < 5; i++) b.onFailure();
    clock.advance(59_999);
    expect(b.canRequest()).toBe(false);
    clock.advance(1);
    expect(b.state).toBe('half_open');
    expect(onHalfOpen).toHaveBeenCalledTimes(1);
    expect(b.canRequest()).toBe(true);
    b.begin();
    expect(b.canRequest()).toBe(false);
    b.onFailure();
    expect(b.state).toBe('open');
    clock.advance(60_000);
    expect(b.canRequest()).toBe(true);
    b.begin();
    b.onSuccess();
    expect(b.state).toBe('closed');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(b.snapshot().state).toBe('closed');
  });
});

describe('retry có jitter (chỉ lỗi tạm thời)', () => {
  it('phân loại lỗi tạm thời / vĩnh viễn', () => {
    for (const s of [408, 429, 500, 502, 503, 504, 529]) expect(isTransientError(http(s))).toBe(true);
    for (const s of [400, 401, 403, 404, 422]) expect(isTransientError(http(s))).toBe(false);
    expect(isTransientError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientError(new Error('fetch failed'))).toBe(true);
    expect(isTransientError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe(false);
    expect(isTransientError({ isRetryable: true, message: 'x' })).toBe(true);
    expect(errorCodeOf(http(429))).toBe('rate_limited');
    expect(errorCodeOf(http(401))).toBe('auth');
    expect(errorCodeOf(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe('timeout');
  });

  it('full jitter nằm trong [0, min(cap, base·2^n))', () => {
    expect(backoffDelay(0, 300, 4000, () => 0.999)).toBeLessThan(300);
    expect(backoffDelay(3, 300, 4000, () => 0.999)).toBeLessThan(2400);
    expect(backoffDelay(10, 300, 4000, () => 0.999)).toBeLessThan(4000);
    expect(backoffDelay(2, 300, 4000, () => 0)).toBe(0);
  });

  it('retry lỗi 503 tới hết số lần rồi ném; không retry 400', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      throw http(503);
    });
    await expect(withRetry(fn, { retries: 2, baseMs: 100, rand: () => 0.5, sleep: async (ms) => void sleeps.push(ms) })).rejects.toThrow('HTTP 503');
    expect(n).toBe(3);
    expect(sleeps).toEqual([50, 100]);
    const bad = vi.fn(async () => {
      throw http(400);
    });
    await expect(withRetry(bad, { retries: 3, baseMs: 1, sleep: async () => undefined })).rejects.toThrow('HTTP 400');
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('thành công sau 1 lỗi tạm thời; không chờ vượt deadline', async () => {
    let n = 0;
    const onRetry = vi.fn();
    const r = await withRetry(
      async () => {
        if (n++ === 0) throw http(502);
        return 'ok';
      },
      { retries: 2, baseMs: 1, sleep: async () => undefined, onRetry },
    );
    expect(r).toBe('ok');
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
    await expect(withRetry(async () => Promise.reject(http(503)), { retries: 5, baseMs: 1000, rand: () => 0.9, deadline: 100, now: () => 0, sleep: async () => undefined })).rejects.toThrow('503');
  });
});

describe('bảng giá & chi phí (không hard-code rải rác)', () => {
  it('route params.pricing ghi đè bảng mặc định; tính USD theo token', () => {
    expect(priceFor('google:gemini-flash', null)).toEqual(DEFAULT_MODEL_PRICING['google:gemini-flash']);
    expect(priceFor('google:gemini-flash', { 'google:gemini-flash': { in: 1, out: 2 } })).toEqual({ model: 'google:gemini-flash', in: 1, out: 2 });
    expect(costUsd({ model: 'x', in: 0.3, out: 2.5 }, 1000, 400)).toBeCloseTo(0.0013, 6);
    expect(costUsd(null, 10, 10)).toBeNull();
    expect(costUsd(DEFAULT_MODEL_PRICING['openai:gpt-mini'], null, 10)).toBeNull();
    expect(Object.keys(pricingForAliases(['google:gemini-flash', 'openai:gpt-mini', 'unknown:x']))).toEqual(['google:gemini-flash', 'openai:gpt-mini']);
  });
});

describe('ngưỡng eval', () => {
  it('_min/_max; metric thiếu → không đạt; explain_mcq thêm correct_option_match = 1', () => {
    const t = thresholdsFor('explain_mcq', { teacher_rating_mean_min: 4, latency_p95_ms_max: 6000 });
    expect(t).toMatchObject({ teacher_rating_mean_min: 4, latency_p95_ms_max: 6000, correct_option_match_min: 1 });
    expect(checkThresholds({ teacher_rating_mean: 4.2, latency_p95_ms: 3000, correct_option_match: 1, schema_valid: 1 }, t).ok).toBe(true);
    const r = checkThresholds({ teacher_rating_mean: null, latency_p95_ms: 3000, correct_option_match: 1, schema_valid: 1 }, t);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.metric === 'teacher_rating_mean')?.actual).toBeNull();
    expect(checkThresholds({}, {}).ok).toBe(false);
  });
});

describe('canary hash ổn định', () => {
  it('cùng user_id → cùng bucket 0..99; phân bố gần đều', () => {
    const id = '7d0f3a7c-1111-4c5e-9f00-123456789abc';
    expect(bucket(id)).toBe(bucket(id));
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 5000; i++) counts[Math.floor(bucket(`user-${i}`) / 10)]++;
    for (const c of counts) expect(c).toBeGreaterThan(380);
  });
});

describe('ModelRouter – fallback khi thiếu khoá / breaker mở', () => {
  const env = (over: Partial<Env> = {}) =>
    ({ AI_PROVIDER: 'live', APP_ENV: 'test', AI_BREAKER_FAILURES: 5, AI_BREAKER_WINDOW_MS: 60_000, AI_BREAKER_OPEN_MS: 60_000, GEMINI_FLASH_MODEL: 'gemini-2.5-flash', GEMINI_PRO_MODEL: 'gemini-2.5-pro', CLAUDE_SONNET_MODEL: 'claude-sonnet-4-5', CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5', OPENAI_GPT_MODEL: 'gpt-5', OPENAI_GPT_MINI_MODEL: 'gpt-5-mini', ...over }) as Env;
  const task = { taskCode: 'explain_mcq', route: { primaryModel: 'google:gemini-flash', fallbackModels: ['openai:gpt-mini', 'anthropic:claude-haiku'], params: {}, timeoutMs: 1000, creditsCost: 1 } } as unknown as ResolvedTask;
  const adapter = (provider: 'google' | 'openai' | 'anthropic', configured = true): ModelProviderAdapter => ({ provider, isConfigured: () => configured, generate: vi.fn(), stream: vi.fn() as never });

  it('tắt khoá Gemini → primary bị bỏ qua, ứng viên đầu là fallback (isPrimary = false)', () => {
    const r = new ModelRouter(env(), new FakeClock(0));
    r.setAdapter('google', adapter('google', false));
    r.setAdapter('openai', adapter('openai'));
    r.setAdapter('anthropic', adapter('anthropic'));
    const c = r.candidates(task);
    expect(c.map((x) => x.model.alias)).toEqual(['openai:gpt-mini', 'anthropic:claude-haiku']);
    expect(c[0]!.isPrimary).toBe(false);
    expect(c[0]!.model.modelId).toBe('gpt-5-mini');
  });

  it('breaker mở → bỏ qua provider; staging không trả mock khi hết model', () => {
    const clock = new FakeClock(0);
    const r = new ModelRouter(env(), clock);
    r.setAdapter('google', adapter('google'));
    r.setAdapter('openai', adapter('openai', false));
    r.setAdapter('anthropic', adapter('anthropic', false));
    expect(r.candidates(task)[0]!.isPrimary).toBe(true);
    for (let i = 0; i < 5; i++) r.recordFailure('google');
    expect(r.isOpen('google')).toBe(true);
    // dev/test: hết model → mock (cảnh báo)
    expect(r.candidates(task).map((x) => x.model.provider)).toEqual(['mock']);
    const staging = new ModelRouter(env({ APP_ENV: 'staging' }), clock);
    staging.setAdapter('google', adapter('google', false));
    staging.setAdapter('openai', adapter('openai', false));
    staging.setAdapter('anthropic', adapter('anthropic', false));
    expect(staging.candidates(task)).toEqual([]);
    clock.advance(60_000);
    expect(r.candidates(task)[0]!.model.provider).toBe('google');
  });
});
