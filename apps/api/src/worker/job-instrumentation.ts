import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job } from 'bullmq';
import { TRACEPARENT_FIELD } from '../shared/queue/queue.module.js';
import { getErrorReporter } from '../shared/telemetry/error-reporter.js';
import { getLogger } from '../shared/telemetry/logger.js';
import { metrics, OPS_METRICS, QUEUE_METRICS } from '../shared/telemetry/metrics.js';
import { parseTraceparent, runWithContext } from '../shared/telemetry/request-context.js';

const tracer = trace.getTracer('allingo.worker');

/**
 * Bọc handler BullMQ (S11): tách `_traceparent` khỏi job.data → ngữ cảnh ALS (log có trace_id của request gốc) + span OTel
 * `queue.process` (con của span request khi OTel bật); metrics thời gian chờ/xử lý/thất bại; lỗi lần thử cuối → ErrorReporter.
 */
export async function instrumentJob<T>(queue: string, job: Job, fn: () => Promise<T>): Promise<T> {
  const data = (job.data ?? {}) as Record<string, unknown>;
  const tp = typeof data[TRACEPARENT_FIELD] === 'string' ? data[TRACEPARENT_FIELD] : undefined;
  if (tp !== undefined) delete data[TRACEPARENT_FIELD];
  const parent = parseTraceparent(tp);
  const labels = { queue, job: job.name };
  const startedAt = Date.now();
  if (job.timestamp) QUEUE_METRICS.wait.observe(labels, Math.max(0, ((job.processedOn ?? startedAt) - job.timestamp) / 1000));
  const traceId = parent?.traceId ?? randomBytes(16).toString('hex');
  const ctx = { traceId, spanId: randomBytes(8).toString('hex'), sampled: parent?.sampled ?? false, job: job.name };
  const parentCtx = tp ? propagation.extract(ROOT_CONTEXT, { traceparent: tp }) : context.active();
  return runWithContext(ctx, () =>
    tracer.startActiveSpan(`queue.process ${job.name}`, { kind: SpanKind.CONSUMER, attributes: { 'messaging.system': 'bullmq', 'messaging.destination.name': queue, 'messaging.operation': 'process', 'allingo.job': job.name, 'allingo.attempt': (job.attemptsMade ?? 0) + 1 } }, parentCtx, async (span) => {
      try {
        const out = await fn();
        QUEUE_METRICS.duration.observe({ ...labels, status: 'completed' }, (Date.now() - startedAt) / 1000);
        span.setStatus({ code: SpanStatusCode.OK });
        return out;
      } catch (err) {
        QUEUE_METRICS.duration.observe({ ...labels, status: 'failed' }, (Date.now() - startedAt) / 1000);
        QUEUE_METRICS.failed.inc(labels);
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message?.slice(0, 200) });
        const final = (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);
        if (final && getErrorReporter().enabled) {
          OPS_METRICS.errorsReported.inc({ source: 'worker' });
          getErrorReporter().capture(err, { tags: { queue, job: job.name, attempts: (job.attemptsMade ?? 0) + 1 } });
        }
        throw err;
      } finally {
        span.end();
      }
    }),
  );
}

/**
 * Cổng metrics của worker (ADR-0026 hệ quả: worker không có HTTP → SPEC-ISSUES S44). `GET /metrics` với
 * `Authorization: Bearer <METRICS_TOKEN|INTERNAL_API_TOKEN>`; chỉ mở trong mạng nội bộ (Container App không ingress ngoài).
 */
export function startWorkerMetricsServer(port: number, token: string): http.Server | null {
  if (!port) return null;
  const logger = getLogger({ component: 'worker-metrics' });
  const expected = Buffer.from(token);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization ?? '';
    const got = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid metrics token' } }));
      return;
    }
    void metrics.collectAndRender().then((body) => res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' }).end(body));
  });
  server.on('error', (err) => logger.warn({ err: err.message, port }, 'worker metrics server error'));
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'worker metrics listening'));
  server.unref();
  return server;
}
