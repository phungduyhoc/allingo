import pino, { type Logger } from 'pino';
import { type LoggerService } from '@nestjs/common';
import type { Env } from '../../config/env.js';

/** Các khoá bị che trong log (CLAUDE.md §9: không email/phone/token/nội dung bài làm) */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
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

let root: Logger | null = null;

export function createRootLogger(env: Pick<Env, 'LOG_LEVEL' | 'APP_ENV'>): Logger {
  if (root) return root;
  root = pino({
    level: env.LOG_LEVEL,
    base: { service: 'allingo-api', env: env.APP_ENV },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
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
