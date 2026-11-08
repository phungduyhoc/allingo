import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CardSkeleton } from '@/components/states';
import { CheckoutPage } from '@/features/checkout/checkout-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/checkout">
      <React.Suspense fallback={<CardSkeleton lines={6} />}>
        <CheckoutPage />
      </React.Suspense>
    </PageIntl>
  );
}
