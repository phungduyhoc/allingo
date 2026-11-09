import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DiagnosticPage } from '@/features/diagnostic/diagnostic-page';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'diagnostic' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string }> }) {
  const { locale, program } = await params;
  setRequestLocale(locale);
  // useSearchParams (?from=onboarding) cần Suspense boundary
  return (
    <PageIntl page="(shell)/[program]/diagnostic">
      <ProgramGate program={program}>
        <Suspense>
          <DiagnosticPage />
        </Suspense>
      </ProgramGate>
    </PageIntl>
  );
}
