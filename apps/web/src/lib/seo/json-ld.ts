import { absoluteMediaUrl } from '@/lib/cms/client';
import { asMedia, pickText, type CmsPost, type CmsText } from '@/lib/cms/types';
import { absoluteUrl } from './site';

/**
 * JSON-LD (S10): Organization (trang chủ), FAQPage (block FAQ / FAQ của bài), Article|BlogPosting (bài blog). Tương đương bộ dựng
 * của CMS (`apps/cms/src/lib/marketing.ts`) nhưng URL theo route web có tiền tố locale (`/vi/blog/<slug>` – CMS tạo `/blog/<slug>`
 * cho vi). `serializeJsonLd` chống chèn thẻ (`<` → \u003c) khi nhúng vào <script type="application/ld+json">. Thuần, có test.
 */

export type JsonLd = Record<string, unknown>;

export function organizationJsonLd(site: string): JsonLd {
  const base = site.replace(/\/+$/, '');
  return { '@context': 'https://schema.org', '@type': 'Organization', name: 'Allingo', alternateName: 'Ngoại ngữ cho tất cả', url: base, logo: `${base}/icons/icon-512.png` };
}

export function faqJsonLd(items: ReadonlyArray<{ question?: CmsText; answer?: CmsText }>, locale: string): JsonLd | null {
  const qa = items.map((f) => ({ q: pickText(f.question, locale), a: pickText(f.answer, locale) })).filter((x) => x.q && x.a);
  if (!qa.length) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: locale, mainEntity: qa.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) };
}

export function articleJsonLd(post: CmsPost, locale: string, site: string): JsonLd {
  const base = site.replace(/\/+$/, '');
  const url = post.seo?.canonical ? (/^https?:\/\//.test(post.seo.canonical) ? post.seo.canonical : `${base}${post.seo.canonical}`) : absoluteUrl(locale, `/blog/${post.slug}`, base);
  const authors = (post.authors ?? []).map((a) => (typeof a === 'string' ? null : a.name)).filter((n): n is string => !!n);
  const image = absoluteMediaUrl(asMedia(post.seo?.ogImage)?.url) ?? absoluteMediaUrl(asMedia(post.coverImage)?.url) ?? `${base}/icons/icon-512.png`;
  const cat = post.category && typeof post.category === 'object' ? pickText(post.category.name, locale) : '';
  return {
    '@context': 'https://schema.org',
    '@type': post.schemaType ?? 'BlogPosting',
    headline: (pickText(post.seo?.title, locale) || pickText(post.title, locale)).slice(0, 110),
    description: pickText(post.seo?.description, locale) || pickText(post.excerpt, locale) || undefined,
    inLanguage: locale,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image: [image],
    datePublished: post.publishedAt ?? post.updatedAt ?? undefined,
    dateModified: post.updatedAt ?? post.publishedAt ?? undefined,
    ...(cat ? { articleSection: cat } : {}),
    author: authors.length ? authors.map((name) => ({ '@type': 'Person', name })) : [{ '@type': 'Organization', name: 'Allingo' }],
    publisher: { '@type': 'Organization', name: 'Allingo', logo: { '@type': 'ImageObject', url: `${base}/icons/icon-512.png` } },
  };
}

/** JSON an toàn để nhúng trong thẻ script (không thể đóng thẻ sớm / chèn HTML) */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
