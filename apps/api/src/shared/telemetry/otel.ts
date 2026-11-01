import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import type { Env } from '../../config/env.js';

let sdk: NodeSDK | null = null;

/** Khởi động OpenTelemetry trước khi import NestJS (gọi ở đầu main.ts/worker.ts). Tắt được bằng OTEL_ENABLED=false. */
export function startTelemetry(env: Pick<Env, 'OTEL_ENABLED' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_SERVICE_NAME'>, serviceName = env.OTEL_SERVICE_NAME): void {
  if (!env.OTEL_ENABLED || sdk) return;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0' }),
    traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = null;
}
