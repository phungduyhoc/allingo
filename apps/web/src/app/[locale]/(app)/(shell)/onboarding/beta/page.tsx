import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BetaOnboardingPage } from '@/features/beta/beta-onboarding-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'betaOnboarding' });
  return { title: t('metaTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/onboarding/beta">
      <BetaOnboardingPage />
    </PageIntl>
  );
}
