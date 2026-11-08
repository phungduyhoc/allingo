import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { BILLING_METRICS } from './metrics.js';

const tracer = trace.getTracer('allingo.outbound');

/**
 * Span + histogram cho lời gọi HTTP ra cổng thanh toán/hoá đơn (S11). Auto-instrumentation undici đã có span `POST`;
 * span này thêm ngữ nghĩa nghiệp vụ (`allingo.system`, host) và metrics `billing_provider_call_duration_seconds{provider,op,status}`.
 * Không ghi URL đầy đủ/query/body (có chữ ký, dữ liệu người mua).
 */
export async function observeOutbound<T extends { status: number }>(system: 'payment' | 'einvoice' | 'speech' | 'email', url: string, method: string, fn: () => Promise<T>): Promise<T> {
  let host = 'unknown';
  try {
    host = new URL(url).host;
  } catch {
    /* giữ unknown */
  }
  const started = performance.now();
  return tracer.startActiveSpan(`${system} ${method} ${host}`, { kind: SpanKind.CLIENT, attributes: { 'allingo.system': system, 'server.address': host, 'http.request.method': method } }, async (span) => {
    try {
      const res = await fn();
      span.setAttribute('http.response.status_code', res.status);
      if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      BILLING_METRICS.providerCalls.observe({ provider: host, op: `${system}.${method.toLowerCase()}`, status: String(res.status) }, (performance.now() - started) / 1000);
      return res;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).name });
      BILLING_METRICS.providerCalls.observe({ provider: host, op: `${system}.${method.toLowerCase()}`, status: 'error' }, (performance.now() - started) / 1000);
      throw err;
    } finally {
      span.end();
    }
  });
}
