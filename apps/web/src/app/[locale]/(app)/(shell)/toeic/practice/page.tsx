import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PracticePage } from '@/features/practice/practice-page';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'practice' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // useSearchParams (?section= từ gợi ý chẩn đoán) cần Suspense boundary để trang vẫn prerender tĩnh
  return (
    <Suspense>
      <PracticePage />
    </Suspense>
  );
}
