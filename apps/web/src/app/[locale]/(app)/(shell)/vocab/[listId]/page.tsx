import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VocabListPage } from '@/features/plan/task-content-pages';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'taskContent' });
  return { title: t('vocabTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; listId: string }> }) {
  const { locale, listId } = await params;
  setRequestLocale(locale);
  // useSearchParams (?task=) cần Suspense boundary
  return (
    <Suspense>
      <VocabListPage listId={listId} />
    </Suspense>
  );
}
