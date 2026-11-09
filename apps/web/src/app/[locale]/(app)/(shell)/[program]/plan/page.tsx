import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PlanPage } from '@/features/plan/plan-page';
import { FeatureGate } from '@/features/flags/flags-provider';
import { FeatureDisabledNotice } from '@/features/flags/feature-disabled-notice';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'plan' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string }> }) {
  const { locale, program } = await params;
  setRequestLocale(locale);
  // useSearchParams (?proposal= (thông báo plan_adjust_ready)) cần Suspense boundary
  return (
    <PageIntl page="(shell)/[program]/plan">
      <ProgramGate program={program}>
        <FeatureGate flag="ff.learning.study_plan" fallback={<FeatureDisabledNotice flag="ff.learning.study_plan" />}>
          <Suspense>
            <PlanPage />
          </Suspense>
        </FeatureGate>
      </ProgramGate>
    </PageIntl>
  );
}
