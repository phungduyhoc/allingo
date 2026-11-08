import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { marketingMetadata } from '@/features/marketing/seo';
import { StaticInfoPage } from '@/features/marketing/static-page';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing.contact' });
  return marketingMetadata({ locale, path: '/contact', title: t('title'), description: t('lead') });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StaticInfoPage locale={locale} kind="contact" />;
}
