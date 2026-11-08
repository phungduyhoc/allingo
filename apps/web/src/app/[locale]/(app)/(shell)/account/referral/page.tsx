import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReferralPage } from '@/features/referral/referral-page';
import { FeatureGate } from '@/features/flags/flags-provider';
import { FeatureDisabledNotice } from '@/features/flags/feature-disabled-notice';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'referral' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // S11: kill-switch ff.growth.referral tắt → thông báo thay cho trang
  return (
    <PageIntl page="(shell)/account/referral">
      <FeatureGate flag="ff.growth.referral" fallback={<FeatureDisabledNotice flag="ff.growth.referral" />}>
        <ReferralPage />
      </FeatureGate>
    </PageIntl>
  );
}
