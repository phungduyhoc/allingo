import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { getErrorReporter } from '../telemetry/error-reporter.js';
import { getLogger } from '../telemetry/logger.js';
import { OPS_METRICS } from '../telemetry/metrics.js';
import { AppError } from './errors.js';

interface Envelope {
  error: { code: string; message: string; details?: Record<string, unknown>; trace_id?: string };
}

/** Mọi lỗi → envelope chuẩn + trace_id; lỗi 5xx được log đầy đủ (không PII) */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = getLogger({ component: 'http' });

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest & { traceId?: string }>();
    const traceId = request.traceId ?? request.id?.toString();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Envelope = { error: { code: 'internal', message: 'Internal server error', trace_id: traceId } };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = { error: { code: exception.code, message: exception.message, details: exception.details, trace_id: traceId } };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = { error: { code: 'validation_failed', message: 'Validation failed', details: { issues: exception.issues }, trace_id: traceId } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      const code =
        status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 429 ? 'rate_limited' : status === 400 ? 'validation_failed' : 'internal';
      body = { error: { code, message: Array.isArray(message) ? message.join('; ') : String(message), trace_id: traceId } };
    } else if (isFastifyError(exception)) {
      status = exception.statusCode ?? 500;
      const code = status === 429 ? 'rate_limited' : status === 413 ? 'validation_failed' : status === 400 ? 'validation_failed' : 'internal';
      body = { error: { code, message: status >= 500 ? 'Internal server error' : exception.message, trace_id: traceId } };
    }

    if (status >= 500 && !(exception instanceof AppError)) {
      this.logger.error({ err: exception, trace_id: traceId, method: request.method, route: request.routeOptions?.url ?? 'unmatched' }, 'unhandled error');
      // S11: báo lỗi Sentry (đã che PII) – chỉ lỗi không chủ đích (AppError 503 feature_disabled… không phải sự cố)
      if (getErrorReporter().enabled) {
        OPS_METRICS.errorsReported.inc({ source: 'http' });
        getErrorReporter().capture(exception, { request: { method: request.method, route: request.routeOptions?.url ?? 'unmatched', status } });
      }
    } else if (status >= 400 && status !== 404) {
      this.logger.debug({ trace_id: traceId, method: request.method, route: request.routeOptions?.url ?? 'unmatched', status, code: body.error.code }, 'request error');
    }
    const retry = body.error.details?.retry_after_sec;
    if ((status === 429 || status === 503) && typeof retry === 'number') void reply.header('retry-after', String(retry));
    void reply.status(status).header('x-trace-id', traceId ?? '').send(body);
  }
}

function isFastifyError(e: unknown): e is { statusCode?: number; message: string } {
  return !!e && typeof e === 'object' && 'statusCode' in e && 'message' in e;
}
