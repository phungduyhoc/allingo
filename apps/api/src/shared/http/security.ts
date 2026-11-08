import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/auth.guard.js';

/**
 * Hardening HTTP của API (S11).
 *
 * CSRF cho cookie-auth – kiểm nguồn gốc (OWASP "Verifying Origin With Standard Headers"), không cần token phía web:
 *   - Áp cho POST/PUT/PATCH/DELETE khi request mang cookie phiên (`allingo_at`/`allingo_rt`) mà KHÔNG có `Authorization`
 *     (mobile/bearer không bị ảnh hưởng), và cho MỌI POST `/v1/auth/*` (chống login CSRF – parser form-urlencoded có bật).
 *   - `Origin` có mặt → phải thuộc danh sách tin cậy (CORS_ORIGINS + WEB/API/CMS_PUBLIC_URL + CSRF_TRUSTED_ORIGINS);
 *     `Origin: null` → từ chối.
 *   - Không có `Origin`: `Sec-Fetch-Site` = cross-site → từ chối; `Referer` có mặt → origin phải tin cậy.
 *   - Không có cả ba (client không phải trình duyệt: curl, server-to-server, test) → cho qua (trình duyệt hiện đại luôn gửi
 *     Origin cho request ghi cross-origin; cookie SameSite=Lax là lớp thứ hai).
 *   - Ngoại lệ: webhook cổng thanh toán (`/v1/webhooks/` – không cookie, xác thực chữ ký), trang thanh toán giả lập dev (`/v1/payments/mock/`),
 *     API nội bộ (`/v1/internal/` – X-Internal-Token), route lưu trữ ký HMAC (`/v1/storage/fs/`).
 */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT_PREFIXES = ['/v1/webhooks/', '/v1/internal/', '/v1/storage/fs/', '/v1/payments/mock/'];

export function trustedOrigins(env: Pick<Env, 'CORS_ORIGINS' | 'WEB_PUBLIC_URL' | 'API_PUBLIC_URL' | 'CMS_PUBLIC_URL' | 'CSRF_TRUSTED_ORIGINS'>): Set<string> {
  const out = new Set<string>();
  for (const raw of [env.CORS_ORIGINS, env.WEB_PUBLIC_URL, env.API_PUBLIC_URL, env.CMS_PUBLIC_URL, env.CSRF_TRUSTED_ORIGINS ?? ''].join(',').split(',')) {
    const v = raw.trim();
    if (!v) continue;
    try {
      out.add(new URL(v).origin);
    } catch {
      /* bỏ qua giá trị không phải URL */
    }
  }
  return out;
}

export type CsrfDecision = { ok: true } | { ok: false; reason: 'origin_untrusted' | 'origin_null' | 'cross_site' | 'referer_untrusted' };

/** Quyết định CSRF thuần (unit test) */
export function csrfCheck(req: { method: string; url: string; headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string | undefined> }, trusted: Set<string>): CsrfDecision {
  if (!UNSAFE.has(req.method)) return { ok: true };
  const path = req.url.split('?')[0] ?? '';
  if (EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return { ok: true };
  const hasCookieSession = !!(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
  const hasBearer = typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0;
  const isAuthEndpoint = path.startsWith('/v1/auth/');
  if (!isAuthEndpoint && (!hasCookieSession || hasBearer)) return { ok: true };
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : undefined;
  if (origin !== undefined) {
    if (origin === 'null') return { ok: false, reason: 'origin_null' };
    return trusted.has(origin) ? { ok: true } : { ok: false, reason: 'origin_untrusted' };
  }
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return { ok: false, reason: 'cross_site' };
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  if (referer) {
    try {
      return trusted.has(new URL(referer).origin) ? { ok: true } : { ok: false, reason: 'referer_untrusted' };
    } catch {
      return { ok: false, reason: 'referer_untrusted' };
    }
  }
  return { ok: true };
}

function sendForbidden(req: FastifyRequest & { traceId?: string }, reply: FastifyReply, reason: string) {
  return reply
    .status(403)
    .header('content-type', 'application/json; charset=utf-8')
    .send({ error: { code: 'forbidden', message: 'Cross-site request rejected', details: { reason: 'csrf_origin_mismatch', check: reason }, trace_id: req.traceId ?? null } });
}

/**
 * Đăng ký các hook bảo mật: CSRF (preHandler – sau khi đọc cookie), CSP nghiêm cho phản hồi không phải HTML,
 * `Cache-Control: no-store` cho phản hồi có phiên (tránh cache dùng chung giữ dữ liệu cá nhân).
 */
export function registerSecurityHooks(fastify: FastifyInstance, env: Env): void {
  const trusted = trustedOrigins(env);
  if (env.CSRF_PROTECTION) {
    fastify.addHook('preHandler', (req, reply, done) => {
      const r = csrfCheck({ method: req.method, url: req.url, headers: req.headers, cookies: (req as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies }, trusted);
      if (r.ok) return done();
      void sendForbidden(req, reply, r.reason);
    });
  }
  fastify.addHook('onSend', (req, reply, payload, done) => {
    const ct = String(reply.getHeader('content-type') ?? '');
    // API JSON/SSE/tệp: không bao giờ được render như trang → CSP khoá toàn bộ; trang HTML (OG referral, docs, trang giả lập) tự đặt
    if (!ct.startsWith('text/html') && !reply.hasHeader('content-security-policy')) void reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const hasSession = typeof req.headers.authorization === 'string' || !!(req as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies?.[ACCESS_COOKIE];
    if (hasSession && !reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    done(null, payload);
  });
}

/** Cấu hình @fastify/helmet: HSTS 1 năm + includeSubDomains (preload theo env), không CSP mặc định (đặt ở onSend) */
export function helmetOptions(env: Pick<Env, 'SECURITY_HSTS_PRELOAD'>) {
  return {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' as const },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true, preload: env.SECURITY_HSTS_PRELOAD },
    referrerPolicy: { policy: 'no-referrer' as const },
    frameguard: { action: 'deny' as const },
  };
}
