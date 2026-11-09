import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TodayPage } from '@/features/plan/today-page';
import { FeatureGate } from '@/features/flags/flags-provider';
import { FeatureDisabledNotice } from '@/features/flags/feature-disabled-notice';
import { PageIntl } from '@/components/page-intl';
import { ProgramGate } from '@/features/program/program-gate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'today' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; program: string }> }) {
  const { locale, program } = await params;
  setRequestLocale(locale);
  // S11: kill-switch ff.learning.study_plan tắt → thông báo thay cho trang
  return (
    <PageIntl page="(shell)/[program]/today">
      <ProgramGate program={program}>
        <FeatureGate flag="ff.learning.study_plan" fallback={<FeatureDisabledNotice flag="ff.learning.study_plan" />}>
          <TodayPage />
        </FeatureGate>
      </ProgramGate>
    </PageIntl>
  );
}
