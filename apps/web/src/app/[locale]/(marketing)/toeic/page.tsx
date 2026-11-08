import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TryFreeButton } from '@/features/auth/try-free-button';
import { Blocks, faqItemsOf } from '@/features/marketing/blocks';
import { fallbackPage } from '@/features/marketing/fallback';
import { JsonLdScript, marketingMetadata } from '@/features/marketing/seo';
import { EtsDisclaimer, ToeicFormatCard } from '@/features/marketing/sections';
import { FunnelTracker } from '@/features/consent/funnel-tracker';
import { getCmsPage } from '@/lib/cms/client';
import { pickText } from '@/lib/cms/types';
import { faqJsonLd } from '@/lib/seo/json-ld';

/**
 * Trang TOEIC (S10): blocks CMS (`pages` slug `toeic`, fallback tĩnh), bảng định dạng 7 Part, FAQPage JSON-LD và TUYÊN BỐ KHÔNG
 * LIÊN KẾT ETS (luôn hiện, không phụ thuộc CMS). ISR 300 s.
 */
export const revalidate = 300;

async function loadToeic(locale: string) {
  const { doc } = await getCmsPage('toeic');
  if (doc) return doc;
  const t = await getTranslations({ locale, namespace: 'marketing.fallback' });
  return fallbackPage('toeic', t as never, locale);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const page = await loadToeic(locale);
  const title = pickText(page.seo?.title, locale) || pickText(page.title, locale);
  return marketingMetadata({ locale, path: '/toeic', title, description: pickText(page.seo?.description, locale) || undefined, absoluteTitle: /allingo/i.test(title), noindex: page.seo?.noindex === true });
}

export default async function ToeicPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await loadToeic(locale);
  const faq = faqJsonLd(faqItemsOf(page.layout), locale);
  return (
    <>
      <JsonLdScript data={faq} />
      <FunnelTracker event="landing_view" properties={{ program: 'toeic' }} />
      <Blocks blocks={page.layout} ctx={{ locale, heroActions: <TryFreeButton variant="gold" size="lg" />, heroAside: <ToeicFormatCard locale={locale} /> }} />
      <EtsDisclaimer locale={locale} className="pb-14" />
    </>
  );
}
