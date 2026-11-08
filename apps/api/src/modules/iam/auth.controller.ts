import { createHash } from 'node:crypto';
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OAUTH_PROVIDERS, authTokensSchema, guestSessionSchema, loginInputSchema, oauthInputSchema, otpRequestInputSchema, otpRequestResultSchema, otpVerifyInputSchema, refreshInputSchema, registerInputSchema, type LoginInput, type OAuthInput, type OtpRequestInput, type OtpVerifyInput, type RegisterInput } from '@allingo/schemas';
import { ACCESS_COOKIE, BetaExempt, CurrentUser, Public, REFRESH_COOKIE, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodValidationPipe } from '../../shared/http/zod.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { OAuthService } from './oauth/oauth.service.js';
import type { IssuedTokens } from './sessions.service.js';
import { RateLimit } from '../../shared/http/rate-limit.js';

const providerParam = z.object({ provider: z.enum(OAUTH_PROVIDERS) });

type Req = FastifyRequest & { cookies?: Record<string, string | undefined> };

@ApiTags('Auth')
@Controller('auth')
@BetaExempt()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
  ) {}

  /** S8: header `X-Device-Fingerprint` (client tự sinh, ≤ 256 ký tự) → chỉ lưu sha256 (`device.fp`) – chống lạm dụng referral */
  private meta(req: FastifyRequest, device?: Record<string, unknown>): RequestMeta {
    const raw = req.headers['x-device-fingerprint'];
    const fp = typeof raw === 'string' && raw.length >= 8 && raw.length <= 256 ? createHash('sha256').update(raw).digest('hex').slice(0, 32) : undefined;
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, device: fp ? { ...(device ?? {}), fp } : device };
  }

  /** Đặt cookie httpOnly (web); mobile đọc body (access_token + refresh_token khi X-Client: mobile) */
  private setCookies(reply: FastifyReply, tokens: IssuedTokens) {
    void reply.setCookie(ACCESS_COOKIE, tokens.accessToken, this.auth.cookieOptions('access'));
    void reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, this.auth.cookieOptions('refresh'));
  }

  private isMobile(req: FastifyRequest): boolean {
    return req.headers['x-client'] === 'mobile';
  }

  @Public()
  @Post('register')
  @RateLimit('register_ip')
  @HttpCode(201)
  @ApiZod({ body: registerInputSchema, responses: { 201: authTokensSchema, 409: 'empty' } })
  async register(@Body(new ZodValidationPipe(registerInputSchema)) body: RegisterInput, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { tokens, body: out } = await this.auth.register(body, this.meta(req));
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...out, refresh_token: tokens.refreshToken } : out;
  }

  @Public()
  @Post('login')
  @RateLimit('login_ip')
  @HttpCode(200)
  @ApiZod({ body: loginInputSchema, responses: { 200: authTokensSchema, 401: 'empty' } })
  async login(@Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { tokens, body: out } = await this.auth.login(body, this.meta(req));
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...out, refresh_token: tokens.refreshToken } : out;
  }

  @Public()
  @Post('guest')
  @HttpCode(201)
  @ApiZod({ responses: { 201: guestSessionSchema } })
  async guest(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const locale = (req.headers['accept-language'] ?? '').toString().startsWith('en') ? 'en' : 'vi';
    const { tokens, body } = await this.auth.guest(this.meta(req), locale);
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...body, refresh_token: tokens.refreshToken } : body;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiZod({ body: refreshInputSchema, responses: { 200: authTokensSchema } })
  async refresh(@ZodBody(refreshInputSchema) body: { refresh_token?: string }, @Req() req: Req, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = body.refresh_token ?? req.cookies?.[REFRESH_COOKIE];
    const { tokens, body: out } = await this.auth.refresh(token);
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...out, refresh_token: tokens.refreshToken } : out;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiZod({ responses: { 204: 'empty' } })
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(user.sessionId, user.id);
    void reply.clearCookie(ACCESS_COOKIE, { path: '/' });
    void reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }

  @Public()
  @Post('oauth/:provider')
  @HttpCode(200)
  @ApiZod({ body: oauthInputSchema, responses: { 200: authTokensSchema, 401: 'empty', 409: 'empty' } })
  async oauthSignIn(@ZodParams(providerParam) params: z.infer<typeof providerParam>, @ZodBody(oauthInputSchema) body: OAuthInput, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { tokens, body: out } = await this.oauth.signIn(params.provider, body, this.meta(req));
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...out, refresh_token: tokens.refreshToken } : out;
  }

  @Public()
  @Post('otp/request')
  @RateLimit('otp_ip')
  @HttpCode(202)
  @ApiZod({ body: otpRequestInputSchema, responses: { 202: otpRequestResultSchema, 429: 'empty' } })
  otpRequest(@ZodBody(otpRequestInputSchema) body: OtpRequestInput, @Req() req: FastifyRequest) {
    const locale = (req.headers['accept-language'] ?? '').toString().startsWith('en') ? 'en' : 'vi';
    return this.auth.otpRequest(body, this.meta(req), locale);
  }

  @Public()
  @Post('otp/verify')
  @RateLimit('otp_ip')
  @HttpCode(200)
  @ApiZod({ body: otpVerifyInputSchema, responses: { 200: authTokensSchema, 401: 'empty', 429: 'empty' } })
  async otpVerify(@ZodBody(otpVerifyInputSchema) body: OtpVerifyInput, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { tokens, body: out } = await this.auth.otpVerify(body, this.meta(req));
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...out, refresh_token: tokens.refreshToken } : out;
  }
}
