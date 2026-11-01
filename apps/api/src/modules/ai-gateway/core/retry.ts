/**
 * Retry có jitter cho lời gọi provider (S5). Chỉ retry lỗi TẠM THỜI: HTTP 408/409/425/429/5xx/529, lỗi mạng
 * (ECONNRESET, ETIMEDOUT, socket hang up, fetch failed) hoặc lỗi SDK đánh dấu `isRetryable`.
 * KHÔNG retry: timeout của route (hết ngân sách thời gian → chuyển fallback), abort từ client, 4xx khác (khoá sai, request sai),
 * đầu ra sai schema (đã có bước repair riêng).
 */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

interface ErrorLike {
  name?: string;
  message?: string;
  statusCode?: number;
  status?: number;
  isRetryable?: boolean;
  code?: string;
  cause?: unknown;
}

const asErr = (e: unknown): ErrorLike => (e && typeof e === 'object' ? (e) : { message: String(e) });

export function isAbortOrTimeout(err: unknown): boolean {
  const e = asErr(err);
  const msg = (e.message ?? '').toLowerCase();
  return e.name === 'AbortError' || e.name === 'TimeoutError' || msg.includes('timeout') || msg.includes('aborted') || msg.includes('abort');
}

export function statusOf(err: unknown): number | undefined {
  const e = asErr(err);
  return e.statusCode ?? e.status ?? (e.cause ? asErr(e.cause).statusCode : undefined);
}

export function isTransientError(err: unknown): boolean {
  if (isAbortOrTimeout(err)) return false;
  const e = asErr(err);
  const status = statusOf(err);
  if (status !== undefined) return TRANSIENT_STATUS.has(status);
  if (e.isRetryable === true) return true;
  const code = e.code ?? (e.cause ? asErr(e.cause).code : undefined);
  if (code && TRANSIENT_CODES.has(code)) return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('fetch failed') || msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('overloaded') || msg.includes('temporarily unavailable');
}

/** Phân loại mã lỗi cho ai_tasks.error_code */
export function errorCodeOf(err: unknown): 'timeout' | 'rate_limited' | 'provider_unavailable' | 'auth' | 'bad_request' | 'provider_error' {
  if (isAbortOrTimeout(err)) return 'timeout';
  const s = statusOf(err);
  if (s === 429) return 'rate_limited';
  if (s === 401 || s === 403) return 'auth';
  if (s !== undefined && s >= 400 && s < 500) return 'bad_request';
  if (s !== undefined && s >= 500) return 'provider_unavailable';
  return isTransientError(err) ? 'provider_unavailable' : 'provider_error';
}

/** Full jitter: random(0, min(cap, base·2^attempt)) */
export function backoffDelay(attempt: number, baseMs: number, capMs = 4000, rand: () => number = Math.random): number {
  return Math.floor(rand() * Math.min(capMs, baseMs * 2 ** attempt));
}

export interface RetryOptions {
  /** Số lần thử lại tối đa (không gồm lần đầu) */
  retries: number;
  baseMs: number;
  /** Hạn chót tuyệt đối (epoch ms) – không chờ backoff vượt quá */
  deadline?: number;
  rand?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !isTransientError(err)) throw err;
      const delayMs = backoffDelay(attempt, opts.baseMs, 4000, opts.rand);
      if (opts.deadline !== undefined && now() + delayMs >= opts.deadline) throw err;
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs);
      attempt++;
    }
  }
}
