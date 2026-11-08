import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TestSetsPage } from '@/features/test-sets/test-sets-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'testSets' });
  return { title: t('title') };
}

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale } = await params;
  const { kind } = await searchParams;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/toeic/test-sets">
      <TestSetsPage initialKind={kind} />
    </PageIntl>
  );
}
