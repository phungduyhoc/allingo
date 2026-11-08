import { AsyncLocalStorage } from 'node:async_hooks';
import { trace } from '@opentelemetry/api';

/**
 * Ngữ cảnh theo request/job (AsyncLocalStorage): trace_id để gắn vào mọi dòng log (pino mixin), job BullMQ (truyền
 * `traceparent` sang worker) và báo lỗi. Đặt ở `traceIdHook` (HTTP) và `runWithJobContext` (worker).
 */
export interface RequestContext {
  traceId: string;
  /** span id 16 hex của request/job (W3C traceparent); null khi không có OTel span */
  spanId: string | null;
  /** true nếu trace được lấy mẫu (cờ 01 của traceparent) */
  sampled: boolean;
  route?: string;
  job?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return als.getStore();
}

/** trace_id hiện hành: span OTel đang hoạt động → ngữ cảnh ALS → undefined */
export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  const id = span?.spanContext().traceId;
  if (id && id !== '00000000000000000000000000000000') return id;
  return als.getStore()?.traceId;
}

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Phân tích header W3C `traceparent` (version 00); trace/span id toàn 0 → null */
export function parseTraceparent(header: unknown): { traceId: string; spanId: string; sampled: boolean } | null {
  if (typeof header !== 'string') return null;
  const m = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!m || m[1] === 'ff') return null;
  const traceId = m[2]!;
  const spanId = m[3]!;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, sampled: (parseInt(m[4]!, 16) & 1) === 1 };
}

/** traceparent cho lời gọi/job đi ra: span OTel hiện hành nếu có, không thì từ ngữ cảnh ALS (span id ngẫu nhiên) */
export function outgoingTraceparent(randomSpanId: () => string): string | null {
  const span = trace.getActiveSpan();
  const sc = span?.spanContext();
  if (sc && sc.traceId !== '00000000000000000000000000000000') return `00-${sc.traceId}-${sc.spanId}-${(sc.traceFlags & 1) === 1 ? '01' : '00'}`;
  const ctx = als.getStore();
  if (!ctx) return null;
  return `00-${ctx.traceId}-${ctx.spanId ?? randomSpanId()}-${ctx.sampled ? '01' : '00'}`;
}
