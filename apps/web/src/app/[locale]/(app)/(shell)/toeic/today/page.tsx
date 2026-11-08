import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TodayPage } from '@/features/plan/today-page';
import { FeatureGate } from '@/features/flags/flags-provider';
import { FeatureDisabledNotice } from '@/features/flags/feature-disabled-notice';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'today' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // S11: kill-switch ff.learning.study_plan tắt → thông báo thay cho trang
  return (
    <PageIntl page="(shell)/toeic/today">
      <FeatureGate flag="ff.learning.study_plan" fallback={<FeatureDisabledNotice flag="ff.learning.study_plan" />}>
        <TodayPage />
      </FeatureGate>
    </PageIntl>
  );
}
