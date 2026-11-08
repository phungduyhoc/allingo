import { parsePublicFlags, type PublicFlags } from './flags';

/**
 * Cờ công khai cho lần render đầu (SSR – S11): gọi `GET /flags` ẩn danh từ server, Data Cache 30 s (= `ttl_sec`), chờ tối đa
 * 400 ms (API chậm/tắt không kéo dài TTFB – lỗi → null, client tự tải). Client vẫn tải lại kèm cookie để đánh giá theo người dùng.
 * Bản mock (NEXT_PUBLIC_API_MOCK=1) không có API ở server → null (mock trả cờ ở client).
 * `API_INTERNAL_URL` (tuỳ chọn): URL API trong mạng nội bộ của container web.
 */
export async function getServerFlags(): Promise<PublicFlags | null> {
  if (process.env.NEXT_PUBLIC_API_MOCK === '1') return null;
  const base = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/flags`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30, tags: ['flags'] },
      signal: AbortSignal.timeout(400),
    });
    if (!res.ok) return null;
    return parsePublicFlags(await res.json());
  } catch {
    return null;
  }
}
