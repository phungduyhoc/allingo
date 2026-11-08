import { randomBytes } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseTraceparent, runWithContext } from '../telemetry/request-context.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gắn trace_id vào request, header phản hồi `x-trace-id` và ngữ cảnh ALS (log/job/báo lỗi) – S11:
 *  1) span OTel đang hoạt động (auto-instrumentation http/fastify đã đọc `traceparent` của client);
 *  2) header W3C `traceparent` của client (khi OTel tắt) → cùng trace id với hệ thống phía trước;
 *  3) `x-request-id` hợp lệ (8–64 ký tự an toàn – chống chèn header/giả log);
 *  4) 32 hex ngẫu nhiên (định dạng trace id W3C).
 */
export function traceIdHook(request: FastifyRequest & { traceId?: string }, reply: FastifyReply, done: () => void): void {
  const sc = trace.getActiveSpan()?.spanContext();
  const parent = parseTraceparent(request.headers.traceparent);
  const rid = request.headers['x-request-id'];
  let traceId: string;
  let spanId: string | null = null;
  let sampled = false;
  if (sc && sc.traceId !== '00000000000000000000000000000000') {
    traceId = sc.traceId;
    spanId = sc.spanId;
    sampled = (sc.traceFlags & 1) === 1;
  } else if (parent) {
    traceId = parent.traceId;
    spanId = randomBytes(8).toString('hex');
    sampled = parent.sampled;
  } else if (typeof rid === 'string' && SAFE_REQUEST_ID.test(rid)) {
    traceId = rid;
  } else {
    traceId = randomBytes(16).toString('hex');
  }
  request.traceId = traceId;
  const ctx = { traceId, spanId, sampled };
  (request as FastifyRequest & { reqCtx?: typeof ctx }).reqCtx = ctx;
  void reply.header('x-trace-id', traceId);
  runWithContext(ctx, done);
}

/**
 * preHandler: gắn lại ngữ cảnh ALS – đọc body (sự kiện stream của socket) có thể làm mất store đã đặt ở onRequest,
 * nên handler/guard của Nest chạy trong `run()` mới với cùng ngữ cảnh.
 */
export function rebindTraceContextHook(request: FastifyRequest, _reply: FastifyReply, done: () => void): void {
  const ctx = (request as FastifyRequest & { reqCtx?: { traceId: string; spanId: string | null; sampled: boolean } }).reqCtx;
  if (!ctx) return done();
  runWithContext({ ...ctx, route: request.routeOptions?.url }, done);
}
