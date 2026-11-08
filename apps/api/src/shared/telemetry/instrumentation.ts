import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HTTP_METRICS, OPS_METRICS, metrics } from './metrics.js';

/** Nhãn route: mẫu đường dẫn Fastify (không chứa id/query) – 404 không khớp route gộp một nhãn để chặn bùng nổ cardinality */
export function routeLabel(req: FastifyRequest): string {
  const url = req.routeOptions?.url;
  return url && url.length > 0 ? url : 'unmatched';
}

/** RED theo route (S11) – onRequest tăng in-flight, onResponse ghi counter + histogram */
export function registerHttpMetrics(fastify: FastifyInstance): void {
  let inflight = 0;
  fastify.addHook('onRequest', (_req, _reply, done) => {
    inflight++;
    HTTP_METRICS.inflight.set({}, inflight);
    done();
  });
  fastify.addHook('onResponse', (req, reply, done) => {
    inflight = Math.max(0, inflight - 1);
    HTTP_METRICS.inflight.set({}, inflight);
    const labels = { method: req.method, route: routeLabel(req), status: String(reply.statusCode) };
    HTTP_METRICS.requests.inc(labels);
    HTTP_METRICS.duration.observe(labels, reply.elapsedTime / 1000);
    done();
  });
}

let started = false;

/** Metrics process (RSS, heap, event loop lag p99, build info) – cập nhật khi scrape */
export function startProcessMetrics(service: string, env: string): void {
  if (started) return;
  started = true;
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  OPS_METRICS.processStart.set({}, Math.round(Date.now() / 1000 - process.uptime()));
  OPS_METRICS.info.set({ service, version: process.env.npm_package_version ?? '0.1.0', env }, 1);
  metrics.registerCollector('process', () => {
    const mem = process.memoryUsage();
    OPS_METRICS.memory.set({}, mem.rss);
    OPS_METRICS.heap.set({}, mem.heapUsed);
    OPS_METRICS.eventLoopLag.set({}, h.percentile(99) / 1e9);
    h.reset();
  });
}
