import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../auth/auth.guard.js';
import { metrics } from '../telemetry/metrics.js';
import { Unauthorized } from './errors.js';

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * GET /v1/metrics – Prometheus scrape (ADR-0026). Ngoài hợp đồng OpenAPI (như /health).
 * Bảo vệ: `Authorization: Bearer <METRICS_TOKEN>` hoặc `X-Internal-Token` (INTERNAL_API_TOKEN); ingress chỉ mở cho mạng nội bộ.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Public()
  @Get()
  async scrape(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const expected = this.env.METRICS_TOKEN || this.env.INTERNAL_API_TOKEN;
    const auth = req.headers.authorization;
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const internal = typeof req.headers['x-internal-token'] === 'string' ? req.headers['x-internal-token'] : '';
    const ok = (bearer && safeEq(bearer, expected)) || (internal && safeEq(internal, this.env.INTERNAL_API_TOKEN));
    if (!ok) throw new Unauthorized('Invalid metrics token');
    // Đặt header chỉ khi thành công (lỗi đi qua exception filter dạng JSON)
    void reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').header('cache-control', 'no-store');
    return metrics.collectAndRender();
  }
}
