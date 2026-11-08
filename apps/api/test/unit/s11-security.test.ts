import { describe, expect, it } from 'vitest';
import { csrfCheck, trustedOrigins } from '../../src/shared/http/security.js';
import { identifierSubject, RATE_BUCKETS, tokenBucketStep } from '../../src/shared/http/rate-limit.js';
import { withMinDuration } from '../../src/modules/iam/login-protection.service.js';
import { evaluateFlag, PUBLIC_FLAG_KEYS } from '../../src/modules/billing/feature-flags.service.js';

const env = { CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001', WEB_PUBLIC_URL: 'https://allingo.vn', API_PUBLIC_URL: 'https://api.allingo.vn', CMS_PUBLIC_URL: 'https://cms.allingo.vn', CSRF_TRUSTED_ORIGINS: 'https://app.allingo.vn/' };
const trusted = trustedOrigins(env);
const cookie = { allingo_at: 'jwt' };
const req = (o: Partial<Parameters<typeof csrfCheck>[0]>) => ({ method: 'POST', url: '/v1/notes', headers: {}, cookies: cookie, ...o });

describe('S11 – token bucket (thuần, cùng thuật toán Lua)', () => {
  it('burst = capacity, sau đó từ chối với Retry-After; nạp lại theo thời gian, không vượt capacity', () => {
    const cfg = { capacity: 3, ratePerMs: 1 / 1000 }; // 1 token/giây
    let st = null as ReturnType<typeof tokenBucketStep>['state'] | null;
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = tokenBucketStep(st, cfg, t0);
      expect(r.allowed).toBe(true);
      st = r.state;
    }
    const denied = tokenBucketStep(st, cfg, t0);
    expect(denied).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    const later = tokenBucketStep(denied.state, cfg, t0 + 1500);
    expect(later.allowed).toBe(true);
    const idle = tokenBucketStep(later.state, cfg, t0 + 3_600_000);
    expect(idle.state.tokens).toBeLessThanOrEqual(3);
    expect(idle.remaining).toBe(2);
  });

  it('cấu hình bucket hợp lệ, endpoint đắt có bucket theo user, auth theo IP', () => {
    for (const [name, b] of Object.entries(RATE_BUCKETS)) {
      expect(b.capacity, name).toBeGreaterThan(0);
      expect(b.refill / b.perSeconds, name).toBeGreaterThan(0);
    }
    expect(RATE_BUCKETS.explain.by).toBe('user');
    expect(RATE_BUCKETS.submit.by).toBe('user');
    expect(RATE_BUCKETS.orders.by).toBe('user');
    expect(RATE_BUCKETS.login_ip.by).toBe('ip');
    expect(RATE_BUCKETS.otp_ip.by).toBe('ip');
  });

  it('identifierSubject băm email/phone chuẩn hoá – không chứa PII', () => {
    const a = identifierSubject({ email: ' An@Example.com ' });
    expect(a).toBe(identifierSubject({ email: 'an@example.com' }));
    expect(a).toMatch(/^id:[0-9a-f]{32}$/);
    expect(a).not.toContain('example');
    expect(identifierSubject({ phone: '+84 912-345-678' })).toBe(identifierSubject({ phone: '84912345678' }));
    expect(identifierSubject({})).toBeNull();
  });
});

describe('S11 – CSRF (kiểm Origin/Sec-Fetch-Site/Referer cho cookie-auth)', () => {
  it('trustedOrigins gộp CORS + WEB/API/CMS + bổ sung (chuẩn hoá origin)', () => {
    expect([...trusted].sort()).toEqual(['http://localhost:3000', 'http://localhost:3001', 'https://allingo.vn', 'https://api.allingo.vn', 'https://app.allingo.vn', 'https://cms.allingo.vn']);
  });

  it('ma trận quyết định', () => {
    // phương thức an toàn / bearer / không cookie → bỏ qua
    expect(csrfCheck(req({ method: 'GET', headers: { origin: 'https://evil.example' } }), trusted).ok).toBe(true);
    expect(csrfCheck(req({ headers: { origin: 'https://evil.example', authorization: 'Bearer x' } }), trusted).ok).toBe(true);
    expect(csrfCheck(req({ cookies: {}, headers: { origin: 'https://evil.example' } }), trusted).ok).toBe(true);
    // cookie + origin lạ / null / cross-site / referer lạ → chặn
    expect(csrfCheck(req({ headers: { origin: 'https://evil.example' } }), trusted)).toEqual({ ok: false, reason: 'origin_untrusted' });
    expect(csrfCheck(req({ headers: { origin: 'https://allingo.vn.evil.example' } }), trusted)).toEqual({ ok: false, reason: 'origin_untrusted' });
    expect(csrfCheck(req({ headers: { origin: 'null' } }), trusted)).toEqual({ ok: false, reason: 'origin_null' });
    expect(csrfCheck(req({ headers: { 'sec-fetch-site': 'cross-site' } }), trusted)).toEqual({ ok: false, reason: 'cross_site' });
    expect(csrfCheck(req({ headers: { referer: 'https://evil.example/page' } }), trusted)).toEqual({ ok: false, reason: 'referer_untrusted' });
    // cookie + origin tin cậy / same-origin / client không phải trình duyệt → cho qua
    expect(csrfCheck(req({ headers: { origin: 'https://allingo.vn' } }), trusted).ok).toBe(true);
    expect(csrfCheck(req({ headers: { 'sec-fetch-site': 'same-site' } }), trusted).ok).toBe(true);
    expect(csrfCheck(req({ headers: { referer: 'http://localhost:3000/vi/toeic' } }), trusted).ok).toBe(true);
    expect(csrfCheck(req({ headers: {} }), trusted).ok).toBe(true);
    // /v1/auth/* luôn kiểm (login CSRF) kể cả không cookie; webhook/internal/storage miễn
    expect(csrfCheck(req({ url: '/v1/auth/login', cookies: {}, headers: { origin: 'https://evil.example' } }), trusted)).toEqual({ ok: false, reason: 'origin_untrusted' });
    expect(csrfCheck(req({ url: '/v1/webhooks/payments/vnpay', headers: { origin: 'https://evil.example' } }), trusted).ok).toBe(true);
    expect(csrfCheck(req({ url: '/v1/internal/content/sync', headers: { origin: 'https://evil.example' } }), trusted).ok).toBe(true);
  });
});

describe('S11 – thời gian phản hồi tối thiểu (chống enumerate)', () => {
  it('thành công và lỗi đều chờ ≥ minMs; minMs = 0 → không chờ', async () => {
    let t = performance.now();
    await withMinDuration(60, async () => 1);
    expect(performance.now() - t).toBeGreaterThanOrEqual(58);
    t = performance.now();
    await expect(withMinDuration(60, async () => Promise.reject(new Error('Invalid email or password')))).rejects.toThrow('Invalid email or password');
    expect(performance.now() - t).toBeGreaterThanOrEqual(58);
    t = performance.now();
    await withMinDuration(0, async () => 1);
    expect(performance.now() - t).toBeLessThan(30);
  });
});

describe('S11 – feature flag SDK (đánh giá thuần)', () => {
  it('kill-switch tắt → false kể cả percent; tester trong user_ids vẫn bật; thiếu cờ → fallback', () => {
    expect(evaluateFlag({ enabled: false, rules: {} }, { userId: 'u1' }, true)).toBe(false);
    expect(evaluateFlag({ enabled: false, rules: { user_ids: ['u1'] } }, { userId: 'u1' }, true)).toBe(true);
    expect(evaluateFlag(null, { userId: 'u1' }, true)).toBe(true);
    expect(evaluateFlag({ enabled: true, rules: { percent: 0 } }, { userId: 'u1' }, true, 'ff.ai.explain')).toBe(false);
    expect(evaluateFlag({ enabled: true, rules: { percent: 100 } }, { userId: 'u1' }, true)).toBe(true);
  });

  it('cờ công khai không gồm cờ chứa danh sách mời (beta_gate) và đều theo ff.<module>.<feature>', () => {
    expect(PUBLIC_FLAG_KEYS).not.toContain('ff.growth.beta_gate');
    for (const k of PUBLIC_FLAG_KEYS) expect(k).toMatch(/^ff\.[a-z0-9_]+(\.[a-z0-9_]+)+$/);
  });
});
