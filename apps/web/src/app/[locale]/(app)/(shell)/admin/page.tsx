import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminOverviewPage } from '@/features/admin-ops/admin-ops-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminOps' });
  return { title: t('sections.overview.title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/admin">
      <AdminOverviewPage />
    </PageIntl>
  );
}
