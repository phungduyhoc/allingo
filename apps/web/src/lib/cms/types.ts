/**
 * Kiểu tài liệu CMS marketing (Payload REST công khai – apps/cms/src/collections/marketing.ts): văn bản song ngữ group {vi, en},
 * blocks trang (hero, features, pricing, faq, testimonial, cta), bài blog (Lexical song ngữ, ảnh, chuyên mục, tác giả, SEO),
 * redirects. Chỉ các trường web dùng; trường lạ bị bỏ qua.
 */

export type CmsLocale = 'vi' | 'en';
export type CmsText = Partial<Record<CmsLocale, string | null>> | null | undefined;

export interface CmsMedia {
  id?: string;
  url?: string | null;
  alt?: CmsText;
  width?: number | null;
  height?: number | null;
  sizes?: Record<string, { url?: string | null; width?: number | null; height?: number | null } | undefined> | null;
}

export interface CmsCta {
  label?: CmsText;
  href?: string | null;
}

export interface HeroBlock {
  blockType: 'hero';
  id?: string;
  eyebrow?: CmsText;
  heading?: CmsText;
  subheading?: CmsText;
  primaryCta?: CmsCta | null;
  secondaryCta?: CmsCta | null;
  image?: CmsMedia | string | null;
}
export interface FeaturesBlock {
  blockType: 'features';
  id?: string;
  heading?: CmsText;
  items?: Array<{ id?: string; icon?: string | null; title?: CmsText; body?: CmsText }> | null;
}
export interface PricingBlock {
  blockType: 'pricing';
  id?: string;
  heading?: CmsText;
  note?: CmsText;
  program?: string | null;
  highlightPlanCode?: string | null;
}
export interface FaqBlock {
  blockType: 'faq';
  id?: string;
  heading?: CmsText;
  items?: Array<{ id?: string; question?: CmsText; answer?: CmsText }> | null;
}
export interface TestimonialBlock {
  blockType: 'testimonial';
  id?: string;
  heading?: CmsText;
  items?: Array<{ id?: string; quote?: CmsText; name?: string | null; role?: CmsText; consent?: boolean | null }> | null;
}
export interface CtaBlock {
  blockType: 'cta';
  id?: string;
  heading?: CmsText;
  body?: CmsText;
  button?: CmsCta | null;
}

export type CmsBlock = HeroBlock | FeaturesBlock | PricingBlock | FaqBlock | TestimonialBlock | CtaBlock;

export interface CmsSeo {
  title?: CmsText;
  description?: CmsText;
  ogImage?: CmsMedia | string | null;
  canonical?: string | null;
  noindex?: boolean | null;
}

export interface CmsPage {
  id: string;
  slug: string;
  title?: CmsText;
  layout?: CmsBlock[] | null;
  seo?: CmsSeo | null;
  updatedAt?: string | null;
}

/** Nút Lexical (Payload richText) – chỉ các trường renderer dùng */
export interface LexicalNode {
  type: string;
  children?: LexicalNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: 'bullet' | 'number' | 'check';
  url?: string;
  fields?: { url?: string; newTab?: boolean; linkType?: string; doc?: unknown } | null;
  value?: CmsMedia | string | null;
  relationTo?: string;
  [k: string]: unknown;
}
export interface LexicalRoot {
  root: LexicalNode;
}

export interface CmsCategory {
  id: string;
  slug: string;
  name?: CmsText;
  description?: CmsText;
}
export interface CmsAuthor {
  id: string;
  slug?: string | null;
  name?: string | null;
  bio?: CmsText;
  avatar?: CmsMedia | string | null;
}

export interface CmsPost {
  id: string;
  slug: string;
  title?: CmsText;
  excerpt?: CmsText;
  content?: Partial<Record<CmsLocale, LexicalRoot | null>> | null;
  coverImage?: CmsMedia | string | null;
  category?: CmsCategory | string | null;
  authors?: Array<CmsAuthor | string> | null;
  program?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  readingMinutes?: number | null;
  schemaType?: 'Article' | 'BlogPosting' | null;
  faq?: Array<{ question?: CmsText; answer?: CmsText }> | null;
  seo?: CmsSeo | null;
}

export interface CmsRedirect {
  from: string;
  to: string;
  /** '301' | '302' */
  type?: string | null;
  enabled?: boolean | null;
}

/** Chọn chuỗi theo locale: đúng locale → en → vi (CLAUDE.md §5.11) */
export function pickText(t: CmsText, locale: string): string {
  if (!t) return '';
  const l = locale === 'en' ? 'en' : 'vi';
  return (t[l] || t.en || t.vi || '').trim();
}

export function asMedia(m: CmsMedia | string | null | undefined): CmsMedia | null {
  return m && typeof m === 'object' ? m : null;
}
