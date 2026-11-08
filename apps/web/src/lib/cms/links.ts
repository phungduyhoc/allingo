import { isDangerousLinkTarget } from '@allingo/schemas/api/learning-tools';

/**
 * Liên kết từ nội dung CMS (CTA, Lexical): chỉ http(s)/mailto/tel/đường dẫn nội bộ/neo; đường dẫn nội bộ (không tiền tố locale
 * trong CMS) → thêm `/<locale>`. Một số đường dẫn rút gọn biên tập viên hay dùng (`/diagnostic`, `/today`…) ánh xạ về route web
 * thật (`/toeic/...`), kể cả trong tham số `next=` của trang đăng ký. Không hợp lệ → null (render chữ thường, không link).
 */

const ALIASES: Record<string, string> = {
  '/diagnostic': '/toeic/diagnostic',
  '/today': '/toeic/today',
  '/plan': '/toeic/plan',
  '/dashboard': '/toeic/dashboard',
  '/practice': '/toeic/practice',
  '/vocab': '/toeic/vocab',
  '/errors': '/toeic/errors',
  '/stats': '/toeic/stats',
  '/home': '/',
};

const LOCALE_PREFIX = /^\/(vi|en)(\/|$|\?|#)/;

export interface SafeHref {
  href: string;
  external: boolean;
}

function aliasPath(path: string): string {
  return ALIASES[path] ?? path;
}

export function normalizeCmsHref(raw: string | null | undefined, locale: string): SafeHref | null {
  const href = raw?.trim();
  if (!href || href.length > 2048 || isDangerousLinkTarget(href)) return null;
  if (href.startsWith('#')) return { href, external: false };
  if (/^(mailto|tel):/i.test(href)) return { href, external: true };
  if (/^https?:\/\//i.test(href)) {
    try {
      return { href: new URL(href).toString(), external: true };
    } catch {
      return null;
    }
  }
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  if (LOCALE_PREFIX.test(href)) return { href, external: false };
  let url: URL;
  try {
    url = new URL(href, 'http://local');
  } catch {
    return null;
  }
  const next = url.searchParams.get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) url.searchParams.set('next', aliasPath(next));
  const path = aliasPath(url.pathname);
  const loc = locale === 'en' ? 'en' : 'vi';
  return { href: `/${loc}${path === '/' ? '' : path}${url.search}${url.hash}`, external: false };
}
