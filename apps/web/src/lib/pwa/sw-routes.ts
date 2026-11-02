/**
 * Quy tắc cache của service worker (thuần – có test, dùng chung cho `src/app/sw.ts`).
 * NGUYÊN TẮC: KHÔNG BAO GIỜ cache phản hồi API (bài làm, đáp án, giải thích, gia sư, credit…) – kể cả GET – để dữ liệu luôn
 * mới và không lưu nội dung nhạy cảm/đáp án trên thiết bị. Chỉ cache tài nguyên tĩnh của web: `_next/static`, ảnh, audio
 * (stale-while-revalidate), và trang offline (precache). Điều hướng: mạng, mất mạng → trang offline.
 */

export type SwStrategy =
  /** Không cache: API (NetworkOnly) */
  | 'api'
  /** _next/static: CacheFirst (dev: NetworkFirst) */
  | 'static'
  | 'image'
  | 'audio'
  /** Điều hướng trang: mạng, lỗi → trang offline theo locale */
  | 'page'
  /** Không xử lý (để trình duyệt tự đi mạng): RSC, POST, origin lạ… */
  | 'none';

export interface SwRequestInfo {
  url: URL;
  method: string;
  destination: string;
  mode: string;
  /** Header Accept (SSE/JSON) */
  accept?: string | null;
  /** Origin của service worker */
  origin: string;
  /** Origin + pathname gốc của API (vd. http://localhost:4000 + /v1) */
  apiOrigin: string;
  apiPath?: string;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|svg|gif|ico)$/i;
const AUDIO_EXT = /\.(wav|mp3|m4a|ogg|oga|aac|webm)$/i;

/** Yêu cầu tới API? (origin API; hoặc API cùng origin dưới apiPath; hoặc SSE/JSON động) */
export function isApiRequest(
  info: Pick<SwRequestInfo, 'url' | 'apiOrigin' | 'apiPath' | 'origin' | 'accept'>,
): boolean {
  const { url } = info;
  const apiPath = info.apiPath && info.apiPath !== '/' ? info.apiPath.replace(/\/$/, '') : '';
  if (
    info.apiOrigin &&
    url.origin === info.apiOrigin &&
    (!apiPath || url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`))
  )
    return true;
  // API phục vụ cùng origin với web (reverse proxy) – mọi đường dẫn dưới apiPath
  if (apiPath && url.origin === info.origin && (url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`)))
    return true;
  // Route handler của Next (/api/*) và luồng SSE không bao giờ cache
  if (url.origin === info.origin && url.pathname.startsWith('/api/')) return true;
  if (info.accept?.includes('text/event-stream')) return true;
  return false;
}

export function classifyRequest(info: SwRequestInfo): SwStrategy {
  if (info.method !== 'GET') return 'none';
  if (isApiRequest(info)) return 'api';
  const { url } = info;
  const sameOrigin = url.origin === info.origin;
  if (sameOrigin && info.mode === 'navigate') return 'page';
  if (sameOrigin && url.pathname.startsWith('/_next/static/')) return 'static';
  // Dữ liệu RSC/JSON của Next, tệp hệ thống SW → không đụng tới
  if (sameOrigin && (url.searchParams.has('_rsc') || url.pathname.startsWith('/_next/') || url.pathname === '/sw.js'))
    return 'none';
  if (info.destination === 'image' || IMAGE_EXT.test(url.pathname)) return 'image';
  if (info.destination === 'audio' || AUDIO_EXT.test(url.pathname)) return 'audio';
  return 'none';
}

/** Trang offline theo locale của đường dẫn điều hướng (`/en/...` → en, còn lại → vi) */
export function offlineUrlFor(pathname: string): string {
  return pathname === '/en' || pathname.startsWith('/en/') ? '/en/offline' : '/vi/offline';
}

/** Đường dẫn tài nguyên tĩnh (script/style) trong HTML trang offline – precache để trang offline hydrate được */
export function staticAssetsInHtml(html: string): string[] {
  const out = new Set<string>();
  const re = /(?:src|href)="(\/_next\/static\/[^"?#]+(?:\?[^"#]*)?)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1]!.replace(/&amp;/g, '&');
    if (/\.(js|css|woff2?)(\?|$)/.test(u)) out.add(u);
  }
  return [...out];
}
