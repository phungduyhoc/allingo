import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import type { Env } from '../../config/env.js';

let sdk: NodeSDK | null = null;

/** Khởi động OpenTelemetry trước khi import NestJS (gọi ở đầu main.ts/worker.ts). Tắt được bằng OTEL_ENABLED=false. */
/**
 * S11: auto-instrumentation http (gồm fetch/undici → AI, cổng thanh toán, Azure, Resend…), fastify, postgres-js (
 * không có instrumentation chính thức → span DB qua histogram + slow query log), ioredis, BullMQ (span thủ công trong worker).
 * Không ghi header/body: `requestHook` không dùng; DNS/net/fs tắt để giảm nhiễu. Sampler ParentBased(TraceIdRatio).
 */
export function startTelemetry(env: Pick<Env, 'OTEL_ENABLED' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_SERVICE_NAME' | 'OTEL_TRACES_SAMPLER_RATIO'>, serviceName = env.OTEL_SERVICE_NAME): void {
  if (!env.OTEL_ENABLED || sdk) return;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0', 'deployment.environment.name': process.env.APP_ENV ?? 'development' }),
    traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(env.OTEL_TRACES_SAMPLER_RATIO) }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Không gắn câu lệnh Redis đầy đủ (có thể chứa khoá theo email băm/nội dung cache)
        '@opentelemetry/instrumentation-ioredis': { dbStatementSerializer: (cmd: string) => cmd },
        '@opentelemetry/instrumentation-http': { ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/v1/health') || (req.url ?? '').startsWith('/v1/metrics') },
      }),
    ],
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = null;
}
