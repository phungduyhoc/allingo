import { describe, expect, it } from 'vitest';
import { ApiError, unwrap } from '@allingo/api-client';
import { normalizeErrorResponse, withTraceparent } from './api';
import { parseRateLimited } from './api-error-events';

describe('fetch wrapper API (S11)', () => {
  it('request ghi mang traceparent W3C; GET giữ là request đơn giản (không preflight thêm)', () => {
    const [, postInit] = withTraceparent('http://api/v1/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const h = new Headers(postInit!.headers);
    expect(h.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(h.get('content-type')).toBe('application/json');
    const [, getInit] = withTraceparent('http://api/v1/me', { method: 'GET' });
    expect(new Headers(getInit?.headers).get('traceparent')).toBeNull();
    const req = new Request('http://api/v1/attempts/1/submit', { method: 'POST' });
    const [out] = withTraceparent(req, undefined);
    expect((out as Request).headers.get('traceparent')).toMatch(/^00-/);
    // đã có traceparent → giữ nguyên
    const [, keep] = withTraceparent('http://api/v1/x', { method: 'PUT', headers: { traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' } });
    expect(new Headers(keep!.headers).get('traceparent')).toBe('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
  });

  it('429 thiếu details.retry_after_sec → chép từ Retry-After; trace_id từ X-Trace-Id', async () => {
    const res = new Response(JSON.stringify({ statusCode: 429, error: { code: 'rate_limited', message: 'Too many requests', details: { scope: 'global_ip' } } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '17', 'X-Trace-Id': 'abc123abc123abc123abc123abc12345' },
    });
    const out = await normalizeErrorResponse(res);
    const body = (await out.json()) as { statusCode: number; error: { details: Record<string, unknown>; trace_id: string } };
    expect(out.status).toBe(429);
    expect(body.statusCode).toBe(429);
    expect(body.error.details).toEqual({ scope: 'global_ip', retry_after_sec: 17 });
    expect(body.error.trace_id).toBe('abc123abc123abc123abc123abc12345');
    // ApiError dựng từ thân đã chuẩn hoá có thời gian chờ
    const err = (() => {
      try {
        unwrap({ error: body, response: new Response(null, { status: 429 }) });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ApiError);
    expect(parseRateLimited(err)).toEqual({ retryAfterSec: 17, kind: 'global_ip', bucket: null });
  });

  it('thân không phải JSON (proxy/WAF) → envelope tối thiểu; đã đủ trường hoặc mã khác 429/503 → giữ nguyên response', async () => {
    const waf = await normalizeErrorResponse(new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '5' } }));
    expect(await waf.json()).toEqual({ error: { code: 'rate_limited', message: 'Too Many Requests', details: { retry_after_sec: 5 }, trace_id: null } });
    const full = new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'x', details: { retry_after_sec: 3 }, trace_id: 't1' } }), { status: 429, headers: { 'Retry-After': '3', 'X-Trace-Id': 't1' } });
    expect(await normalizeErrorResponse(full)).toBe(full);
    const ok = new Response('{}', { status: 200, headers: { 'Retry-After': '3' } });
    expect(await normalizeErrorResponse(ok)).toBe(ok);
    const k = new Response(JSON.stringify({ error: { code: 'feature_disabled', message: 'off', details: { flag: 'ff.ai.explain', retry_after_sec: 60 }, trace_id: 'x' } }), { status: 503, headers: { 'Retry-After': '60', 'X-Trace-Id': 'x' } });
    expect(await normalizeErrorResponse(k)).toBe(k);
  });
});
