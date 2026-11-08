import { getTranslations } from 'next-intl/server';
import { OG_SIZE, ogImage } from '@/features/marketing/og';

/** Ảnh OG trang chủ (và trang marketing không có ảnh riêng) – tiêu đề theo locale */
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Allingo';

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  return ogImage({ tagline: tc('tagline'), title: t('ogTitle'), kicker: t('ogKicker'), footer: t('ogFooter') });
}
