import pino, { type Logger, type LoggerOptions } from 'pino';
import { type LoggerService } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { redactDeep, redactString } from './redact.js';
import { currentContext, currentTraceId } from './request-context.js';

/**
 * Các đường dẫn che nhanh của pino (lớp 1). Lớp 2 (S11): `formatters.log` che sâu theo tên khoá + giá trị chuỗi
 * (email/phone/JWT/Bearer/tham số bí mật) và `hooks.logMethod` che chuỗi message – xem redact.ts (CLAUDE.md §9).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'headers["x-internal-token"]',
  '*.password',
  '*.password_hash',
  '*.refresh_token',
  '*.access_token',
  '*.guest_token',
  '*.email',
  '*.phone',
  '*.otp',
  '*.text',
  '*.essay_text',
  '*.transcript',
  'body.answers',
  'body.text',
];

/** Tuỳ chọn pino dùng chung API/worker và test redaction (không transport) */
export function buildLoggerOptions(env: Pick<Env, 'LOG_LEVEL' | 'APP_ENV'>, service = 'allingo-api'): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    base: { service, env: env.APP_ENV },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // trace_id của request/job hiện hành vào mọi dòng log (tương quan Loki ↔ Tempo)
    mixin() {
      const traceId = currentTraceId();
      const ctx = currentContext();
      return traceId ? { trace_id: traceId, ...(ctx?.spanId ? { span_id: ctx.spanId } : {}) } : {};
    },
    formatters: {
      log(object) {
        return redactDeep(object);
      },
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? redactString(a) : a)) as Parameters<typeof method>;
        return method.apply(this, scrubbed);
      },
    },
  };
}

let root: Logger | null = null;

export function createRootLogger(env: Pick<Env, 'LOG_LEVEL' | 'APP_ENV'>, service = 'allingo-api'): Logger {
  if (root) return root;
  root = pino({
    ...buildLoggerOptions(env, service),
    ...(env.APP_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } } } : {}),
  });
  return root;
}

export function getLogger(bindings?: Record<string, unknown>): Logger {
  const base = root ?? createRootLogger({ LOG_LEVEL: (process.env.LOG_LEVEL as Env['LOG_LEVEL']) ?? 'info', APP_ENV: (process.env.APP_ENV as Env['APP_ENV']) ?? 'development' });
  return bindings ? base.child(bindings) : base;
}

/** Bọc pino thành LoggerService của NestJS (log hệ thống Nest đi qua pino, không console.log) */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
