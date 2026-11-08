import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../shared/auth/auth.guard.js';
import { ApiZod } from '../../shared/http/zod.js';
import { FeatureFlagService, PUBLIC_FLAG_KEYS } from './feature-flags.service.js';

export const publicFlagsSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
  ttl_sec: z.number().int(),
  evaluated_at: z.string(),
});

/**
 * GET /flags (v1.1 – S11): cờ công khai đã đánh giá cho người gọi (ẩn danh hoặc đăng nhập – rollout theo user/percent).
 * Chỉ boolean của PUBLIC_FLAG_KEYS; không trả rules/user_ids/config. Client cache ≤ `ttl_sec` (Cache-Control private).
 */
@ApiTags('Catalog')
@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FeatureFlagService) {}

  @Public()
  @Get()
  @ApiZod({ responses: { 200: publicFlagsSchema } })
  async list(@Req() req: FastifyRequest & { user?: { id: string } }, @Res({ passthrough: true }) reply: FastifyReply) {
    const ttl = 30;
    void reply.header('cache-control', `private, max-age=${ttl}`);
    return { flags: await this.flags.publicFlags({ userId: req.user?.id ?? null }), ttl_sec: ttl, evaluated_at: new Date().toISOString() };
  }
}

export { PUBLIC_FLAG_KEYS };
