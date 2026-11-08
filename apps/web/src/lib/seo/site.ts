import type { Metadata } from 'next';

/**
 * URL công khai & metadata đa ngôn ngữ cho marketing (S10): canonical theo locale + hreflang (vi, en, x-default = vi). Đường dẫn
 * truyền vào KHÔNG có tiền tố locale (`/`, `/toeic`, `/blog/<slug>`). Gốc URL lấy từ `NEXT_PUBLIC_APP_URL` (inline lúc build).
 */

export const SITE_LOCALES = ['vi', 'en'] as const;
export type SiteLocale = (typeof SITE_LOCALES)[number];

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function localePath(locale: string, path: string): string {
  const l = locale === 'en' ? 'en' : 'vi';
  const p = path === '/' || path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `/${l}${p}`;
}

export function absoluteUrl(locale: string, path: string, base = siteUrl()): string {
  return `${base}${localePath(locale, path)}`;
}

export function alternatesFor(locale: string, path: string, base = siteUrl()): NonNullable<Metadata['alternates']> {
  return {
    canonical: absoluteUrl(locale, path, base),
    languages: { vi: absoluteUrl('vi', path, base), en: absoluteUrl('en', path, base), 'x-default': absoluteUrl('vi', path, base) },
  };
}
