import 'reflect-metadata';
import { loadEnv } from './config/env.js';
import { startTelemetry } from './shared/telemetry/otel.js';

const env = loadEnv();
startTelemetry(env, `${env.OTEL_SERVICE_NAME}-worker`);

const { NestFactory } = await import('@nestjs/core');
const { WorkerModule } = await import('./worker/worker.module.js');
const { createRootLogger, PinoNestLogger, getLogger } = await import('./shared/telemetry/logger.js');
const { SentryReporter, setErrorReporter, releaseTag } = await import('./shared/telemetry/error-reporter.js');
const { startProcessMetrics } = await import('./shared/telemetry/instrumentation.js');
// S11: báo lỗi job thất bại lần cuối (Sentry, PII đã che) + metrics process trên cổng WORKER_METRICS_PORT
setErrorReporter(new SentryReporter({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, release: env.SENTRY_RELEASE || releaseTag(), service: 'allingo-worker', sampleRate: env.SENTRY_SAMPLE_RATE }));
startProcessMetrics('allingo-worker', env.APP_ENV);

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger(createRootLogger(env, 'allingo-worker')) });
app.enableShutdownHooks();
getLogger({ component: 'worker' }).info({ env: env.APP_ENV }, 'Allingo worker running');
