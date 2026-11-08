import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReviewPage } from '@/features/review/review-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'review' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // useSearchParams (bộ lọc trên URL) cần Suspense boundary
  return (
    <PageIntl page="(shell)/attempts/[id]/review">
      <Suspense>
        <ReviewPage attemptId={id} />
      </Suspense>
    </PageIntl>
  );
}
