import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Webhook revalidate từ CMS (S10, ADR-0033): chữ ký `x-allingo-signature: sha256=HMAC_SHA256(WEB_REVALIDATE_SECRET,
 * "<x-allingo-timestamp>.<body>")`, timestamp (giây) lệch ≤ ±5 phút (chống phát lại) – cùng thuật toán `verifyRevalidate` của
 * apps/cms/src/lib/marketing.ts. Payload `{event, collection, id, slug, paths, tags, locales, at}`; `paths` không có tiền tố
 * locale (`/`, `/<slug>`, `/blog`, `/blog/<slug>`, `/sitemap.xml`) → web làm mới `/vi…` và `/en…`. Thuần (trừ crypto), có test.
 */

export const REVALIDATE_SKEW_MS = 5 * 60_000;
const LOCALES = ['vi', 'en'] as const;

export function signRevalidate(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export type VerifyResult = 'ok' | 'missing' | 'stale' | 'bad_signature';

export function verifyRevalidateRequest(secret: string, timestamp: string | null, body: string, signature: string | null, now = Date.now()): VerifyResult {
  if (!timestamp || !signature) return 'missing';
  if (!/^\d{9,12}$/.test(timestamp)) return 'stale';
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > REVALIDATE_SKEW_MS) return 'stale';
  const a = Buffer.from(signRevalidate(secret, timestamp, body));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'bad_signature';
}

const pathSchema = z
  .string()
  .max(300)
  .regex(/^\/[A-Za-z0-9\-_/.]*$/)
  .refine((p) => !p.includes('..') && !p.includes('//'), 'invalid path');
const tagSchema = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,95}$/i);

export const revalidatePayloadSchema = z.object({
  event: z.enum(['publish', 'unpublish', 'update', 'delete']),
  collection: z.enum(['pages', 'posts', 'redirects']),
  id: z.string().max(64),
  slug: z.string().max(128).nullable(),
  paths: z.array(pathSchema).max(50),
  tags: z.array(tagSchema).max(50),
  locales: z.array(z.string()).max(10).optional(),
  at: z.string().max(40).optional(),
});
export type RevalidatePayload = z.infer<typeof revalidatePayloadSchema>;

export interface RevalidationPlan {
  /** Đường dẫn web cụ thể (đã thêm locale) cho revalidatePath */
  paths: string[];
  tags: string[];
}

/** Đường dẫn CMS → đường dẫn web theo locale (`/` → `/vi`, `/en`; `/sitemap.xml` giữ nguyên; slug trang `home` = `/`) */
export function revalidationPlan(p: RevalidatePayload): RevalidationPlan {
  const locales = (p.locales ?? LOCALES).filter((l): l is (typeof LOCALES)[number] => (LOCALES as readonly string[]).includes(l));
  const useLocales = locales.length ? locales : [...LOCALES];
  const paths = new Set<string>();
  for (const raw of p.paths) {
    if (raw === '/sitemap.xml' || raw === '/robots.txt') {
      paths.add(raw);
      continue;
    }
    const clean = raw === '/home' ? '/' : raw.replace(/\/+$/, '') || '/';
    for (const l of useLocales) paths.add(clean === '/' ? `/${l}` : `/${l}${clean}`);
  }
  // Bài viết đổi → danh sách blog + sitemap cũng phải mới (phòng payload thiếu)
  if (p.collection === 'posts') {
    for (const l of useLocales) paths.add(`/${l}/blog`);
    paths.add('/sitemap.xml');
  }
  const tags = new Set(p.tags);
  if (p.collection === 'posts') tags.add('posts');
  if (p.collection === 'pages') tags.add('pages');
  if (p.collection === 'redirects') tags.add('redirects');
  tags.add('sitemap');
  return { paths: [...paths], tags: [...tags] };
}
