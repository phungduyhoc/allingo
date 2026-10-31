import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/openapi.js';

export type { paths, components } from './generated/openapi.js';
export type ApiPaths = paths;

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown>; trace_id?: string };
}

/** Lỗi API chuẩn hoá từ envelope { error: { code, message, details, trace_id } } */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly traceId?: string;
  constructor(status: number, body: ApiErrorBody | undefined, fallback = 'Request failed') {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? (status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'internal');
    this.details = body?.error?.details;
    this.traceId = body?.error?.trace_id;
  }
}

export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  setTokens(tokens: { access_token: string; refresh_token?: string; expires_in?: number } | null): void | Promise<void>;
  getRefreshToken?(): string | null | Promise<string | null>;
}

export interface CreateApiClientOptions {
  baseUrl: string;
  /**
   * web: cookie httpOnly (allingo_at/allingo_rt) do API đặt, client gửi credentials: 'include'.
   * bearer: mobile/CLI – token lưu trong TokenStore và gửi Authorization: Bearer.
   */
  mode?: 'cookie' | 'bearer';
  tokenStore?: TokenStore;
  /** Gắn thêm header (vd: Accept-Language) */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Gọi khi refresh thất bại (đăng xuất UI) */
  onUnauthorized?: () => void;
}

/**
 * Client typed theo docs/spec/allingo-openapi.yaml. Tự refresh token 1 lần khi 401 rồi gọi lại.
 */
export function createApiClient(opts: CreateApiClientOptions) {
  const mode = opts.mode ?? 'cookie';
  const client = createClient<paths>({
    baseUrl: opts.baseUrl,
    credentials: mode === 'cookie' ? 'include' : 'same-origin',
    headers: { Accept: 'application/json', ...opts.headers },
    fetch: opts.fetch,
  });

  let refreshing: Promise<boolean> | null = null;
  const refresh = async (): Promise<boolean> => {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const body = mode === 'bearer' && opts.tokenStore?.getRefreshToken ? { refresh_token: (await opts.tokenStore.getRefreshToken()) ?? undefined } : {};
          const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/auth/refresh`, {
            method: 'POST',
            credentials: mode === 'cookie' ? 'include' : 'same-origin',
            headers: { 'Content-Type': 'application/json', ...opts.headers },
            body: JSON.stringify(body),
          });
          if (!res.ok) return false;
          if (mode === 'bearer' && opts.tokenStore) {
            const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
            await opts.tokenStore.setTokens(json);
          }
          return true;
        } catch {
          return false;
        } finally {
          setTimeout(() => (refreshing = null), 0);
        }
      })();
    }
    return refreshing;
  };

  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      if (mode === 'bearer' && opts.tokenStore) {
        const token = await opts.tokenStore.getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || request.url.includes('/auth/')) return response;
      const ok = await refresh();
      if (!ok) {
        opts.onUnauthorized?.();
        return response;
      }
      const retry = request.clone();
      if (mode === 'bearer' && opts.tokenStore) {
        const token = await opts.tokenStore.getAccessToken();
        if (token) retry.headers.set('Authorization', `Bearer ${token}`);
      }
      return (opts.fetch ?? fetch)(retry);
    },
  };
  client.use(authMiddleware);
  return client;
}
export type ApiClient = ReturnType<typeof createApiClient>;

/** Ném ApiError khi response có lỗi; trả data khi thành công (dùng với openapi-fetch) */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(result.response.status, result.error as ApiErrorBody | undefined);
  }
  return result.data as T;
}

export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * Đọc luồng SSE (text/event-stream) từ một Response; yield từng sự kiện { event, data }.
 * Dùng cho POST /ai/explain và /ai/threads/{id}/messages.
 */
export async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      const raw = dataLines.join('\n');
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* giữ chuỗi thô */
      }
      yield { event, data };
    }
  }
}

/**
 * Gọi endpoint có thể trả JSON (cache hit) hoặc SSE (sinh mới). Trả về { kind: 'json' | 'sse' }.
 */
export async function postJsonOrSse(
  baseUrl: string,
  path: string,
  body: unknown,
  init: { headers?: Record<string, string>; credentials?: RequestCredentials; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ kind: 'json'; data: unknown; response: Response } | { kind: 'sse'; events: AsyncGenerator<SseEvent>; response: Response }> {
  const f = init.fetch ?? fetch;
  const response = await f(`${baseUrl}${path}`, {
    method: 'POST',
    credentials: init.credentials ?? 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', ...init.headers },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  if (!response.ok) {
    let parsed: ApiErrorBody | undefined;
    try {
      parsed = (await response.json()) as ApiErrorBody;
    } catch {
      /* ignore */
    }
    throw new ApiError(response.status, parsed);
  }
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) return { kind: 'sse', events: readSse(response), response };
  return { kind: 'json', data: await response.json(), response };
}
