import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Gắn trace_id (từ OTel span nếu có, không thì UUID) vào request và header phản hồi */
export function traceIdHook(request: FastifyRequest & { traceId?: string }, reply: FastifyReply, done: () => void): void {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId ?? (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
  request.traceId = traceId;
  void reply.header('x-trace-id', traceId);
  done();
}
