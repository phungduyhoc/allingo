import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VocabListDetailPage } from '@/features/flashcards/vocab-list-detail';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vocab' });
  return { title: t('listFallbackTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string; listId: string }> }) {
  const { locale, program, listId } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/[program]/vocab/[listId]">
      <ProgramGate program={program}>
        <Suspense>
          <VocabListDetailPage listId={listId} />
        </Suspense>
      </ProgramGate>
    </PageIntl>
  );
}
