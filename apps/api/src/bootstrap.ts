import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import { AppModule } from './app.module.js';
import { loadEnv, type Env } from './config/env.js';
import { helmetOptions, registerSecurityHooks } from './shared/http/security.js';
import { rebindTraceContextHook, traceIdHook } from './shared/http/trace.middleware.js';
import { releaseTag, SentryReporter, setErrorReporter } from './shared/telemetry/error-reporter.js';
import { registerHttpMetrics, startProcessMetrics } from './shared/telemetry/instrumentation.js';
import { createRootLogger, PinoNestLogger } from './shared/telemetry/logger.js';
import { HTTP_METRICS } from './shared/telemetry/metrics.js';

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
  // application/x-www-form-urlencoded (S7): callback cổng thanh toán dạng form + trang thanh toán giả lập (dev)
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    done(null, Object.fromEntries(new URLSearchParams(text)));
  });
  // S11: báo lỗi Sentry (adapter tối giản, chỉ khi có SENTRY_DSN) + metrics process
  setErrorReporter(new SentryReporter({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, release: env.SENTRY_RELEASE || releaseTag(), service: 'allingo-api', sampleRate: env.SENTRY_SAMPLE_RATE }));
  startProcessMetrics('allingo-api', env.APP_ENV);
  fastify.addHook('onRequest', traceIdHook);
  registerHttpMetrics(fastify);
  await fastify.register(fastifyCookie, { secret: env.AUTH_SECRET });
  await fastify.register(fastifyHelmet, helmetOptions(env));
  await fastify.register(fastifyCors, { origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Client', 'Accept-Language', 'X-Internal-Token', 'X-Device-Fingerprint', 'traceparent', 'tracestate'], exposedHeaders: ['x-trace-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'] });
  // S11: giới hạn toàn cục theo IP – store Redis (dùng chung giữa replica), Redis lỗi → bỏ qua (skipOnError); health/metrics không tính
  const allow = new Set(env.RATE_LIMIT_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean));
  const rlRedis = env.RATE_LIMIT_REDIS ? new Redis(env.REDIS_URL, { connectTimeout: 1000, maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true }) : null;
  if (rlRedis) {
    rlRedis.on('error', () => undefined);
    void rlRedis.connect().catch(() => undefined);
    app.getHttpAdapter().getInstance().addHook('onClose', async () => void (await rlRedis.quit().catch(() => undefined)));
  }
  await fastify.register(fastifyRateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    ...(rlRedis ? { redis: rlRedis, nameSpace: `${env.QUEUE_PREFIX}:rlg:`, skipOnError: true } : {}),
    allowList: (req) => allow.has(req.ip) || req.url.startsWith(`/${API_PREFIX}/health`) || req.url.startsWith(`/${API_PREFIX}/metrics`),
    // Hook của plugin chạy ngoài pipeline Nest → trả đối tượng thường (Fastify gửi nguyên văn) theo envelope chuẩn (CLAUDE.md §6)
    errorResponseBuilder: (req, ctx) => {
      HTTP_METRICS.rateLimited.inc({ bucket: 'global_ip' });
      const retry = Math.max(1, Math.ceil(ctx.ttl / 1000));
      return { statusCode: 429, error: { code: 'rate_limited', message: 'Too many requests', details: { retry_after_sec: retry, scope: 'global_ip', limit: ctx.max }, trace_id: (req as typeof req & { traceId?: string }).traceId ?? null } };
    },
  });
  fastify.addHook('preHandler', rebindTraceContextHook);
  registerSecurityHooks(fastify, env);
  fastify.addHook('onResponse', (req, reply, done) => {
    if (!req.url.startsWith(`/${API_PREFIX}/health`) && !req.url.startsWith(`/${API_PREFIX}/metrics`)) logger.info({ method: req.method, route: req.routeOptions?.url ?? 'unmatched', path: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime), trace_id: (req as typeof req & { traceId?: string }).traceId }, 'request');
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
