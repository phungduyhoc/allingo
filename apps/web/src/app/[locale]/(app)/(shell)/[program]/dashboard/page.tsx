import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isProgramCode } from '@allingo/schemas/program/registry';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; program: string }> }): Promise<Metadata> {
  const { locale, program } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tp = await getTranslations({ locale, namespace: 'programs' });
  // C3: tiêu đề theo chương trình của route (/ielts/... → "IELTS"); mã sai đã bị proxy trả 404
  return { title: t('title', { program: isProgramCode(program) ? tp(program) : program.toUpperCase() }) };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string }> }) {
  const { locale, program } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/[program]/dashboard">
      <ProgramGate program={program}>
        <DashboardPage />
      </ProgramGate>
    </PageIntl>
  );
}
