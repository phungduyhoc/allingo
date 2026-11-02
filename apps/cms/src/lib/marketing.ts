import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Access, Field, PayloadRequest, Where } from 'payload';
import { roleOf } from './access';

/**
 * Marketing & blog (Sprint 10): helper thuần cho collections `pages`, `posts`, `redirects` – văn bản song ngữ dạng group
 * {vi, en} (cùng quy ước JSONB {vi,en} của repo – CLAUDE.md §5.11), slug, SEO, JSON-LD (Article/BlogPosting/FAQPage/
 * Organization), quyền đọc công khai CHỈ bản `published`, webhook revalidate có chữ ký HMAC tới web.
 */

export const MARKETING_LOCALES = ['vi', 'en'] as const;
export type MarketingLocale = (typeof MARKETING_LOCALES)[number];
export type I18n<T = string> = Partial<Record<MarketingLocale, T | null>>;

/** Group song ngữ: `vi` bắt buộc khi `required`, `en` tuỳ chọn (web fallback en → vi) */
export function i18nField(name: string, label: { vi: string; en: string }, opts: { type?: 'text' | 'textarea'; required?: boolean; maxLength?: number } = {}): Field {
  const type = opts.type ?? 'text';
  return {
    name,
    type: 'group',
    label,
    fields: [
      { name: 'vi', type, required: !!opts.required, label: 'Tiếng Việt', ...(opts.maxLength ? { maxLength: opts.maxLength } : {}) },
      { name: 'en', type, label: 'English', ...(opts.maxLength ? { maxLength: opts.maxLength } : {}) },
    ],
  } as Field;
}

/** Rich text song ngữ (Lexical) */
export function i18nRichText(name: string, label: { vi: string; en: string }, required = false): Field {
  return { name, type: 'group', label, fields: [{ name: 'vi', type: 'richText', required, label: 'Tiếng Việt' }, { name: 'en', type: 'richText', label: 'English' }] };
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Slug URL: chữ thường không dấu, số, gạch nối */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

export function validateSlug(value: unknown): true | string {
  return typeof value === 'string' && SLUG_RE.test(value) ? true : 'Slug chỉ gồm a-z, 0-9 và dấu gạch nối (vd meo-toeic-part-5).';
}

/** Trường SEO dùng chung: meta title/description song ngữ, ảnh OG, canonical, noindex */
export function seoFields(): Field {
  return {
    name: 'seo',
    type: 'group',
    label: 'SEO',
    fields: [
      i18nField('title', { vi: 'Tiêu đề SEO (≤ 60 ký tự)', en: 'SEO title (≤ 60 chars)' }, { maxLength: 70 }),
      i18nField('description', { vi: 'Mô tả SEO (≤ 160 ký tự)', en: 'SEO description (≤ 160 chars)' }, { type: 'textarea', maxLength: 200 }),
      { name: 'ogImage', type: 'upload', relationTo: 'marketing-media', label: { vi: 'Ảnh OG (1200×630)', en: 'OG image (1200×630)' } },
      { name: 'canonical', type: 'text', label: 'Canonical URL', admin: { description: { vi: 'Để trống = URL mặc định của trang', en: 'Empty = default URL' } }, validate: (v: unknown) => (!v || (typeof v === 'string' && /^(https?:\/\/|\/)/.test(v)) ? true : 'Canonical phải là URL tuyệt đối hoặc đường dẫn bắt đầu bằng /') },
      { name: 'noindex', type: 'checkbox', defaultValue: false, label: 'noindex' },
    ],
  };
}

/**
 * Đọc công khai CHỈ bản đã xuất bản (`_status = published`); người dùng CMS đăng nhập đọc cả bản nháp (`?draft=true`).
 * Áp cho REST `GET /api/pages|posts` mà web dùng (GraphQL tắt).
 */
export const publishedOrLoggedIn: Access = ({ req }) => {
  if (roleOf(req) !== null) return true;
  return { _status: { equals: 'published' } } satisfies Where;
};

/** Redirect công khai chỉ khi bật */
export const enabledOrLoggedIn: Access = ({ req }) => (roleOf(req) !== null ? true : ({ enabled: { equals: true } } satisfies Where));

// ----------------------------------------------------------------------------- đường dẫn & revalidate
export type MarketingCollection = 'pages' | 'posts' | 'redirects';

/** Đường dẫn web cần làm mới khi nội dung đổi (không tiền tố locale – web tự thêm /en) */
export function revalidatePaths(collection: MarketingCollection, doc: { slug?: string | null; from?: string | null } | null, previous?: { slug?: string | null; from?: string | null } | null): string[] {
  const paths = new Set<string>();
  const pagePath = (slug: string) => (slug === 'home' ? '/' : `/${slug}`);
  for (const d of [doc, previous]) {
    if (!d) continue;
    if (collection === 'posts' && d.slug) paths.add(`/blog/${d.slug}`);
    if (collection === 'pages' && d.slug) paths.add(pagePath(d.slug));
    if (collection === 'redirects' && d.from) paths.add(d.from);
  }
  if (collection === 'posts') paths.add('/blog');
  paths.add('/sitemap.xml');
  return [...paths];
}

export function revalidateTags(collection: MarketingCollection, doc: { slug?: string | null } | null): string[] {
  const tags = [collection === 'posts' ? 'posts' : collection === 'pages' ? 'pages' : 'redirects', 'sitemap'];
  if (doc?.slug && collection !== 'redirects') tags.push(`${collection === 'posts' ? 'post' : 'page'}:${doc.slug}`);
  return tags;
}

export interface RevalidatePayload {
  event: 'publish' | 'unpublish' | 'update' | 'delete';
  collection: MarketingCollection;
  id: string;
  slug: string | null;
  paths: string[];
  tags: string[];
  locales: readonly MarketingLocale[];
  at: string;
}

/** Sự kiện revalidate theo trạng thái trước/sau (null = bỏ qua: chỉ lưu nháp chưa từng xuất bản) */
export function revalidateEvent(op: 'change' | 'delete', status: string | null | undefined, previousStatus: string | null | undefined, versioned: boolean): RevalidatePayload['event'] | null {
  if (op === 'delete') return !versioned || status === 'published' || previousStatus === 'published' ? 'delete' : null;
  if (!versioned) return 'update';
  if (status === 'published') return previousStatus === 'published' ? 'update' : 'publish';
  if (previousStatus === 'published') return 'unpublish';
  return null;
}

/** Chữ ký: `sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>` (header x-allingo-signature + x-allingo-timestamp) */
export function signRevalidate(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Kiểm chữ ký (web dùng cùng thuật toán; ±5 phút chống phát lại) */
export function verifyRevalidate(secret: string, timestamp: string, body: string, signature: string, now = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > 5 * 60_000) return false;
  const a = Buffer.from(signRevalidate(secret, timestamp, body));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Gửi webhook revalidate (thử lại 1 lần); thiếu URL/secret → bỏ qua. Không ném lỗi (không chặn lưu nội dung). */
export async function sendRevalidate(cfg: { url?: string | null; secret?: string | null }, payload: RevalidatePayload, deps: { fetch?: FetchLike; now?: () => number; log?: (msg: string) => void } = {}): Promise<'sent' | 'skipped' | 'failed'> {
  if (!cfg.url || !cfg.secret) return 'skipped';
  const body = JSON.stringify(payload);
  const doFetch: FetchLike = deps.fetch ?? ((u, init) => fetch(u, init));
  for (let attempt = 0; attempt < 2; attempt++) {
    const ts = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
    try {
      const res = await doFetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-allingo-timestamp': ts, 'x-allingo-signature': signRevalidate(cfg.secret, ts, body), 'x-allingo-event': payload.event }, body, signal: AbortSignal.timeout(5000) });
      if (res.ok) return 'sent';
      deps.log?.(`revalidate webhook HTTP ${res.status}`);
    } catch (err) {
      deps.log?.(`revalidate webhook error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return 'failed';
}

// ----------------------------------------------------------------------------- JSON-LD
type Img = { url?: string | null; alt?: string | null } | string | null | undefined;
const imgUrl = (img: Img, site: string): string | null => {
  if (!img || typeof img === 'string') return null;
  if (!img.url) return null;
  return /^https?:\/\//.test(img.url) ? img.url : `${site.replace(/\/+$/, '')}${img.url}`;
};
const pick = (t: I18n | null | undefined, locale: MarketingLocale): string | null => (t?.[locale] || t?.en || t?.vi || null) ?? null;
/** Ưu tiên đúng locale ở mọi nguồn (SEO rồi nội dung) trước khi fallback en → vi */
const pickFirst = (sources: Array<I18n | null | undefined>, locale: MarketingLocale): string | null => sources.map((t) => t?.[locale] || null).find(Boolean) ?? sources.map((t) => pick(t, locale)).find(Boolean) ?? null;

export interface PostLike {
  slug?: string | null;
  title?: I18n | null;
  excerpt?: I18n | null;
  coverImage?: Img;
  publishedAt?: string | null;
  updatedAt?: string | null;
  authors?: Array<{ name?: string | null } | string> | null;
  faq?: Array<{ question?: I18n | null; answer?: I18n | null }> | null;
  schemaType?: 'Article' | 'BlogPosting' | null;
  seo?: { title?: I18n | null; description?: I18n | null; ogImage?: Img; canonical?: string | null } | null;
}

export function organizationJsonLd(site: string): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@type': 'Organization', name: 'Allingo', alternateName: 'Ngoại ngữ cho tất cả', url: site, logo: `${site.replace(/\/+$/, '')}/icons/icon-512.png` };
}

export function faqJsonLd(items: Array<{ question?: I18n | null; answer?: I18n | null }>, locale: MarketingLocale): Record<string, unknown> | null {
  const qa = items.map((f) => ({ q: pick(f.question, locale), a: pick(f.answer, locale) })).filter((x): x is { q: string; a: string } => !!x.q && !!x.a);
  if (!qa.length) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: locale, mainEntity: qa.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) };
}

/** JSON-LD bài blog theo locale: Article/BlogPosting (+ FAQPage nếu có câu hỏi) */
export function postJsonLd(doc: PostLike, site: string): Record<MarketingLocale, Array<Record<string, unknown>>> {
  const base = site.replace(/\/+$/, '');
  const out = {} as Record<MarketingLocale, Array<Record<string, unknown>>>;
  for (const locale of MARKETING_LOCALES) {
    const url = doc.seo?.canonical ? (/^https?:\/\//.test(doc.seo.canonical) ? doc.seo.canonical : `${base}${doc.seo.canonical}`) : `${base}${locale === 'vi' ? '' : '/en'}/blog/${doc.slug ?? ''}`;
    const authors = (doc.authors ?? []).map((a) => (typeof a === 'string' ? null : a.name)).filter((n): n is string => !!n);
    const article: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': doc.schemaType ?? 'BlogPosting',
      headline: pickFirst([doc.seo?.title, doc.title], locale),
      description: pickFirst([doc.seo?.description, doc.excerpt], locale),
      inLanguage: locale,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      datePublished: doc.publishedAt ?? doc.updatedAt ?? null,
      dateModified: doc.updatedAt ?? doc.publishedAt ?? null,
      author: authors.length ? authors.map((name) => ({ '@type': 'Person', name })) : [{ '@type': 'Organization', name: 'Allingo' }],
      publisher: { '@type': 'Organization', name: 'Allingo', logo: { '@type': 'ImageObject', url: `${base}/icons/icon-512.png` } },
    };
    const image = imgUrl(doc.seo?.ogImage, base) ?? imgUrl(doc.coverImage, base);
    if (image) article.image = [image];
    const list = [article];
    const faq = faqJsonLd(doc.faq ?? [], locale);
    if (faq) list.push(faq);
    out[locale] = list;
  }
  return out;
}

/** JSON-LD trang: Organization (trang chủ) + FAQPage từ block FAQ */
export function pageJsonLd(doc: { slug?: string | null; layout?: Array<{ blockType?: string; items?: Array<{ question?: I18n | null; answer?: I18n | null }> }> | null }, site: string): Record<MarketingLocale, Array<Record<string, unknown>>> {
  const out = {} as Record<MarketingLocale, Array<Record<string, unknown>>>;
  for (const locale of MARKETING_LOCALES) {
    const list: Array<Record<string, unknown>> = [];
    if (doc.slug === 'home') list.push(organizationJsonLd(site));
    const faqItems = (doc.layout ?? []).filter((b) => b.blockType === 'faq').flatMap((b) => b.items ?? []);
    const faq = faqJsonLd(faqItems, locale);
    if (faq) list.push(faq);
    out[locale] = list;
  }
  return out;
}

/** Ghi log hook không lộ nội dung */
export function hookLogger(req: PayloadRequest): (msg: string) => void {
  return (msg) => req.payload?.logger?.warn?.(msg);
}
