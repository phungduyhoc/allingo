import { newTraceId, traceparent } from './sentry-ids';

/**
 * Trace của lượt xem trang (S11): mỗi route một trace id 32 hex; request GHI (POST/PUT/PATCH/DELETE – vốn đã có preflight CORS)
 * gửi `traceparent` cùng trace để API (OTel) nối span → `error.trace_id`/`x-trace-id` trùng trace web gửi lên Sentry. GET không
 * gửi để không biến request đơn giản thành preflight (gấp đôi số request).
 */
let pageTraceId = newTraceId();
let pageRoute: string | null = null;

export function getPageTraceId(): string {
  return pageTraceId;
}

/** Gọi khi đổi route (client navigation) */
export function rotatePageTrace(route: string): void {
  if (route === pageRoute) return;
  if (pageRoute !== null) pageTraceId = newTraceId();
  pageRoute = route;
}

export function pageTraceparent(): string {
  return traceparent(pageTraceId);
}
