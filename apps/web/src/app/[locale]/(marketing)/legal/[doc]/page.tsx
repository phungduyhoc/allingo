import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LEGAL_DOCS, LegalPage, legalTitle, type LegalDoc } from '@/features/legal/legal-page';
import { alternatesFor } from '@/lib/seo/site';

const isDoc = (d: string): d is LegalDoc => (LEGAL_DOCS as readonly string[]).includes(d);

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; doc: string }> }): Promise<Metadata> {
  const { locale, doc } = await params;
  if (!isDoc(doc)) return {};
  return { title: await legalTitle(locale, doc), alternates: alternatesFor(locale, `/legal/${doc}`) };
}

/** S12: Điều khoản, Quyền riêng tư, Hoàn tiền, Đồng ý xử lý giọng nói – phiên bản từ GET /legal/policies */
export default async function Page({ params }: { params: Promise<{ locale: string; doc: string }> }) {
  const { locale, doc } = await params;
  if (!isDoc(doc)) notFound();
  setRequestLocale(locale);
  return <LegalPage locale={locale} kind={doc} />;
}
