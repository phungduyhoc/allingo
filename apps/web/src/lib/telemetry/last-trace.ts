/**
 * trace_id gần nhất (S12 – góp ý in-app tự gắn `trace_id`): API trả `X-Trace-Id` ở mọi phản hồi (CORS đã expose). Lưu trong bộ
 * nhớ (không localStorage, không PII): bản gần nhất và bản của phản hồi LỖI gần nhất – góp ý thường gửi ngay sau khi gặp lỗi nên ưu
 * tiên trace lỗi còn mới (≤ 15 phút), không có thì trace gần nhất, quá cũ → bỏ (server tự gắn trace của chính request góp ý).
 */

const TRACE_RE = /^[A-Za-z0-9._-]{8,64}$/;
export const TRACE_MAX_AGE_MS = 15 * 60_000;

interface Seen {
  id: string;
  at: number;
}

let last: Seen | null = null;
let lastError: Seen | null = null;

export function recordTrace(id: string | null | undefined, ok: boolean, now = Date.now()): void {
  if (!id || !TRACE_RE.test(id)) return;
  last = { id, at: now };
  if (!ok) lastError = { id, at: now };
}

/** Ghi từ phản hồi fetch (header `x-trace-id`) */
export function recordResponseTrace(res: Response, now = Date.now()): void {
  try {
    recordTrace(res.headers.get('x-trace-id'), res.ok, now);
  } catch {
    /* Response giả không có headers */
  }
}

export function latestTraceId(now = Date.now(), maxAgeMs = TRACE_MAX_AGE_MS): string | null {
  if (lastError && now - lastError.at <= maxAgeMs) return lastError.id;
  if (last && now - last.at <= maxAgeMs) return last.id;
  return null;
}

/** Chỉ dùng trong test */
export function resetTracesForTest(): void {
  last = null;
  lastError = null;
}
