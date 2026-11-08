import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TryFreeButton } from '@/features/auth/try-free-button';
import { SampleQuestionDemo } from '@/features/landing/sample-question-demo';
import { Blocks, faqItemsOf } from '@/features/marketing/blocks';
import { fallbackPage } from '@/features/marketing/fallback';
import { JsonLdScript, marketingMetadata } from '@/features/marketing/seo';
import { ProgramsSection } from '@/features/marketing/sections';
import { FunnelTracker } from '@/features/consent/funnel-tracker';
import { getCmsPage } from '@/lib/cms/client';
import { pickText } from '@/lib/cms/types';
import { faqJsonLd, organizationJsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site';

/**
 * Trang chủ (S10): RSC + ISR 300 s; nội dung từ CMS (`pages` slug `home` – hero, features, pricing, faq, testimonial, cta), CMS lỗi →
 * nội dung tĩnh i18n cùng cấu trúc. Giữ "Luyện thử miễn phí" (tạo phiên khách) + câu mẫu tương tác + 4 chương trình (S0).
 * JSON-LD: Organization + FAQPage. Không gọi API phía client trước khi người học bấm.
 */
export const revalidate = 300;

async function loadHome(locale: string) {
  const { doc } = await getCmsPage('home');
  if (doc) return doc;
  const t = await getTranslations({ locale, namespace: 'marketing.fallback' });
  return fallbackPage('home', t as never, locale);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const page = await loadHome(locale);
  const tc = await getTranslations({ locale, namespace: 'common' });
  const title = pickText(page.seo?.title, locale) || `${tc('appName')} – ${tc('tagline')}`;
  return marketingMetadata({ locale, path: '/', title, description: pickText(page.seo?.description, locale) || undefined, absoluteTitle: true, noindex: page.seo?.noindex === true });
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await loadHome(locale);
  const faq = faqJsonLd(faqItemsOf(page.layout), locale);
  return (
    <>
      <JsonLdScript data={[organizationJsonLd(siteUrl()), ...(faq ? [faq] : [])]} />
      <FunnelTracker event="landing_view" />
      <Blocks
        blocks={page.layout}
        ctx={{
          locale,
          heroActions: <TryFreeButton variant="gold" size="lg" className="shadow-[0_10px_30px_-12px_rgba(230,179,37,0.9)]" />,
          heroAside: <SampleQuestionDemo />,
          afterHero: <ProgramsSection locale={locale} />,
        }}
      />
    </>
  );
}
