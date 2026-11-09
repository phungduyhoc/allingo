import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReviewSessionPage } from '@/features/flashcards/review-session';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'flashcards' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string }> }) {
  const { locale, program } = await params;
  setRequestLocale(locale);
  // useSearchParams (?list=&task=) cần Suspense boundary
  return (
    <PageIntl page="(shell)/[program]/vocab/review">
      <ProgramGate program={program}>
        <Suspense>
          <ReviewSessionPage />
        </Suspense>
      </ProgramGate>
    </PageIntl>
  );
}
