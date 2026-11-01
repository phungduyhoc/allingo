import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authTokensSchema, guestSessionSchema, loginInputSchema, otpRequestInputSchema, otpVerifyInputSchema, refreshInputSchema, registerInputSchema, type LoginInput, type RegisterInput } from '@allingo/schemas';
import { ACCESS_COOKIE, CurrentUser, Public, REFRESH_COOKIE, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodValidationPipe } from '../../shared/http/zod.js';
import { AppError } from '../../shared/http/errors.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import type { IssuedTokens } from './sessions.service.js';

type Req = FastifyRequest & { cookies?: Record<string, string | undefined> };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(req: FastifyRequest, device?: Record<string, unknown>): RequestMeta {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, device };
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
  @HttpCode(201)
  @ApiZod({ body: registerInputSchema, responses: { 201: authTokensSchema, 409: 'empty' } })
  async register(@Body(new ZodValidationPipe(registerInputSchema)) body: RegisterInput, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { tokens, body: out } = await this.auth.register(body, this.meta(req));
    this.setCookies(reply, tokens);
    return this.isMobile(req) ? { ...out, refresh_token: tokens.refreshToken } : out;
  }

  @Public()
  @Post('login')
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

  // OTP qua Zalo/SMS: Sprint 1 (S1). Endpoint có mặt để khớp hợp đồng, trả 501 rõ ràng.
  @Public()
  @Post('otp/request')
  @HttpCode(202)
  @ApiZod({ body: otpRequestInputSchema, responses: { 202: 'empty', 429: 'empty' } })
  otpRequest(@ZodBody(otpRequestInputSchema) _body: unknown) {
    throw new AppError('feature_disabled', 'OTP login is not available yet (Sprint 1)', 501, { flag: 'ff.iam.otp' });
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @ApiZod({ body: otpVerifyInputSchema, responses: { 200: authTokensSchema } })
  otpVerify(@ZodBody(otpVerifyInputSchema) _body: unknown) {
    throw new AppError('feature_disabled', 'OTP login is not available yet (Sprint 1)', 501, { flag: 'ff.iam.otp' });
  }
}
