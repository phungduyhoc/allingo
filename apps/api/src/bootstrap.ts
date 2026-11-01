import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module.js';
import { loadEnv, type Env } from './config/env.js';
import { traceIdHook } from './shared/http/trace.middleware.js';
import { createRootLogger, PinoNestLogger } from './shared/telemetry/logger.js';

export const API_PREFIX = 'v1';

/** Tạo ứng dụng NestJS trên Fastify với cookie/cors/helmet/rate-limit/trace_id. Dùng cho main.ts, test và export OpenAPI. */
export async function createApp(env: Env = loadEnv()): Promise<NestFastifyApplication> {
  const logger = createRootLogger(env);
  const adapter = new FastifyAdapter({ trustProxy: env.TRUST_PROXY, bodyLimit: env.BODY_LIMIT_BYTES, logger: false, disableRequestLogging: true });
  // bodyParser: false → tự đăng ký parser JSON chấp nhận body rỗng (bên dưới)
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: new PinoNestLogger(logger), bufferLogs: false, bodyParser: false });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  // Chấp nhận body rỗng với Content-Type: application/json (POST không payload như /auth/guest, /submit, /logout)
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim().length === 0) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });
  await fastify.register(fastifyCookie, { secret: env.AUTH_SECRET });
  await fastify.register(fastifyHelmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await fastify.register(fastifyCors, { origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Client', 'Accept-Language', 'X-Internal-Token'], exposedHeaders: ['x-trace-id'] });
  await fastify.register(fastifyRateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute', allowList: ['127.0.0.1'] });
  fastify.addHook('onRequest', traceIdHook);
  fastify.addHook('onResponse', (req, reply, done) => {
    if (!req.url.startsWith(`/${API_PREFIX}/health`)) logger.info({ method: req.method, url: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime), trace_id: (req as typeof req & { traceId?: string }).traceId }, 'request');
    done();
  });
  return app;
}

export function buildOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Allingo API')
    .setDescription('Allingo – Ngoại ngữ cho tất cả. Hợp đồng v1 (xuất từ NestJS; nguồn sự thật: docs/spec/allingo-openapi.yaml).')
    .setVersion('1.0.0')
    .addServer('https://api.allingo.vn/v1', 'Production')
    .addServer('https://api.stg.allingo.vn/v1', 'Staging')
    .addServer(`http://localhost:4000/${API_PREFIX}`, 'Local')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
    .addCookieAuth('allingo_at', { type: 'apiKey', in: 'cookie', name: 'allingo_at' }, 'cookieAuth')
    .build();
  return SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true });
}
