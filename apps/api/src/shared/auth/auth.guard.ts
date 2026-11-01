import { CanActivate, type ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Forbidden, Unauthorized } from '../http/errors.js';
import { JwtService, type AccessClaims } from './jwt.service.js';

export const ACCESS_COOKIE = 'allingo_at';
export const REFRESH_COOKIE = 'allingo_rt';
export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Endpoint không cần đăng nhập */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Yêu cầu một trong các vai trò */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  sessionId: string;
  roles: string[];
  isGuest: boolean;
}

export type AuthedRequest = FastifyRequest & { user?: AuthUser; traceId?: string };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Unauthorized();
  return req.user;
});

export function extractToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
  return cookies?.[ACCESS_COOKIE] ?? null;
}

/** Guard toàn cục: cookie httpOnly (web) hoặc Bearer (mobile) → req.user; @Public() bỏ qua; @Roles() kiểm tra vai trò */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = extractToken(req);
    let claims: AccessClaims | null = null;
    if (token) claims = await this.jwt.verifyAccess(token);
    if (claims) req.user = { id: claims.sub, sessionId: claims.sid, roles: claims.roles ?? [], isGuest: !!claims.guest };
    if (isPublic) return true;
    if (!req.user) throw new Unauthorized();
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.some((r) => req.user!.roles.includes(r)) && !req.user.roles.includes('superadmin')) {
      throw new Forbidden('Insufficient role', { required: roles });
    }
    return true;
  }
}

/** Guard cho API nội bộ (CMS → API): header X-Internal-Token */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly expected: string) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = req.headers['x-internal-token'];
    if (typeof token !== 'string' || token.length === 0 || token !== this.expected) throw new Unauthorized('Invalid internal token');
    return true;
  }
}
