import { getTranslations } from 'next-intl/server';
import { OG_SIZE, ogImage } from '@/features/marketing/og';
import { getCmsPost } from '@/lib/cms/client';
import { pickText } from '@/lib/cms/types';

/** Ảnh OG động của bài blog: tiêu đề bài + chuyên mục (CMS, ISR 300 s) */
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Allingo blog';
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing.blog' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  const { doc } = await getCmsPost(slug);
  const cat = doc && typeof doc.category === 'object' && doc.category ? pickText(doc.category.name, locale) : null;
  return ogImage({ tagline: tc('tagline'), title: doc ? pickText(doc.title, locale) : t('title'), kicker: cat ?? t('title'), footer: 'allingo · blog' });
}
