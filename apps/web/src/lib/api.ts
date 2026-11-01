import { createApiClient, postJsonOrSse, type ApiClient } from '@allingo/api-client';
import { env } from '@/env';

/** Sự kiện phát ra khi refresh token thất bại → AuthGate đưa người dùng về trang chủ */
export const UNAUTHORIZED_EVENT = 'allingo:unauthorized';

/** Bật fetch giả lập khi NEXT_PUBLIC_API_MOCK=1 (hằng số build-time để tree-shake mã mock ở production) */
const USE_MOCK = process.env.NEXT_PUBLIC_API_MOCK === '1';

let mockFetchPromise: Promise<typeof fetch> | null = null;

/** fetch dùng cho mọi lời gọi API: fetch thật hoặc mock (nạp lười, chỉ ở client) */
export function getApiFetch(): typeof fetch {
  if (!USE_MOCK) return (input, init) => fetch(input, init);
  return async (input, init) => {
    mockFetchPromise ??= import('@/mock/mock-fetch').then((m) => m.createMockFetch());
    const f = await mockFetchPromise;
    return f(input, init);
  };
}

let currentLocale = env.defaultLocale as string;
/** Cập nhật Accept-Language cho client (gọi từ layout [locale]) */
export function setApiLocale(locale: string): void {
  currentLocale = locale;
}

let client: ApiClient | null = null;

/** Client typed theo OpenAPI, chế độ cookie (credentials: include), tự refresh khi 401 */
export function getApi(): ApiClient {
  if (client) return client;
  client = createApiClient({
    baseUrl: env.apiUrl,
    mode: 'cookie',
    fetch: getApiFetch(),
    onUnauthorized: () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    },
  });
  client.use({
    onRequest({ request }) {
      request.headers.set('Accept-Language', currentLocale);
      return request;
    },
  });
  return client;
}

/** POST có thể trả JSON (cache) hoặc SSE (sinh mới) – dùng cho /ai/explain */
export function postJsonOrStream(path: string, body: unknown, signal?: AbortSignal) {
  return postJsonOrSse(env.apiUrl, path, body, {
    fetch: getApiFetch(),
    credentials: 'include',
    headers: { 'Accept-Language': currentLocale },
    signal,
  });
}
