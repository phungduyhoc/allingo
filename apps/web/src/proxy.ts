import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { isMissingAppRoute, NOT_FOUND_REWRITE_SEGMENT } from './lib/app-routes';
import { buildCsp, generateNonce, parseOriginList } from './lib/security/csp';

/**
 * Next 16: tệp `proxy.ts` thay cho `middleware.ts`.
 *  1) Chọn locale (next-intl; vi mặc định, en). Kiểm tra phiên đăng nhập làm ở client (AuthGate) vì cookie httpOnly do API ở
 *     origin khác đặt.
 *  2) S11 – CSP nghiêm có nonce: mỗi request một nonce, đặt `Content-Security-Policy` + `x-nonce` vào header REQUEST (Next.js tự
 *     gắn nonce cho script khung/chunk/inline RSC; layout gốc đọc `x-nonce` cho script của ứng dụng) và header RESPONSE.
 *     Vì nonce theo request nên mọi trang HTML render động (layout gốc đọc `headers()`); dữ liệu CMS vẫn qua Data Cache (ISR 300 s).
 *  3) B6/S152 – route động nhóm (app) có tham số sai dạng (mục admin/tab billing không có, id không phải UUID) → rewrite sang route
 *     bắt-mọi để trả HTTP 404 thật (AuthGate client làm `notFound()` của trang trong (app) không đổi được mã trạng thái – app-routes.ts).
 */
const intl = createMiddleware(routing);

const DEV = process.env.NODE_ENV === 'development';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/v1';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export default function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    dev: DEV,
    apiUrl: API_URL,
    appUrl: APP_URL,
    mediaOrigins: parseOriginList(process.env.CSP_MEDIA_ORIGINS),
    cmsUrl: process.env.CMS_PUBLIC_URL ?? null,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || null,
    google: !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    formActionOrigins: parseOriginList(process.env.CSP_FORM_ACTION_ORIGINS),
    upgradeInsecure: !DEV && APP_URL.startsWith('https://'),
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const lm = /^\/([a-z]{2})(\/.*)?$/.exec(request.nextUrl.pathname);
  if (lm && (routing.locales as readonly string[]).includes(lm[1]!) && isMissingAppRoute(lm[2] ?? '/')) {
    const url = request.nextUrl.clone();
    url.pathname = `/${lm[1]}/${NOT_FOUND_REWRITE_SEGMENT}`;
    const notFound = NextResponse.rewrite(url, { request: { headers } });
    notFound.headers.set('Content-Security-Policy', csp);
    return notFound;
  }
  // next-intl chép header của request này sang request đã rewrite/next → Next.js thấy CSP + nonce khi render
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|sw\\.js|manifest\\.webmanifest|icons|demo-audio|.*\\..*).*)'],
};
