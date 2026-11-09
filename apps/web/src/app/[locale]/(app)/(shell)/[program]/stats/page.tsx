import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatsPage } from '@/features/stats/stats-page';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'stats' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string }> }) {
  const { locale, program } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/[program]/stats">
      <ProgramGate program={program}>
        <StatsPage />
      </ProgramGate>
    </PageIntl>
  );
}
