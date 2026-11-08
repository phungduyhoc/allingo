import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LessonPage } from '@/features/plan/task-content-pages';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'taskContent' });
  return { title: t('lessonTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; lessonId: string }> }) {
  const { locale, lessonId } = await params;
  setRequestLocale(locale);
  // useSearchParams (?task=) cần Suspense boundary
  return (
    <Suspense>
      <LessonPage lessonId={lessonId} />
    </Suspense>
  );
}
