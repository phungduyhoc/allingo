import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { revalidatePayloadSchema, revalidationPlan, verifyRevalidateRequest } from '@/lib/cms/revalidate';

/**
 * POST /api/revalidate – webhook của CMS (Payload afterChange/afterDelete của pages/posts/redirects). Kiểm HMAC + timestamp
 * (±5 phút) bằng `WEB_REVALIDATE_SECRET` (biến môi trường server, ≥ 16 ký tự) TRƯỚC khi đọc payload; hợp lệ → làm mới ISR theo
 * đường dẫn (`/vi…`, `/en…`, `/sitemap.xml`) và thẻ fetch (`posts`, `post:<slug>`, `pages`, `page:<slug>`, `redirects`,
 * `sitemap`) – trang hiển thị bản mới ở lượt truy cập kế tiếp (≤ 5 phút kể cả khi webhook lỗi nhờ ISR 300 s).
 * Lỗi: 503 chưa cấu hình secret · 401 chữ ký/timestamp sai · 400 payload sai · 413 thân quá lớn.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY = 32 * 1024;

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  const secret = process.env.WEB_REVALIDATE_SECRET;
  if (!secret || secret.length < 16) return err(503, 'not_configured', 'Revalidate webhook is not configured');
  const body = await req.text();
  if (body.length > MAX_BODY) return err(413, 'payload_too_large', 'Body too large');
  const verdict = verifyRevalidateRequest(secret, req.headers.get('x-allingo-timestamp'), body, req.headers.get('x-allingo-signature'));
  if (verdict !== 'ok') return err(401, 'unauthorized', verdict === 'stale' ? 'Stale or invalid timestamp' : 'Invalid signature');
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return err(400, 'validation_failed', 'Body is not JSON');
  }
  const parsed = revalidatePayloadSchema.safeParse(json);
  if (!parsed.success) return err(400, 'validation_failed', 'Invalid revalidate payload');
  const plan = revalidationPlan(parsed.data);
  // Hết hạn ngay (không stale-while-revalidate) – webhook là nguồn "đã xuất bản"
  for (const tag of plan.tags) revalidateTag(tag, { expire: 0 });
  for (const path of plan.paths) revalidatePath(path);
  return NextResponse.json({ revalidated: true, event: parsed.data.event, paths: plan.paths, tags: plan.tags, at: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
}

export function GET() {
  return err(405, 'method_not_allowed', 'Use POST');
}
