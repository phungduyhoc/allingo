import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TestSetsPage } from '@/features/test-sets/test-sets-page';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'testSets' });
  return { title: t('title') };
}

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; program: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale, program } = await params;
  const { kind } = await searchParams;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/[program]/test-sets">
      <ProgramGate program={program}>
        <TestSetsPage initialKind={kind} />
      </ProgramGate>
    </PageIntl>
  );
}
