import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CardSkeleton } from '@/components/states';
import { CheckoutResult } from '@/features/checkout/checkout-result';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return { title: t('result.pageTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/checkout/result">
      <React.Suspense fallback={<CardSkeleton lines={6} />}>
        <CheckoutResult />
      </React.Suspense>
    </PageIntl>
  );
}
