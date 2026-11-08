import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { mfaCodeInputSchema, mfaEnrollResultSchema, mfaStatusSchema, mfaVerifyInputSchema } from '@allingo/schemas';
import { ACCESS_COOKIE, BetaExempt, CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { RateLimit } from '../../../shared/http/rate-limit.js';
import { ApiZod, ZodBody } from '../../../shared/http/zod.js';
import { AuthService } from '../auth.service.js';
import { MfaService } from './mfa.service.js';

const tokensSchema = z.object({ access_token: z.string(), expires_in: z.number().int(), mfa: z.literal(true) });

/** MFA TOTP (S12): trạng thái, đăng ký, xác nhận (mã khôi phục), step-up phiên, tạo lại mã khôi phục */
@ApiTags('Auth')
@Controller()
@BetaExempt()
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
  ) {}

  private setAccessCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(ACCESS_COOKIE, token, this.auth.cookieOptions('access'));
  }

  @Get('me/mfa')
  @ApiZod({ responses: { 200: mfaStatusSchema } })
  status(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user);
  }

  @Post('auth/mfa/totp/enroll')
  @HttpCode(200)
  @ApiZod({ responses: { 200: mfaEnrollResultSchema, 409: 'empty' } })
  enroll(@CurrentUser() user: AuthUser) {
    return this.mfa.enroll(user);
  }

  @Post('auth/mfa/totp/confirm')
  @HttpCode(200)
  @RateLimit('mfa')
  @ApiZod({ body: mfaCodeInputSchema, responses: { 200: tokensSchema.extend({ recovery_codes: z.array(z.string()) }), 400: 'empty', 409: 'empty', 429: 'empty' } })
  async confirm(@CurrentUser() user: AuthUser, @ZodBody(mfaCodeInputSchema) body: z.infer<typeof mfaCodeInputSchema>, @Res({ passthrough: true }) reply: FastifyReply) {
    const out = await this.mfa.confirm(user, body.code);
    this.setAccessCookie(reply, out.access_token);
    return out;
  }

  @Post('auth/mfa/verify')
  @HttpCode(200)
  @RateLimit('mfa')
  @ApiZod({ body: mfaVerifyInputSchema, responses: { 200: tokensSchema, 400: 'empty', 409: 'empty', 429: 'empty' } })
  async verify(@CurrentUser() user: AuthUser, @ZodBody(mfaVerifyInputSchema) body: z.infer<typeof mfaVerifyInputSchema>, @Res({ passthrough: true }) reply: FastifyReply) {
    const out = await this.mfa.verify(user, body);
    this.setAccessCookie(reply, out.access_token);
    return out;
  }

  @Post('auth/mfa/recovery-codes')
  @HttpCode(200)
  @RateLimit('mfa')
  @ApiZod({ body: mfaCodeInputSchema, responses: { 200: z.object({ recovery_codes: z.array(z.string()) }), 400: 'empty', 409: 'empty' } })
  regenerate(@CurrentUser() user: AuthUser, @ZodBody(mfaCodeInputSchema) body: z.infer<typeof mfaCodeInputSchema>) {
    return this.mfa.regenerateRecoveryCodes(user, body.code);
  }
}
