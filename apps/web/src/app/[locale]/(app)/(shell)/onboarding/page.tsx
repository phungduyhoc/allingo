import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // useSearchParams (?step= (quay lại từ màn chẩn đoán)) cần Suspense boundary
  return (
    <Suspense>
      <OnboardingPage />
    </Suspense>
  );
}
