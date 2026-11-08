import type { CmsPage, CmsText } from '@/lib/cms/types';

/**
 * Nội dung tĩnh khi CMS lỗi/không chạy (S10): dựng trang `home` / `toeic` cùng dạng blocks của CMS từ thông điệp i18n
 * (`marketing.fallback.*`) để giao diện + JSON-LD (FAQ) giữ nguyên cấu trúc. `t` = getTranslations('marketing.fallback').
 */

type T = ((key: string) => string) & { raw: (key: string) => unknown };

export function fallbackPage(slug: 'home' | 'toeic', t: T, locale: string): CmsPage {
  const L = (s: string): CmsText => ({ [locale === 'en' ? 'en' : 'vi']: s });
  const k = (key: string) => L(t(`${slug}.${key}`));
  const list = <X>(key: string) => (t.raw(`${slug}.${key}`) as X[] | undefined) ?? [];
  return {
    id: `fallback-${slug}`,
    slug,
    title: k('title'),
    layout: [
      { blockType: 'hero', eyebrow: k('eyebrow'), heading: k('heading'), subheading: k('subheading'), primaryCta: { label: k('primaryCta'), href: slug === 'home' ? '/register?next=/toeic/diagnostic' : '/register?next=/toeic/diagnostic' }, secondaryCta: { label: k('secondaryCta'), href: slug === 'home' ? '/pricing' : '/blog' } },
      { blockType: 'features', heading: k('featuresHeading'), items: list<{ icon: string; title: string; body: string }>('features').map((f) => ({ icon: f.icon, title: L(f.title), body: L(f.body) })) },
      { blockType: 'pricing', heading: k('pricingHeading'), note: k('pricingNote'), program: 'toeic', highlightPlanCode: null },
      { blockType: 'faq', heading: k('faqHeading'), items: list<{ q: string; a: string }>('faq').map((f) => ({ question: L(f.q), answer: L(f.a) })) },
      { blockType: 'cta', heading: k('ctaHeading'), body: k('ctaBody'), button: { label: k('ctaButton'), href: '/register' } },
    ],
    seo: { title: k('seoTitle'), description: k('seoDescription'), ogImage: null, canonical: null, noindex: false },
  };
}
