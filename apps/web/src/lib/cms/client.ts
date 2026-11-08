import type { CmsPage, CmsPost, CmsRedirect } from './types';

/**
 * Đọc CMS marketing (Payload REST công khai – chỉ bản published) ở SERVER (RSC/ISR – trình duyệt không gọi CMS/API, landing không
 * phụ thuộc CORS). Mỗi fetch gắn `next.revalidate = 300` (ISR 5 phút) + thẻ (`pages`, `page:<slug>`, `posts`, `post:<slug>`,
 * `redirects`, `sitemap`) để webhook `/api/revalidate` làm mới ngay khi xuất bản. Lỗi/timeout → null (trang dùng nội dung tĩnh).
 * Chạy e2e/dev với API giả lập (`NEXT_PUBLIC_API_MOCK=1`) mà CMS không chạy → fixture tự biên soạn (`src/mock/cms-fixtures`).
 * `CMS_URL=mock` → luôn fixture; `CMS_URL=off` → luôn nội dung tĩnh.
 */

export const MARKETING_REVALIDATE_SECONDS = 300;
const TIMEOUT_MS = 3500;

export function cmsBaseUrl(): string {
  return (process.env.CMS_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

/** Gốc URL ảnh công khai (ảnh `marketing-media` là đường dẫn tương đối /api/marketing-media/file/…) */
export function cmsPublicUrl(): string {
  const pub = process.env.CMS_PUBLIC_URL || process.env.CMS_URL || 'http://localhost:3001';
  return pub === 'mock' || pub === 'off' ? '' : pub.replace(/\/+$/, '');
}

export function absoluteMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  if (!url.startsWith('/')) return null;
  return `${cmsPublicUrl()}${url}`;
}

type Source = 'cms' | 'fixture' | 'none';
const fixturesEnabled = () => process.env.CMS_URL === 'mock' || process.env.NEXT_PUBLIC_API_MOCK === '1';

async function cmsGet<T>(path: string, tags: string[]): Promise<T | null> {
  const base = cmsBaseUrl();
  if (base === 'mock' || base === 'off') return null;
  try {
    const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' }, next: { revalidate: MARKETING_REVALIDATE_SECONDS, tags }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fixtures() {
  return import('@/mock/cms-fixtures');
}

interface CmsList<T> {
  docs?: T[];
  totalDocs?: number;
  totalPages?: number;
  page?: number;
}

const enc = encodeURIComponent;

export async function getCmsPage(slug: string): Promise<{ doc: CmsPage | null; source: Source }> {
  const data = await cmsGet<CmsList<CmsPage>>(`/api/pages?where[slug][equals]=${enc(slug)}&depth=1&limit=1`, ['pages', `page:${slug}`]);
  if (data?.docs?.[0]) return { doc: data.docs[0], source: 'cms' };
  if (fixturesEnabled()) {
    const f = await fixtures();
    const doc = f.CMS_FIXTURE_PAGES.find((p) => p.slug === slug) ?? null;
    return { doc, source: doc ? 'fixture' : 'none' };
  }
  return { doc: null, source: 'none' };
}

export interface PostList {
  posts: CmsPost[];
  page: number;
  totalPages: number;
  source: Source;
}

export async function getCmsPosts(opts: { page?: number; limit?: number; category?: string | null } = {}): Promise<PostList> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, opts.limit ?? 12);
  const cat = opts.category ? `&where[category.slug][equals]=${enc(opts.category)}` : '';
  const data = await cmsGet<CmsList<CmsPost>>(`/api/posts?sort=-publishedAt&depth=2&limit=${limit}&page=${page}${cat}`, ['posts']);
  if (data?.docs) return { posts: data.docs, page: data.page ?? page, totalPages: data.totalPages ?? 1, source: 'cms' };
  if (fixturesEnabled()) {
    const f = await fixtures();
    const all = f.CMS_FIXTURE_POSTS.filter((p) => !opts.category || (typeof p.category === 'object' && p.category?.slug === opts.category));
    return { posts: all.slice((page - 1) * limit, page * limit), page, totalPages: Math.max(1, Math.ceil(all.length / limit)), source: 'fixture' };
  }
  return { posts: [], page, totalPages: 1, source: 'none' };
}

export async function getCmsPost(slug: string): Promise<{ doc: CmsPost | null; source: Source }> {
  const data = await cmsGet<CmsList<CmsPost>>(`/api/posts?where[slug][equals]=${enc(slug)}&depth=2&limit=1`, ['posts', `post:${slug}`]);
  if (data?.docs?.[0]) return { doc: data.docs[0], source: 'cms' };
  if (fixturesEnabled()) {
    const f = await fixtures();
    const doc = f.CMS_FIXTURE_POSTS.find((p) => p.slug === slug) ?? null;
    return { doc, source: doc ? 'fixture' : 'none' };
  }
  return { doc: null, source: 'none' };
}

/** Mọi slug bài (sitemap, generateStaticParams) – tối đa 500 */
export async function getCmsPostSlugs(): Promise<Array<{ slug: string; updatedAt: string | null; publishedAt: string | null }>> {
  const data = await cmsGet<CmsList<Pick<CmsPost, 'slug' | 'updatedAt' | 'publishedAt'>>>(`/api/posts?sort=-publishedAt&depth=0&limit=500&select[slug]=true&select[updatedAt]=true&select[publishedAt]=true`, ['posts', 'sitemap']);
  const docs = data?.docs ?? (fixturesEnabled() ? (await fixtures()).CMS_FIXTURE_POSTS : []);
  return docs.filter((d) => !!d.slug).map((d) => ({ slug: d.slug, updatedAt: d.updatedAt ?? null, publishedAt: d.publishedAt ?? null }));
}

/** Chuyển hướng đang bật (CMS) – dùng ở trang bắt mọi đường dẫn không khớp */
export async function findCmsRedirect(path: string): Promise<CmsRedirect | null> {
  const data = await cmsGet<CmsList<CmsRedirect>>(`/api/redirects?where[from][equals]=${enc(path)}&limit=1&depth=0`, ['redirects']);
  const r = data?.docs?.[0];
  return r && r.enabled !== false && typeof r.to === 'string' ? r : null;
}
