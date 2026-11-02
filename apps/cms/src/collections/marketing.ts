import path from 'node:path';
import type { Block, CollectionAfterChangeHook, CollectionAfterDeleteHook, CollectionAfterReadHook, CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';
import { getEnv } from '../lib/env';
import {
  MARKETING_LOCALES,
  enabledOrLoggedIn,
  hookLogger,
  i18nField,
  i18nRichText,
  pageJsonLd,
  postJsonLd,
  publishedOrLoggedIn,
  revalidateEvent,
  revalidatePaths,
  revalidateTags,
  sendRevalidate,
  seoFields,
  slugify,
  validateSlug,
  type MarketingCollection,
  type PostLike,
} from '../lib/marketing';

/**
 * Marketing site & blog (Sprint 10): `marketing-media` (ảnh công khai), `categories`, `authors`, `posts`, `pages` (block
 * builder hero/features/pricing/faq/testimonial/cta), `redirects`. Văn bản song ngữ {vi, en}. pages/posts có bản nháp
 * (`versions.drafts`) – REST công khai chỉ trả bản `published`. afterChange/afterDelete gọi webhook revalidate của web
 * (`WEB_REVALIDATE_URL`, chữ ký HMAC `WEB_REVALIDATE_SECRET`). Không ghi catalog.* (ADR-0019).
 */
const GROUP = { vi: 'Marketing & Blog', en: 'Marketing & Blog' };

function revalidateHooks(collection: MarketingCollection, versioned: boolean): { afterChange: CollectionAfterChangeHook; afterDelete: CollectionAfterDeleteHook } {
  const fire = (event: ReturnType<typeof revalidateEvent>, doc: Record<string, unknown>, prev: Record<string, unknown> | null, req: Parameters<CollectionAfterChangeHook>[0]['req']) => {
    if (!event) return;
    const env = getEnv();
    const slug = (doc.slug as string | undefined) ?? null;
    const payload = { event, collection, id: String(doc.id), slug, paths: revalidatePaths(collection, doc, prev), tags: revalidateTags(collection, doc), locales: MARKETING_LOCALES, at: new Date().toISOString() };
    // Không chặn lưu: gửi nền, lỗi chỉ ghi log
    void sendRevalidate({ url: env.WEB_REVALIDATE_URL, secret: env.WEB_REVALIDATE_SECRET }, payload, { log: hookLogger(req) });
  };
  return {
    afterChange: ({ doc, previousDoc, req, operation }) => {
      const d = doc as Record<string, unknown>;
      const p = operation === 'update' ? (previousDoc as Record<string, unknown> | null) : null;
      fire(revalidateEvent('change', d._status as string | undefined, p?._status as string | undefined, versioned), d, p, req);
      return doc;
    },
    afterDelete: ({ doc, req }) => {
      const d = doc as Record<string, unknown>;
      fire(revalidateEvent('delete', d._status as string | undefined, undefined, versioned), d, null, req);
      return doc;
    },
  };
}

const slugField = (description: { vi: string; en: string }) => ({
  name: 'slug',
  type: 'text' as const,
  required: true,
  unique: true,
  index: true,
  label: 'Slug',
  validate: validateSlug,
  admin: { position: 'sidebar' as const, description },
  hooks: { beforeValidate: [({ value, data }: { value?: unknown; data?: Record<string, unknown> }) => (typeof value === 'string' && value ? slugify(value) : typeof (data?.title as { vi?: string } | undefined)?.vi === 'string' ? slugify((data!.title as { vi: string }).vi) : value)] },
});

// ----------------------------------------------------------------------------- media / danh mục / tác giả
export function buildMarketingMedia(mediaDir: string): CollectionConfig {
  return {
    slug: 'marketing-media',
    labels: { singular: { vi: 'Ảnh marketing', en: 'Marketing image' }, plural: { vi: 'Ảnh marketing', en: 'Marketing images' } },
    admin: { useAsTitle: 'filename', group: GROUP },
    // Ảnh landing/blog/OG công khai (khác `media` – audio/ảnh đề thi chỉ người soạn xem)
    access: { read: () => true, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
    upload: { staticDir: path.resolve(mediaDir, 'marketing'), mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], imageSizes: [{ name: 'card', width: 640, height: 360, position: 'centre' }, { name: 'og', width: 1200, height: 630, position: 'centre' }], adminThumbnail: 'card' },
    fields: [
      { name: 'alt', type: 'group', label: { vi: 'Văn bản thay thế', en: 'Alt text' }, fields: [{ name: 'vi', type: 'text', required: true, label: 'Tiếng Việt' }, { name: 'en', type: 'text', label: 'English' }] },
      { name: 'license', type: 'text', required: true, defaultValue: 'own', label: { vi: 'Giấy phép', en: 'License' }, validate: (v: unknown) => (typeof v === 'string' && (v === 'own' || v === 'cc-by' || /^licensed:[\w.-]+$/.test(v)) ? true : 'own | cc-by | licensed:<mã>') },
    ],
  };
}

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: { singular: { vi: 'Chuyên mục', en: 'Category' }, plural: { vi: 'Chuyên mục', en: 'Categories' } },
  admin: { useAsTitle: 'slug', group: GROUP },
  access: { read: () => true, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  fields: [slugField({ vi: 'vd meo-toeic', en: 'e.g. toeic-tips' }), i18nField('name', { vi: 'Tên', en: 'Name' }, { required: true }), i18nField('description', { vi: 'Mô tả', en: 'Description' }, { type: 'textarea' })],
};

export const Authors: CollectionConfig = {
  slug: 'authors',
  labels: { singular: { vi: 'Tác giả', en: 'Author' }, plural: { vi: 'Tác giả', en: 'Authors' } },
  admin: { useAsTitle: 'name', group: GROUP },
  // Hồ sơ công khai tách khỏi `users` (không lộ email người dùng CMS)
  access: { read: () => true, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  fields: [
    { name: 'name', type: 'text', required: true, label: { vi: 'Tên hiển thị', en: 'Display name' } },
    slugField({ vi: 'vd ban-bien-tap', en: 'e.g. editorial-team' }),
    i18nField('bio', { vi: 'Giới thiệu', en: 'Bio' }, { type: 'textarea' }),
    { name: 'avatar', type: 'upload', relationTo: 'marketing-media', label: { vi: 'Ảnh đại diện', en: 'Avatar' } },
  ],
};

// ----------------------------------------------------------------------------- bài viết
const postHooks = revalidateHooks('posts', true);
const postJsonLdHook: CollectionAfterReadHook = ({ doc }) => ({ ...doc, jsonLd: postJsonLd(doc as PostLike, getEnv().WEB_PUBLIC_URL) });

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: { vi: 'Bài blog', en: 'Blog post' }, plural: { vi: 'Bài blog', en: 'Blog posts' } },
  admin: { useAsTitle: 'slug', group: GROUP, defaultColumns: ['slug', 'category', 'publishedAt', '_status', 'updatedAt'] },
  versions: { drafts: true, maxPerDoc: 30 },
  access: { read: publishedOrLoggedIn, readVersions: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  defaultSort: '-publishedAt',
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        // Ngày xuất bản: lần đầu publish nếu trống
        const d = data as Record<string, unknown>;
        if (d._status === 'published' && !d.publishedAt && !(originalDoc as Record<string, unknown> | undefined)?.publishedAt) d.publishedAt = new Date().toISOString();
        return data;
      },
    ],
    afterChange: [postHooks.afterChange],
    afterDelete: [postHooks.afterDelete],
    afterRead: [postJsonLdHook],
  },
  fields: [
    i18nField('title', { vi: 'Tiêu đề', en: 'Title' }, { required: true, maxLength: 160 }),
    slugField({ vi: 'URL /blog/<slug>', en: 'URL /blog/<slug>' }),
    i18nField('excerpt', { vi: 'Tóm tắt', en: 'Excerpt' }, { type: 'textarea', maxLength: 400 }),
    i18nRichText('content', { vi: 'Nội dung', en: 'Content' }, true),
    { name: 'coverImage', type: 'upload', relationTo: 'marketing-media', label: { vi: 'Ảnh bìa', en: 'Cover image' } },
    { name: 'category', type: 'relationship', relationTo: 'categories', label: { vi: 'Chuyên mục', en: 'Category' }, admin: { position: 'sidebar' } },
    { name: 'authors', type: 'relationship', relationTo: 'authors', hasMany: true, label: { vi: 'Tác giả', en: 'Authors' }, admin: { position: 'sidebar' } },
    { name: 'program', type: 'select', options: ['toeic', 'ielts', 'jlpt', 'hsk', 'general'].map((v) => ({ label: v.toUpperCase(), value: v })), defaultValue: 'toeic', admin: { position: 'sidebar' } },
    { name: 'publishedAt', type: 'date', label: { vi: 'Ngày xuất bản', en: 'Published at' }, admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'readingMinutes', type: 'number', min: 1, max: 120, label: { vi: 'Phút đọc', en: 'Reading minutes' }, admin: { position: 'sidebar' } },
    {
      name: 'schemaType',
      type: 'select',
      defaultValue: 'BlogPosting',
      options: [
        { label: 'BlogPosting', value: 'BlogPosting' },
        { label: 'Article', value: 'Article' },
      ],
      label: 'JSON-LD @type',
      admin: { position: 'sidebar' },
    },
    { name: 'faq', type: 'array', label: { vi: 'Hỏi đáp (JSON-LD FAQPage)', en: 'FAQ (JSON-LD FAQPage)' }, fields: [i18nField('question', { vi: 'Câu hỏi', en: 'Question' }, { required: true }), i18nField('answer', { vi: 'Trả lời', en: 'Answer' }, { type: 'textarea', required: true })] },
    seoFields(),
  ],
};

// ----------------------------------------------------------------------------- trang (block builder)
const ctaFields = (name: string, label: { vi: string; en: string }) => ({ name, type: 'group' as const, label, fields: [i18nField('label', { vi: 'Nhãn', en: 'Label' }), { name: 'href', type: 'text' as const, label: 'URL' }] });

export const HeroBlock: Block = {
  slug: 'hero',
  interfaceName: 'HeroBlock',
  labels: { singular: 'Hero', plural: 'Hero' },
  fields: [i18nField('eyebrow', { vi: 'Dòng nhỏ', en: 'Eyebrow' }), i18nField('heading', { vi: 'Tiêu đề', en: 'Heading' }, { required: true }), i18nField('subheading', { vi: 'Mô tả', en: 'Subheading' }, { type: 'textarea' }), ctaFields('primaryCta', { vi: 'Nút chính', en: 'Primary CTA' }), ctaFields('secondaryCta', { vi: 'Nút phụ', en: 'Secondary CTA' }), { name: 'image', type: 'upload', relationTo: 'marketing-media' }],
};

export const FeaturesBlock: Block = {
  slug: 'features',
  interfaceName: 'FeaturesBlock',
  labels: { singular: { vi: 'Tính năng', en: 'Features' }, plural: { vi: 'Tính năng', en: 'Features' } },
  fields: [i18nField('heading', { vi: 'Tiêu đề', en: 'Heading' }), { name: 'items', type: 'array', minRows: 1, maxRows: 12, fields: [{ name: 'icon', type: 'text', admin: { description: 'Tên icon (lucide)' } }, i18nField('title', { vi: 'Tiêu đề', en: 'Title' }, { required: true }), i18nField('body', { vi: 'Nội dung', en: 'Body' }, { type: 'textarea' })] }],
};

export const PricingBlock: Block = {
  slug: 'pricing',
  interfaceName: 'PricingBlock',
  labels: { singular: { vi: 'Bảng giá', en: 'Pricing' }, plural: { vi: 'Bảng giá', en: 'Pricing' } },
  // Giá thật lấy từ API GET /plans (billing là nguồn sự thật) – block chỉ chọn chương trình + nội dung đi kèm
  fields: [i18nField('heading', { vi: 'Tiêu đề', en: 'Heading' }), i18nField('note', { vi: 'Ghi chú', en: 'Note' }, { type: 'textarea' }), { name: 'program', type: 'select', defaultValue: 'toeic', options: ['toeic', 'ielts', 'jlpt', 'hsk'].map((v) => ({ label: v.toUpperCase(), value: v })) }, { name: 'highlightPlanCode', type: 'text', label: { vi: 'Mã gói nổi bật', en: 'Highlighted plan code' } }],
};

export const FaqBlock: Block = {
  slug: 'faq',
  interfaceName: 'FaqBlock',
  labels: { singular: 'FAQ', plural: 'FAQ' },
  fields: [i18nField('heading', { vi: 'Tiêu đề', en: 'Heading' }), { name: 'items', type: 'array', minRows: 1, fields: [i18nField('question', { vi: 'Câu hỏi', en: 'Question' }, { required: true }), i18nField('answer', { vi: 'Trả lời', en: 'Answer' }, { type: 'textarea', required: true })] }],
};

export const TestimonialBlock: Block = {
  slug: 'testimonial',
  interfaceName: 'TestimonialBlock',
  labels: { singular: { vi: 'Cảm nhận', en: 'Testimonial' }, plural: { vi: 'Cảm nhận', en: 'Testimonials' } },
  fields: [
    i18nField('heading', { vi: 'Tiêu đề', en: 'Heading' }),
    {
      name: 'items',
      type: 'array',
      minRows: 1,
      fields: [
        i18nField('quote', { vi: 'Trích dẫn', en: 'Quote' }, { type: 'textarea', required: true }),
        { name: 'name', type: 'text', required: true },
        i18nField('role', { vi: 'Vai trò', en: 'Role' }),
        { name: 'consent', type: 'checkbox', required: true, defaultValue: false, label: { vi: 'Đã có đồng ý công khai của người học', en: 'Learner consent on file' } },
      ],
    },
  ],
};

export const CtaBlock: Block = {
  slug: 'cta',
  interfaceName: 'CtaBlock',
  labels: { singular: 'CTA', plural: 'CTA' },
  fields: [i18nField('heading', { vi: 'Tiêu đề', en: 'Heading' }, { required: true }), i18nField('body', { vi: 'Nội dung', en: 'Body' }, { type: 'textarea' }), ctaFields('button', { vi: 'Nút', en: 'Button' })],
};

export const PAGE_BLOCKS = [HeroBlock, FeaturesBlock, PricingBlock, FaqBlock, TestimonialBlock, CtaBlock];

const pageHooks = revalidateHooks('pages', true);
const pageJsonLdHook: CollectionAfterReadHook = ({ doc }) => ({ ...doc, jsonLd: pageJsonLd(doc as never, getEnv().WEB_PUBLIC_URL) });

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: { vi: 'Trang', en: 'Page' }, plural: { vi: 'Trang', en: 'Pages' } },
  admin: { useAsTitle: 'slug', group: GROUP, defaultColumns: ['slug', '_status', 'updatedAt'] },
  versions: { drafts: true, maxPerDoc: 30 },
  access: { read: publishedOrLoggedIn, readVersions: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  hooks: { afterChange: [pageHooks.afterChange], afterDelete: [pageHooks.afterDelete], afterRead: [pageJsonLdHook] },
  fields: [
    i18nField('title', { vi: 'Tiêu đề', en: 'Title' }, { required: true }),
    slugField({ vi: '"home" = trang chủ /, "toeic" = /toeic…', en: '"home" = /, "toeic" = /toeic…' }),
    { name: 'layout', type: 'blocks', blocks: PAGE_BLOCKS, minRows: 1, label: { vi: 'Bố cục', en: 'Layout' } },
    seoFields(),
  ],
};

// ----------------------------------------------------------------------------- chuyển hướng
const redirectHooks = revalidateHooks('redirects', false);

export const Redirects: CollectionConfig = {
  slug: 'redirects',
  labels: { singular: { vi: 'Chuyển hướng', en: 'Redirect' }, plural: { vi: 'Chuyển hướng', en: 'Redirects' } },
  admin: { useAsTitle: 'from', group: GROUP, defaultColumns: ['from', 'to', 'type', 'enabled'] },
  access: { read: enabledOrLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  hooks: { afterChange: [redirectHooks.afterChange], afterDelete: [redirectHooks.afterDelete] },
  fields: [
    { name: 'from', type: 'text', required: true, unique: true, index: true, label: { vi: 'Từ (đường dẫn)', en: 'From (path)' }, validate: (v: unknown) => (typeof v === 'string' && /^\/[^\s?#]*$/.test(v) ? true : 'Đường dẫn bắt đầu bằng /, không có query') },
    { name: 'to', type: 'text', required: true, label: { vi: 'Đến (đường dẫn hoặc URL)', en: 'To (path or URL)' }, validate: (v: unknown) => (typeof v === 'string' && /^(\/|https:\/\/)/.test(v) ? true : 'Đích là đường dẫn / hoặc URL https://') },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: '301',
      options: [
        { label: '301 (vĩnh viễn)', value: '301' },
        { label: '302 (tạm thời)', value: '302' },
      ],
    },
    { name: 'enabled', type: 'checkbox', defaultValue: true },
  ],
};
