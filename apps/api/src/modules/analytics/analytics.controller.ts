import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { funnelEventInputSchema, funnelEventResultSchema, programCodeSchema, statsSchema, type FunnelEventInput } from '@allingo/schemas';
import { CurrentUser, Public, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodQuery } from '../../shared/http/zod.js';
import { FunnelService } from './funnel/funnel.service.js';
import { StatsService } from './stats.service.js';

const programQuery = z.object({ program: programCodeSchema.default('toeic') });

/** GET /me/stats (S10 – đọc replica, cache 1 giờ) và POST /analytics/events (sự kiện phễu client có đồng ý cookie) */
@Controller()
export class AnalyticsController {
  constructor(
    private readonly stats: StatsService,
    private readonly funnel: FunnelService,
  ) {}

  @ApiTags('Learning')
  @Get('me/stats')
  @ApiZod({ query: programQuery, responses: { 200: statsSchema } })
  getStats(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.stats.stats(user.id, q.program);
  }

  @ApiTags('Growth')
  @Public()
  @Post('analytics/events')
  @HttpCode(202)
  @ApiZod({ body: funnelEventInputSchema, responses: { 202: funnelEventResultSchema, 400: 'empty' } })
  event(@ZodBody(funnelEventInputSchema) body: FunnelEventInput, @Req() req: FastifyRequest & { user?: AuthUser }) {
    // Có token hợp lệ → AuthGuard đã gắn req.user (route công khai vẫn đọc token)
    return this.funnel.clientEvent(body, req.user && !req.user.isGuest ? req.user.id : null, req.ip ?? null);
  }
}
