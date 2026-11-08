import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PostView } from '@/features/marketing/blog';
import { JsonLdScript, marketingMetadata } from '@/features/marketing/seo';
import { FunnelTracker } from '@/features/consent/funnel-tracker';
import { getCmsPost, getCmsPostSlugs } from '@/lib/cms/client';
import { pickText } from '@/lib/cms/types';
import { articleJsonLd, faqJsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site';

/** /blog/[slug] (S10): bài CMS (Lexical → React an toàn), ảnh, tác giả, chuyên mục, FAQ; JSON-LD Article/BlogPosting (+ FAQPage). */
export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await getCmsPostSlugs()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const { doc } = await getCmsPost(slug);
  if (!doc) return {};
  const title = pickText(doc.seo?.title, locale) || pickText(doc.title, locale);
  const canonicalPath = doc.seo?.canonical && doc.seo.canonical.startsWith('/') ? doc.seo.canonical.replace(/^\/(vi|en)(?=\/|$)/, '') || `/blog/${slug}` : `/blog/${slug}`;
  return marketingMetadata({ locale, path: canonicalPath, title, description: pickText(doc.seo?.description, locale) || pickText(doc.excerpt, locale) || undefined, type: 'article', absoluteTitle: /allingo/i.test(title), noindex: doc.seo?.noindex === true, publishedTime: doc.publishedAt, modifiedTime: doc.updatedAt });
}

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const { doc } = await getCmsPost(slug);
  if (!doc) notFound();
  const faq = faqJsonLd(doc.faq ?? [], locale);
  return (
    <>
      <JsonLdScript data={[articleJsonLd(doc, locale, siteUrl()), ...(faq ? [faq] : [])]} />
      <FunnelTracker event="landing_view" properties={{ page: 'blog_post' }} />
      <PostView locale={locale} post={doc} />
    </>
  );
}
