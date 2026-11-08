import type { MetadataRoute } from 'next';
import { getCmsPostSlugs } from '@/lib/cms/client';
import { buildSitemap } from '@/lib/seo/sitemap';
import { siteUrl } from '@/lib/seo/site';

/** /sitemap.xml – trang marketing tĩnh + bài blog (CMS) cho vi/en kèm hreflang; ISR 300 s + thẻ `sitemap` (webhook) */
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getCmsPostSlugs();
  return buildSitemap({ base: siteUrl(), posts });
}
