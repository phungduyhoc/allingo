import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { createMfaStepUpMiddleware, isStepUpCandidate, parseMfaRequired, requestStepUp, resetStepUpForTest, setStepUpHandler } from './mfa-step-up';

const mfaBody = { error: { code: 'mfa_required', message: 'MFA', details: { enroll_path: '/auth/mfa/totp/enroll', verify_path: '/auth/mfa/verify', reason: 'step_up_required' } } };
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('MFA step-up (S12)', () => {
  afterEach(() => resetStepUpForTest());

  it('nhận 403 mfa_required (enrolled có/không), bỏ qua lỗi khác', () => {
    expect(parseMfaRequired(new ApiError(403, mfaBody as never))).toEqual({ enrolled: null, reason: 'step_up_required' });
    expect(parseMfaRequired(new ApiError(403, { error: { code: 'mfa_required', message: 'x', details: { enrolled: false } } }))).toEqual({ enrolled: false, reason: null });
    expect(parseMfaRequired(new ApiError(403, { error: { code: 'forbidden', message: 'x' } }))).toBeNull();
    expect(parseMfaRequired(new TypeError('x'))).toBeNull();
  });

  it('chỉ giữ bản sao request quản trị (không /auth/*)', () => {
    expect(isStepUpCandidate('http://api/v1/admin/users/1/lock')).toBe(true);
    expect(isStepUpCandidate('http://api/v1/admin')).toBe(true);
    expect(isStepUpCandidate('http://api/v1/auth/mfa/verify')).toBe(false);
    expect(isStepUpCandidate('http://api/v1/me')).toBe(false);
  });

  it('không có trình xử lý → không gửi lại; nhiều request lỗi cùng lúc dùng chung MỘT lần hỏi', async () => {
    await expect(requestStepUp({ enrolled: true, reason: null })).resolves.toBe(false);
    let resolve!: (v: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    setStepUpHandler(handler);
    const a = requestStepUp({ enrolled: true, reason: null });
    const b = requestStepUp({ enrolled: true, reason: null });
    resolve(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('403 mfa_required → hỏi → gửi lại ĐÚNG request (method, body) một lần; huỷ → giữ 403', async () => {
    const sent: Array<{ method: string; body: string }> = [];
    const fetchFn = vi.fn(async (req: Request) => {
      sent.push({ method: req.method, body: await req.text() });
      return res(200, { ok: true });
    });
    const ask = vi.fn(async () => true);
    const mw = createMfaStepUpMiddleware({ fetch: fetchFn, ask });
    const req = new Request('http://api/v1/admin/users/u1/lock', { method: 'POST', body: JSON.stringify({ reason: 'abuse' }), headers: { 'content-type': 'application/json' } });
    mw.onRequest({ request: req, id: 'r1' });
    await req.text(); // fetch thật đã dùng mất thân request
    const out = await mw.onResponse({ request: req, response: res(403, mfaBody), id: 'r1' });
    expect(ask).toHaveBeenCalledWith({ enrolled: null, reason: 'step_up_required' });
    expect(out?.status).toBe(200);
    expect(sent).toEqual([{ method: 'POST', body: '{"reason":"abuse"}' }]);

    // Huỷ hộp thoại → trả nguyên 403 (undefined = giữ response gốc)
    const mw2 = createMfaStepUpMiddleware({ fetch: fetchFn, ask: async () => false });
    const r2 = new Request('http://api/v1/admin/flags', { method: 'GET' });
    mw2.onRequest({ request: r2, id: 'r2' });
    expect(await mw2.onResponse({ request: r2, response: res(403, mfaBody), id: 'r2' })).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('403 khác / 200 / endpoint không phải admin → không đụng tới', async () => {
    const fetchFn = vi.fn(async () => res(200, {}));
    const ask = vi.fn(async () => true);
    const mw = createMfaStepUpMiddleware({ fetch: fetchFn, ask });
    const admin = new Request('http://api/v1/admin/users');
    mw.onRequest({ request: admin, id: 'a' });
    expect(await mw.onResponse({ request: admin, response: res(403, { error: { code: 'forbidden', message: 'x' } }), id: 'a' })).toBeUndefined();
    const me = new Request('http://api/v1/me/attempts');
    mw.onRequest({ request: me, id: 'b' });
    expect(await mw.onResponse({ request: me, response: res(403, mfaBody), id: 'b' })).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
