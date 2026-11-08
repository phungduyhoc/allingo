import type { MetadataRoute } from 'next';
import { absoluteUrl, SITE_LOCALES } from './site';

/**
 * Bộ dựng sitemap (S10) – thuần, có test: mỗi trang tĩnh + mỗi bài blog có một mục cho từng locale (vi, en) kèm hreflang
 * (`alternates.languages`), `lastModified` theo bài (updatedAt → publishedAt).
 */

export interface StaticEntry {
  path: string;
  changeFrequency?: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority?: number;
}

export const MARKETING_PATHS: StaticEntry[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/toeic', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/ielts', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/jlpt', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/hsk', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/blog', changeFrequency: 'daily', priority: 0.8 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
];

export function buildSitemap(input: { base: string; pages?: StaticEntry[]; posts: Array<{ slug: string; updatedAt?: string | null; publishedAt?: string | null }>; now?: Date }): MetadataRoute.Sitemap {
  const base = input.base.replace(/\/+$/, '');
  const languages = (path: string) => Object.fromEntries(SITE_LOCALES.map((l) => [l, absoluteUrl(l, path, base)]));
  const out: MetadataRoute.Sitemap = [];
  for (const p of input.pages ?? MARKETING_PATHS) {
    for (const l of SITE_LOCALES) out.push({ url: absoluteUrl(l, p.path, base), changeFrequency: p.changeFrequency, priority: p.priority, alternates: { languages: languages(p.path) } });
  }
  const seen = new Set<string>();
  for (const post of input.posts) {
    if (!post.slug || seen.has(post.slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) continue;
    seen.add(post.slug);
    const path = `/blog/${post.slug}`;
    const iso = post.updatedAt ?? post.publishedAt ?? null;
    const lastModified = iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : undefined;
    for (const l of SITE_LOCALES) out.push({ url: absoluteUrl(l, path, base), ...(lastModified ? { lastModified } : {}), changeFrequency: 'monthly', priority: 0.6, alternates: { languages: languages(path) } });
  }
  return out;
}
