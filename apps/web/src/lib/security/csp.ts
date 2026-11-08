/**
 * Content-Security-Policy nghiêm có nonce (S11, pentest-1 §3: ZAP 10038). Hàm thuần – dùng ở `src/proxy.ts` (mỗi request một
 * nonce) và test. Next.js đọc nonce từ header CSP của REQUEST rồi tự gắn cho script khung/chunk/inline RSC; script inline của
 * ứng dụng (đồng ý cookie, next-themes, JSON-LD) nhận nonce qua `headers().get('x-nonce')` ở layout gốc.
 *
 * - script-src: `'nonce-…' 'strict-dynamic'` (chunk do runtime nạp, Google Identity Services được tin theo chuỗi); `'self'` chỉ
 *   là dự phòng cho trình duyệt CSP2 (CSP3 bỏ qua khi có strict-dynamic). Dev thêm `'unsafe-eval'` (React dựng lại stack lỗi).
 * - style-src: `'self' 'unsafe-inline'` – thuộc tính `style=""` do React SSR (thanh tiến độ, Radix định vị popover) và thẻ
 *   `<style>` sonner tự chèn không mang được nonce; Tailwind biên dịch thành tệp CSS cùng origin. Không ảnh hưởng chặn script.
 * - connect/img/media: API (REST, SSE, WebSocket Socket.IO, media ký URL 10′ trên origin API), origin lưu trữ/CDN media,
 *   CMS (ảnh blog), Sentry ingest; dev thêm WebSocket HMR.
 * - frame-ancestors 'none' (dev 'self' – iframe làm nóng trang offline của SW), base-uri 'self', form-action 'self' (cổng thanh toán chuyển hướng bằng `location.assign`, không
 *   POST form; thêm origin cổng vào `formActionOrigins` nếu sau này dùng form POST), object-src 'none'.
 */

export interface CspOptions {
  nonce: string;
  /** NODE_ENV=development (next dev) */
  dev: boolean;
  /** NEXT_PUBLIC_API_URL (vd `http://localhost:4000/v1`) */
  apiUrl: string;
  /** NEXT_PUBLIC_APP_URL – dev: WebSocket HMR của chính origin */
  appUrl?: string;
  /** Origin media/lưu trữ (S3/R2/CDN) – `CSP_MEDIA_ORIGINS` */
  mediaOrigins?: readonly string[];
  /** CMS công khai (ảnh bài blog) – `CMS_PUBLIC_URL` */
  cmsUrl?: string | null;
  /** NEXT_PUBLIC_SENTRY_DSN – connect-src + report-uri */
  sentryDsn?: string | null;
  /** Bật Google Identity Services (NEXT_PUBLIC_GOOGLE_CLIENT_ID) */
  google?: boolean;
  /** Đích POST form ngoài (cổng thanh toán nếu redirect bằng form) – `CSP_FORM_ACTION_ORIGINS` */
  formActionOrigins?: readonly string[];
  /** Thêm `upgrade-insecure-requests` (production trên https) */
  upgradeInsecure?: boolean;
}

/** Nonce 128 bit base64 – Web Crypto (chạy được ở runtime proxy Node/Edge và trình duyệt) */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Origin chuẩn của một URL (bỏ path/query); URL sai hoặc không phải http(s)/ws(s) → null */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** http(s)://host → ws(s)://host (Socket.IO của API) */
export function wsOriginOf(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

/** Origin ingest + endpoint báo vi phạm CSP của Sentry từ DSN `https://<key>@<host>/<project>` */
export function sentryCspTargets(dsn: string | null | undefined): { origin: string; reportUri: string } | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!u.username || !project || !/^\d+$/.test(project)) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return { origin: u.origin, reportUri: `${u.origin}${prefix}/api/${project}/security/?sentry_key=${encodeURIComponent(u.username)}` };
  } catch {
    return null;
  }
}

/** Danh sách origin từ biến môi trường "a, b" (bỏ mục không hợp lệ) */
export function parseOriginList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((s) => originOf(s.trim()))
    .filter((s): s is string => !!s);
}

const uniq = (xs: readonly (string | null | undefined | false)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export function buildCsp(o: CspOptions): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(o.nonce)) throw new Error('CSP nonce must be base64 (≥ 16 chars)');
  const api = originOf(o.apiUrl);
  const app = originOf(o.appUrl);
  const cms = originOf(o.cmsUrl);
  const media = (o.mediaOrigins ?? []).map(originOf);
  const sentry = sentryCspTargets(o.sentryDsn);
  const google = o.google ? 'https://accounts.google.com' : null;

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': uniq(["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", o.dev && "'unsafe-eval'"]),
    'style-src': uniq(["'self'", "'unsafe-inline'", google && `${google}/gsi/style`]),
    'img-src': uniq(["'self'", 'data:', 'blob:', api, cms, ...media, google && 'https://*.googleusercontent.com']),
    'font-src': ["'self'", 'data:'],
    'connect-src': uniq(["'self'", api, api && wsOriginOf(api), ...media, sentry?.origin, google && `${google}/gsi/`, o.dev && app && wsOriginOf(app)]),
    'media-src': uniq(["'self'", 'data:', 'blob:', api, ...media]),
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-src': uniq(["'self'", google && `${google}/gsi/`]),
    // Dev: service worker làm nóng trang offline trong iframe ẩn cùng origin (sw-registrar) → 'self'; production 'none'
    'frame-ancestors': [o.dev ? "'self'" : "'none'"],
    'base-uri': ["'self'"],
    'form-action': uniq(["'self'", ...(o.formActionOrigins ?? []).map(originOf)]),
    'object-src': ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (o.upgradeInsecure) parts.push('upgrade-insecure-requests');
  if (sentry) parts.push(`report-uri ${sentry.reportUri}`);
  return parts.join('; ');
}

/** Đọc nonce từ chuỗi CSP (`'nonce-…'` trong script-src) – dùng trong test/e2e */
export function nonceFromCsp(csp: string | null | undefined): string | null {
  const m = /'nonce-([^']+)'/.exec(csp ?? '');
  return m ? m[1]! : null;
}

/**
 * Header bảo mật tĩnh (next.config `headers()`), không phụ thuộc request. HSTS chỉ ở production (trình duyệt bỏ qua HSTS trên
 * http – an toàn khi chạy `next start` cục bộ). COOP `same-origin-allow-popups` để popup Google Sign-In trả kết quả về trang.
 */
export function staticSecurityHeaders(o: { production: boolean }): Array<{ key: string; value: string }> {
  const h = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: o.production ? 'DENY' : 'SAMEORIGIN' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  ];
  if (o.production) h.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' });
  return h;
}
