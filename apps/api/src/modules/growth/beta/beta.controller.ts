import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { betaRedeemInputSchema, betaRedeemResultSchema, betaStatusSchema, waitlistInputSchema, waitlistResultSchema, type WaitlistInput } from '@allingo/schemas';
import { BetaExempt, CurrentUser, Public, type AuthedRequest, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { RateLimit } from '../../../shared/http/rate-limit.js';
import { ApiZod, ZodBody } from '../../../shared/http/zod.js';
import { BetaService } from './beta.service.js';

/** Beta kín (S12): đăng ký chờ (công khai), trạng thái beta, đổi mã mời */
@ApiTags('Growth')
@Controller()
export class BetaController {
  constructor(private readonly beta: BetaService) {}

  @Public()
  @Post('waitlist')
  @HttpCode(202)
  @RateLimit('waitlist_ip')
  @ApiZod({ body: waitlistInputSchema, responses: { 202: waitlistResultSchema, 429: 'empty' } })
  join(@ZodBody(waitlistInputSchema) body: WaitlistInput, @Req() req: FastifyRequest) {
    return this.beta.joinWaitlist(body, { ip: req.ip ?? null });
  }

  @Public()
  @Get('beta/status')
  @ApiZod({ responses: { 200: betaStatusSchema } })
  status(@Req() req: AuthedRequest) {
    return this.beta.status(req.user);
  }

  @BetaExempt()
  @Post('beta/redeem')
  @HttpCode(200)
  @RateLimit('beta_redeem')
  @ApiZod({ body: betaRedeemInputSchema, responses: { 200: betaRedeemResultSchema, 400: 'empty', 403: 'empty', 409: 'empty', 429: 'empty' } })
  redeem(@CurrentUser() user: AuthUser, @ZodBody(betaRedeemInputSchema) body: z.infer<typeof betaRedeemInputSchema>, @Req() req: FastifyRequest) {
    return this.beta.redeem(user, body.code, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
  }
}
