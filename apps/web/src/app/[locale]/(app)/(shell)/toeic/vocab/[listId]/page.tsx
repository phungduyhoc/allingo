import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VocabListDetailPage } from '@/features/flashcards/vocab-list-detail';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vocab' });
  return { title: t('listFallbackTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; listId: string }> }) {
  const { locale, listId } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/toeic/vocab/[listId]">
      <Suspense>
        <VocabListDetailPage listId={listId} />
      </Suspense>
    </PageIntl>
  );
}
