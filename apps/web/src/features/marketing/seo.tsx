import type { Metadata } from 'next';
import { serializeJsonLd, type JsonLd } from '@/lib/seo/json-ld';
import { alternatesFor, absoluteUrl } from '@/lib/seo/site';

/** <script type="application/ld+json"> an toàn (serializeJsonLd escape `<`, `>`, `&`) */
export function JsonLdScript({ data, id }: { data: JsonLd | JsonLd[] | null | undefined; id?: string }) {
  if (!data || (Array.isArray(data) && !data.length)) return null;
  return <script type="application/ld+json" id={id} data-testid="json-ld" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

/** Metadata trang marketing: tiêu đề, mô tả, canonical + hreflang, Open Graph/Twitter (ảnh OG lấy từ opengraph-image theo route) */
export function marketingMetadata(o: { locale: string; path: string; title: string; description?: string; type?: 'website' | 'article'; noindex?: boolean; absoluteTitle?: boolean; publishedTime?: string | null; modifiedTime?: string | null }): Metadata {
  const url = absoluteUrl(o.locale, o.path);
  return {
    title: o.absoluteTitle ? { absolute: o.title } : o.title,
    description: o.description,
    alternates: alternatesFor(o.locale, o.path),
    openGraph: {
      title: o.title,
      description: o.description,
      url,
      siteName: 'Allingo',
      locale: o.locale === 'en' ? 'en_US' : 'vi_VN',
      alternateLocale: o.locale === 'en' ? ['vi_VN'] : ['en_US'],
      type: o.type ?? 'website',
      ...(o.type === 'article' ? { publishedTime: o.publishedTime ?? undefined, modifiedTime: o.modifiedTime ?? undefined } : {}),
    },
    twitter: { card: 'summary_large_image', title: o.title, description: o.description },
    ...(o.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
