import { describe, expect, it } from 'vitest';
import type { CmsPost } from '@/lib/cms/types';
import { articleJsonLd, faqJsonLd, organizationJsonLd, serializeJsonLd } from './json-ld';
import { alternatesFor, localePath } from './site';
import { buildSitemap } from './sitemap';

const BASE = 'https://allingo.vn';

describe('sitemap', () => {
  it('trang tĩnh + bài blog cho vi/en, hreflang, lastModified theo bài; bỏ slug lạ/trùng', () => {
    const map = buildSitemap({
      base: `${BASE}/`,
      pages: [{ path: '/', priority: 1 }, { path: '/toeic' }],
      posts: [
        { slug: 'meo-toeic-part-5', updatedAt: '2026-11-02T05:00:00.000Z', publishedAt: '2026-11-02T01:00:00.000Z' },
        { slug: 'meo-toeic-part-5', updatedAt: null },
        { slug: 'Bad Slug', updatedAt: null },
        { slug: 'lo-trinh', updatedAt: null, publishedAt: '2026-11-01T00:00:00.000Z' },
      ],
    });
    expect(map.map((e) => e.url)).toEqual([`${BASE}/vi`, `${BASE}/en`, `${BASE}/vi/toeic`, `${BASE}/en/toeic`, `${BASE}/vi/blog/meo-toeic-part-5`, `${BASE}/en/blog/meo-toeic-part-5`, `${BASE}/vi/blog/lo-trinh`, `${BASE}/en/blog/lo-trinh`]);
    expect(map[4]?.alternates?.languages).toEqual({ vi: `${BASE}/vi/blog/meo-toeic-part-5`, en: `${BASE}/en/blog/meo-toeic-part-5` });
    expect(map[4]?.lastModified).toEqual(new Date('2026-11-02T05:00:00.000Z'));
    expect(map[6]?.lastModified).toEqual(new Date('2026-11-01T00:00:00.000Z'));
  });

  it('mặc định gồm landing, chương trình, blog, giới thiệu, pháp lý', () => {
    const urls = buildSitemap({ base: BASE, posts: [] }).map((e) => e.url);
    for (const p of ['/vi', '/vi/toeic', '/vi/ielts', '/vi/jlpt', '/vi/hsk', '/vi/pricing', '/vi/blog', '/vi/about', '/vi/contact', '/vi/legal/terms', '/vi/legal/privacy', '/vi/legal/refund', '/vi/legal/voice-consent', '/en/blog']) expect(urls).toContain(`${BASE}${p}`);
  });

  it('canonical + hreflang (x-default = vi)', () => {
    expect(localePath('en', '/')).toBe('/en');
    expect(localePath('fr', 'blog')).toBe('/vi/blog');
    expect(alternatesFor('en', '/blog/x', BASE)).toEqual({ canonical: `${BASE}/en/blog/x`, languages: { vi: `${BASE}/vi/blog/x`, en: `${BASE}/en/blog/x`, 'x-default': `${BASE}/vi/blog/x` } });
  });
});

describe('JSON-LD', () => {
  const post: CmsPost = {
    id: '1',
    slug: 'meo-toeic-part-5',
    title: { vi: 'Mẹo Part 5', en: 'Part 5 tips' },
    excerpt: { vi: 'Tóm tắt', en: null },
    seo: { title: { vi: 'Mẹo Part 5 | Allingo' }, description: null },
    category: { id: 'c', slug: 'meo', name: { vi: 'Mẹo TOEIC', en: 'TOEIC tips' } },
    authors: [{ id: 'a', name: 'Ban biên tập' }, 'raw-id'],
    publishedAt: '2026-11-02T01:00:00.000Z',
    updatedAt: '2026-11-02T05:00:00.000Z',
    schemaType: 'Article',
    coverImage: null,
  };

  it('Organization (trang chủ)', () => {
    expect(organizationJsonLd(`${BASE}/`)).toEqual({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Allingo', alternateName: 'Ngoại ngữ cho tất cả', url: BASE, logo: `${BASE}/icons/icon-512.png` });
  });

  it('Article theo locale: URL có tiền tố locale, SEO title ưu tiên, fallback en → vi, tác giả, chuyên mục, ảnh mặc định', () => {
    const vi = articleJsonLd(post, 'vi', BASE);
    expect(vi).toMatchObject({ '@type': 'Article', headline: 'Mẹo Part 5 | Allingo', description: 'Tóm tắt', inLanguage: 'vi', url: `${BASE}/vi/blog/meo-toeic-part-5`, articleSection: 'Mẹo TOEIC', datePublished: '2026-11-02T01:00:00.000Z', dateModified: '2026-11-02T05:00:00.000Z', author: [{ '@type': 'Person', name: 'Ban biên tập' }], image: [`${BASE}/icons/icon-512.png`] });
    const en = articleJsonLd({ ...post, schemaType: null, authors: [] }, 'en', BASE);
    expect(en).toMatchObject({ '@type': 'BlogPosting', headline: 'Mẹo Part 5 | Allingo', url: `${BASE}/en/blog/meo-toeic-part-5`, articleSection: 'TOEIC tips', author: [{ '@type': 'Organization', name: 'Allingo' }] });
  });

  it('FAQPage bỏ câu thiếu trả lời; rỗng → null', () => {
    const faq = faqJsonLd([{ question: { vi: 'Hỏi?' }, answer: { vi: 'Đáp.' } }, { question: { vi: 'Thiếu' }, answer: null }], 'vi');
    expect(faq).toEqual({ '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'vi', mainEntity: [{ '@type': 'Question', name: 'Hỏi?', acceptedAnswer: { '@type': 'Answer', text: 'Đáp.' } }] });
    expect(faqJsonLd([], 'vi')).toBeNull();
  });

  it('serialize an toàn trong <script>', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script> & co' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script> & co' });
  });
});
