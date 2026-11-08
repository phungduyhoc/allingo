import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminOpsPage } from '@/features/admin-ops/admin-ops-page';
import { isAdminSection as isSection } from '@/features/admin-ops/sections';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; section: string }> }): Promise<Metadata> {
  const { locale, section } = await params;
  const t = await getTranslations({ locale, namespace: 'adminOps' });
  return { title: isSection(section) ? t(`sections.${section}.title`) : t('sections.overview.title') };
}

/** S12 – `/admin/<beta|feedback|content|support|users|ai|system|audit>` (billing admin S8 ở /admin/billing) */
export default async function Page({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale, section } = await params;
  if (!isSection(section)) notFound();
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/admin/[section]">
      <AdminOpsPage section={section} />
    </PageIntl>
  );
}
