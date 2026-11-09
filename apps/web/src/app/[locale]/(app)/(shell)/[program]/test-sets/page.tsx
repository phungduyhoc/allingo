import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isProgramCode } from '@allingo/schemas/program/registry';
import { TestSetsPage } from '@/features/test-sets/test-sets-page';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; program: string }> }): Promise<Metadata> {
  const { locale, program } = await params;
  const t = await getTranslations({ locale, namespace: 'testSets' });
  const tp = await getTranslations({ locale, namespace: 'programs' });
  // C3: tiêu đề theo chương trình của route (/ielts/... → "IELTS"); mã sai đã bị proxy trả 404
  return { title: t('title', { program: isProgramCode(program) ? tp(program) : program.toUpperCase() }) };
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
