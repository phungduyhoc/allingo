import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PricingPage } from '@/features/pricing/pricing-page';
import { ScopedIntl } from '@/components/scoped-intl';
import { MARKETING_MESSAGES } from '@/lib/i18n-scope';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <ScopedIntl namespaces={[...MARKETING_MESSAGES, 'pricing', 'billing', 'quota']}>
      <PricingPage locale={locale} />
    </ScopedIntl>
  );
}
