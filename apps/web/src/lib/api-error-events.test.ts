import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { FEATURE_DISABLED_EVENT, RATE_LIMITED_EVENT, notifyApiError, parseRateLimited, shouldRetryQuery, waitParts } from './api-error-events';
import { QUOTA_EXCEEDED_EVENT } from './quota';

const rl = (details: Record<string, unknown>) => new ApiError(429, { error: { code: 'rate_limited', message: 'Too many requests', details } });

describe('429 rate_limited (S11)', () => {
  it('phân loại khoá đăng nhập / toàn cục theo IP / token bucket', () => {
    expect(parseRateLimited(rl({ retry_after_sec: 900, reason: 'login_locked' }))).toEqual({ retryAfterSec: 900, kind: 'login_locked', bucket: null });
    expect(parseRateLimited(rl({ retry_after_sec: 12, scope: 'global_ip', limit: 300 }))).toEqual({ retryAfterSec: 12, kind: 'global_ip', bucket: null });
    expect(parseRateLimited(rl({ retry_after_sec: 3, bucket: 'explain' }))).toEqual({ retryAfterSec: 3, kind: 'bucket', bucket: 'explain' });
    expect(parseRateLimited(rl({}))).toEqual({ retryAfterSec: null, kind: 'other', bucket: null });
    // retry_after là chuỗi số (header chép vào) / số thập phân → làm tròn lên
    expect(parseRateLimited(rl({ retry_after_sec: '7' }))!.retryAfterSec).toBe(7);
    expect(parseRateLimited(rl({ retry_after_sec: 1.2 }))!.retryAfterSec).toBe(2);
    // 429 hạn mức gói không phải giới hạn tốc độ
    expect(parseRateLimited(new ApiError(429, { error: { code: 'quota_exceeded', message: 'q' } }))).toBeNull();
    expect(parseRateLimited(new TypeError('Failed to fetch'))).toBeNull();
  });

  it('waitParts: < 90 s theo giây, còn lại theo phút', () => {
    expect(waitParts(null)).toEqual({ unit: 'unknown', value: 0 });
    expect(waitParts(45)).toEqual({ unit: 'seconds', value: 45 });
    expect(waitParts(89)).toEqual({ unit: 'seconds', value: 89 });
    expect(waitParts(90)).toEqual({ unit: 'minutes', value: 2 });
    expect(waitParts(900)).toEqual({ unit: 'minutes', value: 15 });
  });

  it('không tự thử lại 429/kill-switch/lỗi nghiệp vụ; lỗi mạng/5xx khác thử 2 lần', () => {
    expect(shouldRetryQuery(0, rl({ retry_after_sec: 5 }))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(503, { error: { code: 'feature_disabled', message: 'off', details: { flag: 'ff.ai.explain' } } }))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(404, undefined))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(502, undefined))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(2, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('notifyApiError phát đúng một sự kiện theo loại lỗi', () => {
  let events: Array<{ type: string; detail: unknown }>;
  const target = new EventTarget();
  beforeEach(() => {
    events = [];
    vi.stubGlobal('window', target);
    for (const t of [RATE_LIMITED_EVENT, FEATURE_DISABLED_EVENT, QUOTA_EXCEEDED_EVENT]) target.addEventListener(t, (e) => events.push({ type: t, detail: (e as CustomEvent).detail }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('429 rate_limited → allingo:rate-limited; 503 kill-switch → allingo:feature-disabled; 429 quota → quota; lỗi khác → không gì', () => {
    notifyApiError(rl({ retry_after_sec: 30, bucket: 'explain' }));
    notifyApiError(new ApiError(503, { error: { code: 'feature_disabled', message: 'off', details: { flag: 'ff.ai.explain', message_key: 'errors.feature_disabled', retry_after_sec: 60 } } }));
    notifyApiError(new ApiError(429, { error: { code: 'quota_exceeded', message: 'q', details: { quota: { feature: 'ai_explain', limit: 10, used: 10, remaining: 0, period: 'day' } } } }));
    notifyApiError(new ApiError(500, undefined));
    notifyApiError(new ApiError(503, { error: { code: 'feature_disabled', message: 'push off' } }));
    expect(events.map((e) => e.type)).toEqual([RATE_LIMITED_EVENT, FEATURE_DISABLED_EVENT, QUOTA_EXCEEDED_EVENT]);
    expect(events[0]!.detail).toEqual({ retryAfterSec: 30, kind: 'bucket', bucket: 'explain' });
    expect(events[1]!.detail).toMatchObject({ flag: 'ff.ai.explain', retryAfterSec: 60 });
  });
});
