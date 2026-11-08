import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ComingSoonPage } from '@/features/marketing/coming-soon';
import { marketingMetadata } from '@/features/marketing/seo';

/** /ielts – "sắp ra mắt" + đăng ký chờ (S10; POST /waitlist do backend S12 thêm). ISR 300 s. */
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing.comingSoon' });
  return marketingMetadata({ locale, path: '/ielts', title: t('metaTitle', { program: 'IELTS' }), description: t('metaDescription', { program: 'IELTS' }) });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ComingSoonPage locale={locale} program="ielts" />;
}
