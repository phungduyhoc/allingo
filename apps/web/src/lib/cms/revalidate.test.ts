import { describe, expect, it } from 'vitest';
import { revalidatePayloadSchema, revalidationPlan, signRevalidate, verifyRevalidateRequest } from './revalidate';

const SECRET = 'test-secret-0123456789';
const NOW = Date.parse('2026-11-08T00:00:00.000Z');
const ts = String(NOW / 1000);
const body = JSON.stringify({ event: 'publish', collection: 'posts', id: 'p1', slug: 'meo-toeic-part-5', paths: ['/blog/meo-toeic-part-5', '/blog', '/sitemap.xml'], tags: ['posts', 'sitemap', 'post:meo-toeic-part-5'], locales: ['vi', 'en'], at: '2026-11-08T00:00:00.000Z' });

describe('webhook revalidate – chữ ký HMAC', () => {
  it('cùng thuật toán với CMS: sha256=HMAC(secret, "<ts>.<body>")', () => {
    expect(signRevalidate(SECRET, '1', 'x')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signRevalidate(SECRET, ts, body)).toBe(signRevalidate(SECRET, ts, body));
    expect(signRevalidate(SECRET, ts, body)).not.toBe(signRevalidate(`${SECRET}x`, ts, body));
  });

  it('hợp lệ / thiếu header / lệch > 5 phút / sai chữ ký hoặc thân bị sửa', () => {
    const sig = signRevalidate(SECRET, ts, body);
    expect(verifyRevalidateRequest(SECRET, ts, body, sig, NOW)).toBe('ok');
    expect(verifyRevalidateRequest(SECRET, ts, body, sig, NOW + 4 * 60_000)).toBe('ok');
    expect(verifyRevalidateRequest(SECRET, null, body, sig, NOW)).toBe('missing');
    expect(verifyRevalidateRequest(SECRET, ts, body, null, NOW)).toBe('missing');
    expect(verifyRevalidateRequest(SECRET, ts, body, sig, NOW + 6 * 60_000)).toBe('stale');
    expect(verifyRevalidateRequest(SECRET, ts, body, sig, NOW - 6 * 60_000)).toBe('stale');
    expect(verifyRevalidateRequest(SECRET, '17x', body, sig, NOW)).toBe('stale');
    expect(verifyRevalidateRequest(SECRET, ts, `${body} `, sig, NOW)).toBe('bad_signature');
    expect(verifyRevalidateRequest(SECRET, ts, body, 'sha256=abc', NOW)).toBe('bad_signature');
    expect(verifyRevalidateRequest('other-secret-xxxxxx', ts, body, sig, NOW)).toBe('bad_signature');
  });
});

describe('payload → kế hoạch làm mới', () => {
  it('đường dẫn CMS (không locale) → /vi + /en; sitemap giữ nguyên; thêm /blog khi bài đổi', () => {
    const p = revalidatePayloadSchema.parse(JSON.parse(body));
    const plan = revalidationPlan(p);
    expect(plan.paths).toEqual(['/vi/blog/meo-toeic-part-5', '/en/blog/meo-toeic-part-5', '/vi/blog', '/en/blog', '/sitemap.xml']);
    expect(plan.tags).toEqual(['posts', 'sitemap', 'post:meo-toeic-part-5']);
  });

  it('trang chủ "/" → /vi, /en; thẻ pages', () => {
    const plan = revalidationPlan(revalidatePayloadSchema.parse({ event: 'update', collection: 'pages', id: '1', slug: 'home', paths: ['/', '/sitemap.xml'], tags: ['pages', 'sitemap', 'page:home'] }));
    expect(plan.paths).toEqual(['/vi', '/en', '/sitemap.xml']);
    expect(plan.tags).toContain('page:home');
  });

  it('chặn đường dẫn/thẻ lạ (.., query, script)', () => {
    const bad = (o: Record<string, unknown>) => revalidatePayloadSchema.safeParse({ event: 'update', collection: 'pages', id: '1', slug: null, paths: ['/'], tags: ['pages'], ...o }).success;
    expect(bad({})).toBe(true);
    expect(bad({ paths: ['/../etc'] })).toBe(false);
    expect(bad({ paths: ['/a?x=1'] })).toBe(false);
    expect(bad({ paths: ['https://evil.example'] })).toBe(false);
    expect(bad({ tags: ['<script>'] })).toBe(false);
    expect(bad({ collection: 'users' })).toBe(false);
  });
});
