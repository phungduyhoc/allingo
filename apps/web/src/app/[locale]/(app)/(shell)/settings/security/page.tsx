import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SecurityPage } from '@/features/security/security-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'security' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/settings/security">
      <SecurityPage />
    </PageIntl>
  );
}
