import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { findCmsRedirect } from '@/lib/cms/client';
import { normalizeCmsHref } from '@/lib/cms/links';
import { NOT_FOUND_REWRITE_SEGMENT } from '@/lib/app-routes';

/**
 * Bắt mọi đường dẫn không khớp trong [locale] → S10: chuyển hướng do CMS quản lý (`redirects` đang bật, 301/302, cache 300 s +
 * webhook thẻ `redirects`), không có → trang not-found có layout/i18n (HTTP 404). B6/S152: đích rewrite của proxy cho route (app)
 * có tham số sai dạng.
 */
export default async function CatchAll({ params }: { params: Promise<{ locale: string; rest: string[] }> }) {
  const { locale, rest } = await params;
  // B6/S152: proxy rewrite route (app) sai dạng tới đây → 404 ngay (không tra chuyển hướng CMS)
  if (rest.length === 1 && rest[0] === NOT_FOUND_REWRITE_SEGMENT) notFound();
  const path = `/${rest.map((s) => decodeURIComponent(s)).join('/')}`;
  if (/^\/[A-Za-z0-9\-_/.]{1,300}$/.test(path)) {
    const r = await findCmsRedirect(path);
    const target = r ? normalizeCmsHref(r.to, locale) : null;
    if (target && target.href !== `/${locale}${path}`) {
      if (r?.type === '302') redirect(target.href);
      permanentRedirect(target.href);
    }
  }
  notFound();
}
