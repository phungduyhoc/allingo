import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Spinner } from '@allingo/ui';
import { ManageNotificationsPage } from '@/features/notifications/manage-page';
import { ScopedIntl } from '@/components/scoped-intl';
import { MARKETING_MESSAGES } from '@/lib/i18n-scope';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'notifications.manage' });
  // Trang chứa token cá nhân trong URL – không lập chỉ mục
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <ScopedIntl namespaces={[...MARKETING_MESSAGES, 'notifications']}>
      <div className="px-4 py-12 sm:px-6 sm:py-16">
        <React.Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>
          <ManageNotificationsPage />
        </React.Suspense>
      </div>
    </ScopedIntl>
  );
}
