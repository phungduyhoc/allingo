import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BlogIndex } from '@/features/marketing/blog';
import { marketingMetadata } from '@/features/marketing/seo';
import { FunnelTracker } from '@/features/consent/funnel-tracker';
import { getCmsPosts } from '@/lib/cms/client';

/** /blog (S10): bài đã xuất bản từ CMS (mới nhất trước), ISR 300 s + webhook (thẻ `posts`) */
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing.blog' });
  return marketingMetadata({ locale, path: '/blog', title: t('metaTitle'), description: t('metaDescription') });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const list = await getCmsPosts({ limit: 50 });
  return (
    <>
      <FunnelTracker event="landing_view" properties={{ page: 'blog' }} />
      <BlogIndex locale={locale} posts={list.posts} />
    </>
  );
}
