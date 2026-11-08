import { createApiClient, postJsonOrSse, type ApiClient } from '@allingo/api-client';
import { env } from '@/env';
import { pageTraceparent } from './telemetry/trace';
import { recordResponseTrace } from './telemetry/last-trace';
import { createMfaStepUpMiddleware } from './mfa-step-up';

/** Sự kiện phát ra khi refresh token thất bại → AuthGate đưa người dùng về trang chủ */
export const UNAUTHORIZED_EVENT = 'allingo:unauthorized';

/** Bật fetch giả lập khi NEXT_PUBLIC_API_MOCK=1 (hằng số build-time để tree-shake mã mock ở production) */
const USE_MOCK = process.env.NEXT_PUBLIC_API_MOCK === '1';

let mockFetchPromise: Promise<typeof fetch> | null = null;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * S11: request GHI mang `traceparent` của lượt xem (đã có preflight vì JSON – không thêm request), để API nối trace với web.
 * Header đã có (vd client tự đặt) giữ nguyên.
 */
export function withTraceparent(input: RequestInfo | URL, init: RequestInit | undefined): [RequestInfo | URL, RequestInit | undefined] {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!WRITE_METHODS.has(method)) return [input, init];
  if (input instanceof Request && !init) {
    if (!input.headers.has('traceparent')) input.headers.set('traceparent', pageTraceparent());
    return [input, init];
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('traceparent')) headers.set('traceparent', pageTraceparent());
  return [input, { ...init, headers }];
}

/**
 * S11: chuẩn hoá envelope lỗi 429/503 – chép header `Retry-After` vào `details.retry_after_sec` và `X-Trace-Id` vào `trace_id` khi
 * thân thiếu (giới hạn tốc độ toàn cục, proxy/WAF trả lỗi tối giản) để `ApiError` luôn có thời gian chờ + trace cho toast/Sentry.
 */
export async function normalizeErrorResponse(res: Response): Promise<Response> {
  if (res.status !== 429 && res.status !== 503) return res;
  const retryHeader = res.headers.get('retry-after');
  const traceHeader = res.headers.get('x-trace-id');
  if (!retryHeader && !traceHeader) return res;
  type ErrorBody = { error?: { code?: string; message?: string; details?: Record<string, unknown>; trace_id?: string | null } };
  let body: ErrorBody | null = null;
  try {
    body = (await res.clone().json()) as ErrorBody;
  } catch {
    body = null;
  }
  const err = body?.error ?? { code: res.status === 429 ? 'rate_limited' : 'internal', message: res.statusText || 'Request failed' };
  const details = { ...(err.details ?? {}) };
  let changed = !body?.error;
  const retry = retryHeader && /^\d+$/.test(retryHeader.trim()) ? Number(retryHeader) : null;
  if (retry !== null && typeof details.retry_after_sec !== 'number') {
    details.retry_after_sec = retry;
    changed = true;
  }
  const traceId = err.trace_id ?? traceHeader ?? null;
  if (traceId !== (err.trace_id ?? null)) changed = true;
  if (!changed) return res;
  const headers = new Headers(res.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...(body ?? {}), error: { ...err, details, trace_id: traceId } }), { status: res.status, statusText: res.statusText, headers });
}

/**
 * fetch dùng cho mọi lời gọi API: fetch thật hoặc mock (nạp lười, chỉ ở client) + traceparent + chuẩn hoá lỗi 429/503.
 * S12: ghi `X-Trace-Id` của phản hồi (góp ý in-app tự gắn trace gần nhất – `telemetry/last-trace.ts`).
 */
export function getApiFetch(): typeof fetch {
  if (!USE_MOCK) {
    return async (input, init) => {
      const res = await fetch(...withTraceparent(input, init));
      recordResponseTrace(res);
      return normalizeErrorResponse(res);
    };
  }
  return async (input, init) => {
    mockFetchPromise ??= import('@/mock/mock-fetch').then((m) => m.createMockFetch());
    const f = await mockFetchPromise;
    const res = await f(...withTraceparent(input, init));
    recordResponseTrace(res);
    return normalizeErrorResponse(res);
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
  // S12: 403 `mfa_required` ở endpoint quản trị → hộp thoại step-up (layout (app)) → gửi lại request một lần
  const apiFetch = getApiFetch();
  client.use(createMfaStepUpMiddleware({ fetch: (req) => apiFetch(req) }));
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
