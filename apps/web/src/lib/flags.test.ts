import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { FLAG_DEFAULTS, PUBLIC_FLAG_KEYS, fetchPublicFlags, isFlagOn, markFlagDisabled, parseFeatureDisabled, parsePublicFlags } from './flags';

describe('cờ công khai GET /flags (S11)', () => {
  it('đọc thân hợp lệ, bỏ giá trị không phải boolean / khoá lạ, chặn ttl', () => {
    const p = parsePublicFlags({ flags: { 'ff.ai.explain': false, 'ff.ai.tutor': true, 'ff.x': 'yes', '<script>': true }, ttl_sec: 30, evaluated_at: '2026-11-08T00:00:00Z' });
    expect(p).toEqual({ flags: { 'ff.ai.explain': false, 'ff.ai.tutor': true }, ttlSec: 30, evaluatedAt: '2026-11-08T00:00:00Z' });
    expect(parsePublicFlags({ flags: {}, ttl_sec: 0 })!.ttlSec).toBe(5);
    expect(parsePublicFlags({ flags: {}, ttl_sec: 99_999 })!.ttlSec).toBe(300);
    expect(parsePublicFlags({ flags: {} })!.ttlSec).toBe(30);
    expect(parsePublicFlags(null)).toBeNull();
    expect(parsePublicFlags({ flags: [] })).toBeNull();
    expect(parsePublicFlags('x')).toBeNull();
  });

  it('isFlagOn: theo server khi có, không thì mặc định như FLAG_FALLBACKS của API; khoá lạ → tắt', () => {
    expect(isFlagOn(null, 'ff.ai.explain')).toBe(true);
    expect(isFlagOn(null, 'ff.ai.diagnose')).toBe(false);
    expect(isFlagOn(null, 'ff.catalog.program.ielts')).toBe(false);
    expect(isFlagOn({ flags: { 'ff.ai.explain': false }, ttlSec: 30, evaluatedAt: null }, 'ff.ai.explain')).toBe(false);
    expect(isFlagOn({ flags: { 'ff.ai.diagnose': true }, ttlSec: 30, evaluatedAt: null }, 'ff.ai.diagnose')).toBe(true);
    expect(isFlagOn({ flags: {}, ttlSec: 30, evaluatedAt: null }, 'ff.unknown.key')).toBe(false);
    // Mọi khoá công khai có mặc định
    for (const k of PUBLIC_FLAG_KEYS) expect(typeof FLAG_DEFAULTS[k]).toBe('boolean');
  });

  it('markFlagDisabled tắt đúng cờ, giữ cờ khác, chạy được khi chưa có dữ liệu', () => {
    const before = { flags: { 'ff.ai.explain': true, 'ff.ai.tutor': true }, ttlSec: 30, evaluatedAt: 'x' };
    const after = markFlagDisabled(before, 'ff.ai.explain');
    expect(after.flags).toEqual({ 'ff.ai.explain': false, 'ff.ai.tutor': true });
    expect(before.flags['ff.ai.explain']).toBe(true);
    expect(markFlagDisabled(undefined, 'ff.ai.tutor').flags).toEqual({ 'ff.ai.tutor': false });
  });

  it('fetchPublicFlags: GET {api}/flags kèm cookie; HTTP lỗi / thân sai → ném lỗi', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ flags: { 'ff.ai.explain': false }, ttl_sec: 30, evaluated_at: 'now' }), { status: 200 }));
    const r = await fetchPublicFlags('http://api.test/v1', { fetch: f as unknown as typeof fetch });
    expect(r.flags['ff.ai.explain']).toBe(false);
    expect(f).toHaveBeenCalledWith('http://api.test/v1/flags', expect.objectContaining({ method: 'GET', credentials: 'include', cache: 'no-store' }));
    await expect(fetchPublicFlags('http://api.test/v1', { fetch: (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch })).rejects.toThrow(/500/);
    await expect(fetchPublicFlags('http://api.test/v1', { fetch: (async () => new Response('{"x":1}', { status: 200 })) as unknown as typeof fetch })).rejects.toThrow(/invalid/);
  });

  it('parseFeatureDisabled chỉ nhận 503 kill-switch (có details.flag)', () => {
    const kill = new ApiError(503, { error: { code: 'feature_disabled', message: 'off', details: { flag: 'ff.ai.explain', message_key: 'errors.feature_disabled', retry_after_sec: 60 } } });
    expect(parseFeatureDisabled(kill)).toEqual({ flag: 'ff.ai.explain', messageKey: 'errors.feature_disabled', retryAfterSec: 60 });
    // 503 feature_disabled khác (push/OAuth chưa cấu hình – không có flag) → để màn hình tự xử lý
    expect(parseFeatureDisabled(new ApiError(503, { error: { code: 'feature_disabled', message: 'push', details: { reason: 'not_configured' } } }))).toBeNull();
    expect(parseFeatureDisabled(new ApiError(429, { error: { code: 'rate_limited', message: 'x' } }))).toBeNull();
    expect(parseFeatureDisabled(new Error('x'))).toBeNull();
    // message_key lạ → mặc định; retry không hợp lệ → null
    expect(parseFeatureDisabled(new ApiError(503, { error: { code: 'feature_disabled', message: 'x', details: { flag: 'ff.ai.tutor', message_key: 'javascript:alert(1)', retry_after_sec: -1 } } }))).toEqual({ flag: 'ff.ai.tutor', messageKey: 'errors.feature_disabled', retryAfterSec: null });
  });
});
