import { loadEnv } from './config/env.js';
import { startTelemetry } from './shared/telemetry/otel.js';

const env = loadEnv();
startTelemetry(env);

const { createApp, buildOpenApiDocument } = await import('./bootstrap.js');
const { SwaggerModule } = await import('@nestjs/swagger');
const { getLogger } = await import('./shared/telemetry/logger.js');

const app = await createApp(env);
if (env.APP_ENV !== 'production') {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), { jsonDocumentUrl: 'docs/openapi.json' });
}
await app.listen({ port: env.API_PORT, host: env.API_HOST });
getLogger({ component: 'main' }).info({ port: env.API_PORT, env: env.APP_ENV, ai: env.AI_PROVIDER }, `Allingo API listening on http://localhost:${env.API_PORT}/v1 (docs: /docs)`);
