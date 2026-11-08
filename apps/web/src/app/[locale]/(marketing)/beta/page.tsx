import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BetaPage } from '@/features/beta/beta-page';
import { ScopedIntl } from '@/components/scoped-intl';
import { MARKETING_MESSAGES } from '@/lib/i18n-scope';

/** S12 – beta kín: nhập mã mời / đăng ký chờ. Không index (trang chức năng) */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'beta' });
  return { title: t('metaTitle'), robots: { index: false, follow: true } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <ScopedIntl namespaces={[...MARKETING_MESSAGES, 'beta']}>
      <BetaPage />
    </ScopedIntl>
  );
}
