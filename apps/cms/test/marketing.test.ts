import { describe, expect, it } from 'vitest';
import type { PayloadRequest } from 'payload';
import { lexical, plainText, readingMinutes } from '../src/lib/lexical';
import {
  enabledOrLoggedIn,
  faqJsonLd,
  pageJsonLd,
  postJsonLd,
  publishedOrLoggedIn,
  revalidateEvent,
  revalidatePaths,
  revalidateTags,
  sendRevalidate,
  signRevalidate,
  slugify,
  validateSlug,
  verifyRevalidate,
  type FetchLike,
  type RevalidatePayload,
} from '../src/lib/marketing';
import { SEED_CATEGORIES, SEED_PAGES, SEED_POSTS } from '../scripts/marketing-content';

const anon = { req: { user: null } as unknown as PayloadRequest } as Parameters<typeof publishedOrLoggedIn>[0];
const editor = { req: { user: { role: 'editor', collection: 'users' } } as unknown as PayloadRequest } as Parameters<typeof publishedOrLoggedIn>[0];

describe('S10 marketing – quyền đọc công khai', () => {
  it('khách chỉ đọc bản published (pages/posts) và redirect đang bật; người dùng CMS đọc cả nháp', () => {
    expect(publishedOrLoggedIn(anon)).toEqual({ _status: { equals: 'published' } });
    expect(publishedOrLoggedIn(editor)).toBe(true);
    expect(enabledOrLoggedIn(anon)).toEqual({ enabled: { equals: true } });
    expect(enabledOrLoggedIn(editor)).toBe(true);
  });
});

describe('S10 marketing – slug & đường dẫn revalidate', () => {
  it('slugify bỏ dấu tiếng Việt; validate slug', () => {
    expect(slugify('Lộ trình 30 ngày luyện TOEIC – Đọc hiểu!')).toBe('lo-trinh-30-ngay-luyen-toeic-doc-hieu');
    expect(validateSlug('meo-toeic-part-5')).toBe(true);
    expect(validateSlug('Meo TOEIC')).not.toBe(true);
  });

  it('paths/tags theo collection: post → /blog + /blog/<slug> (+ slug cũ khi đổi), page home → /, redirect → from; luôn sitemap', () => {
    expect(revalidatePaths('posts', { slug: 'b' }, { slug: 'a' }).sort()).toEqual(['/blog', '/blog/a', '/blog/b', '/sitemap.xml']);
    expect(revalidatePaths('pages', { slug: 'home' })).toEqual(['/', '/sitemap.xml']);
    expect(revalidatePaths('pages', { slug: 'toeic' })).toEqual(['/toeic', '/sitemap.xml']);
    expect(revalidatePaths('redirects', { from: '/old' })).toEqual(['/old', '/sitemap.xml']);
    expect(revalidateTags('posts', { slug: 'x' })).toEqual(['posts', 'sitemap', 'post:x']);
    expect(revalidateTags('redirects', null)).toEqual(['redirects', 'sitemap']);
  });

  it('sự kiện: nháp chưa từng publish → bỏ qua; publish/unpublish/update/delete', () => {
    expect(revalidateEvent('change', 'draft', undefined, true)).toBeNull();
    expect(revalidateEvent('change', 'draft', 'draft', true)).toBeNull();
    expect(revalidateEvent('change', 'published', 'draft', true)).toBe('publish');
    expect(revalidateEvent('change', 'published', 'published', true)).toBe('update');
    expect(revalidateEvent('change', 'draft', 'published', true)).toBe('unpublish');
    expect(revalidateEvent('delete', 'draft', undefined, true)).toBeNull();
    expect(revalidateEvent('delete', 'published', undefined, true)).toBe('delete');
    expect(revalidateEvent('change', undefined, undefined, false)).toBe('update');
  });
});

describe('S10 marketing – webhook revalidate (HMAC)', () => {
  const payload: RevalidatePayload = { event: 'publish', collection: 'posts', id: '1', slug: 'meo-toeic-part-5', paths: ['/blog', '/blog/meo-toeic-part-5'], tags: ['posts'], locales: ['vi', 'en'], at: '2026-11-02T00:00:00.000Z' };

  it('ký sha256=HMAC(secret, "<ts>.<body>"); verify đúng chữ ký, sai body/secret/hết hạn → false', () => {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.UTC(2026, 10, 2) / 1000));
    const sig = signRevalidate('secret-at-least-16', ts, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    const now = Number(ts) * 1000 + 1000;
    expect(verifyRevalidate('secret-at-least-16', ts, body, sig, now)).toBe(true);
    expect(verifyRevalidate('secret-at-least-16', ts, `${body} `, sig, now)).toBe(false);
    expect(verifyRevalidate('other-secret-16chars', ts, body, sig, now)).toBe(false);
    expect(verifyRevalidate('secret-at-least-16', ts, body, sig, now + 10 * 60_000)).toBe(false);
  });

  it('gửi POST kèm header chữ ký/timestamp/event; lỗi → thử lại 1 lần; thiếu URL/secret → skipped', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let n = 0;
    const flaky: FetchLike = (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      n++;
      return n === 1 ? Promise.reject(new Error('ECONNRESET')) : Promise.resolve({ ok: true, status: 200 });
    };
    const logs: string[] = [];
    const r = await sendRevalidate({ url: 'http://web.test/api/revalidate', secret: 'secret-at-least-16' }, payload, { fetch: flaky, now: () => Date.UTC(2026, 10, 2), log: (m) => logs.push(m) });
    expect(r).toBe('sent');
    expect(calls).toHaveLength(2);
    const h = calls[1]!.headers;
    expect(h['x-allingo-event']).toBe('publish');
    expect(verifyRevalidate('secret-at-least-16', h['x-allingo-timestamp']!, calls[1]!.body, h['x-allingo-signature']!, Date.UTC(2026, 10, 2))).toBe(true);
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ collection: 'posts', slug: 'meo-toeic-part-5', paths: ['/blog', '/blog/meo-toeic-part-5'] });
    expect(logs[0]).toContain('ECONNRESET');
    expect(await sendRevalidate({ url: null, secret: 'x' }, payload)).toBe('skipped');
    const down: FetchLike = () => Promise.resolve({ ok: false, status: 500 });
    expect(await sendRevalidate({ url: 'http://web.test/x', secret: 'secret-at-least-16' }, payload, { fetch: down })).toBe('failed');
  });
});

describe('S10 marketing – JSON-LD', () => {
  it('bài blog: BlogPosting theo locale (headline/description từ SEO, tác giả, ảnh OG tuyệt đối, URL /en) + FAQPage', () => {
    const ld = postJsonLd(
      { slug: 'meo-toeic-part-5', title: { vi: 'Tiêu đề', en: 'Title' }, excerpt: { vi: 'Tóm tắt' }, seo: { title: { vi: 'SEO vi' }, ogImage: { url: '/media/og.png' } }, publishedAt: '2026-11-02T01:00:00.000Z', authors: [{ name: 'Ban biên tập Allingo' }], faq: [{ question: { vi: 'Hỏi?', en: 'Q?' }, answer: { vi: 'Đáp.', en: 'A.' } }] },
      'https://allingo.vn',
    );
    expect(ld.vi[0]).toMatchObject({ '@type': 'BlogPosting', headline: 'SEO vi', description: 'Tóm tắt', inLanguage: 'vi', url: 'https://allingo.vn/blog/meo-toeic-part-5', image: ['https://allingo.vn/media/og.png'], author: [{ '@type': 'Person', name: 'Ban biên tập Allingo' }] });
    expect(ld.en[0]).toMatchObject({ headline: 'Title', url: 'https://allingo.vn/en/blog/meo-toeic-part-5' });
    expect(ld.vi[1]).toMatchObject({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Hỏi?', acceptedAnswer: { text: 'Đáp.' } }] });
    expect(faqJsonLd([], 'vi')).toBeNull();
  });

  it('trang: home có Organization; block FAQ → FAQPage', () => {
    const home = SEED_PAGES.find((p) => p.slug === 'home')!;
    const ld = pageJsonLd(home as never, 'https://allingo.vn');
    expect(ld.vi.map((x) => x['@type'])).toEqual(['Organization', 'FAQPage']);
    const toeic = pageJsonLd(SEED_PAGES.find((p) => p.slug === 'toeic') as never, 'https://allingo.vn');
    expect(toeic.en.map((x) => x['@type'])).toEqual(['FAQPage']);
  });
});

describe('S10 marketing – nội dung seed tự viết', () => {
  it('3 bài (mẹo Part 5, lộ trình 30 ngày, cách dùng Allingo) đủ vi/en, slug hợp lệ, chuyên mục tồn tại; SEO ≤ giới hạn', () => {
    expect(SEED_POSTS.map((p) => p.slug)).toEqual(['meo-toeic-part-5', 'lo-trinh-30-ngay-toeic', 'cach-dung-allingo-luyen-toeic']);
    for (const p of SEED_POSTS) {
      expect(validateSlug(p.slug)).toBe(true);
      expect(SEED_CATEGORIES.some((c) => c.slug === p.category)).toBe(true);
      expect(p.title.vi && p.title.en && p.excerpt.vi && p.excerpt.en).toBeTruthy();
      expect(p.content.vi.length).toBeGreaterThan(5);
      expect(p.content.en.length).toBeGreaterThan(5);
      expect(p.seo.description.vi.length).toBeLessThanOrEqual(200);
      expect(readingMinutes(p.content.vi)).toBeGreaterThanOrEqual(1);
    }
    // Trang TOEIC có tuyên bố không liên kết ETS; không có testimonial bịa
    const toeic = JSON.stringify(SEED_PAGES.find((p) => p.slug === 'toeic'));
    expect(toeic).toContain('không liên kết');
    expect(JSON.stringify(SEED_PAGES)).not.toContain('"testimonial"');
  });

  it('lexical: h2/đoạn/danh sách/in đậm thành SerializedEditorState hợp lệ', () => {
    const s = lexical([{ h2: 'Mẹo' }, { p: 'Chọn **đáp án** đúng' }, { ul: ['a', 'b'] }, { ol: ['x'] }]);
    expect(s.root.type).toBe('root');
    expect(s.root.children.map((c) => c.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    const para = s.root.children[1] as { children: Array<{ text: string; format: number }> };
    expect(para.children).toEqual([expect.objectContaining({ text: 'Chọn ', format: 0 }), expect.objectContaining({ text: 'đáp án', format: 1 }), expect.objectContaining({ text: ' đúng', format: 0 })]);
    expect((s.root.children[3] as { tag: string }).tag).toBe('ol');
    expect(plainText([{ p: '**a** b' }])).toBe('a b');
  });
});
