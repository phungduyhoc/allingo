import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ErrorsPage } from '@/features/errors/errors-page';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'errorLog' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Bộ lọc nằm trên URL (?kind=&part=&status=&days=) → useSearchParams cần Suspense
  return (
    <Suspense>
      <ErrorsPage />
    </Suspense>
  );
}
