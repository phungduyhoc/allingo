import 'reflect-metadata';
import { loadEnv } from './config/env.js';
import { startTelemetry } from './shared/telemetry/otel.js';

const env = loadEnv();
startTelemetry(env, `${env.OTEL_SERVICE_NAME}-worker`);

const { NestFactory } = await import('@nestjs/core');
const { WorkerModule } = await import('./worker/worker.module.js');
const { createRootLogger, PinoNestLogger, getLogger } = await import('./shared/telemetry/logger.js');

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger(createRootLogger(env)) });
app.enableShutdownHooks();
getLogger({ component: 'worker' }).info({ env: env.APP_ENV }, 'Allingo worker running');
