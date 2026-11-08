import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { AuditService } from '../events/audit.service.js';
import { Forbidden, MfaRequired, Unauthorized } from '../http/errors.js';
import { getLogger } from '../telemetry/logger.js';
import { JwtService, type AccessClaims } from './jwt.service.js';
import { SessionRevocationService } from './session-revocation.service.js';

export const ACCESS_COOKIE = 'allingo_at';
export const REFRESH_COOKIE = 'allingo_rt';
export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Endpoint không cần đăng nhập */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Yêu cầu một trong các vai trò */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
/**
 * S12: endpoint không bị beta gate chặn khi `ff.growth.beta_gate` bật (đăng nhập, hồ sơ tối thiểu, đồng ý, xoá dữ liệu, đổi mã,
 * hỗ trợ…). Endpoint `@Public()` không bao giờ bị chặn. Guard ở growth (BetaGateGuard) đọc metadata này.
 */
export const BETA_EXEMPT = 'betaExempt';
export const BetaExempt = () => SetMetadata(BETA_EXEMPT, true);
/** S12: endpoint đăng ký/xác minh MFA – không đòi phiên đã step-up dù có @Roles */
export const MFA_EXEMPT = 'mfaExempt';
export const MfaExempt = () => SetMetadata(MFA_EXEMPT, true);

/** Vai trò phải xác minh TOTP (step-up) trước khi gọi endpoint có @Roles (S12 – pentest-1 việc mở) */
export const MFA_ROLES = ['admin', 'superadmin'] as const;

export interface AuthUser {
  id: string;
  sessionId: string;
  roles: string[];
  isGuest: boolean;
  /** S12: phiên đã xác minh TOTP */
  mfa?: boolean;
  /** S12: token impersonate chỉ đọc – id admin thực hiện */
  impersonatedBy?: string;
}

/** ADMIN_MFA_REQUIRED=auto → bắt buộc ở staging/production; true/false ép buộc (dev/test mặc định tắt – test riêng bật) */
export function adminMfaRequired(env: Pick<Env, 'ADMIN_MFA_REQUIRED' | 'APP_ENV'>): boolean {
  if (env.ADMIN_MFA_REQUIRED === 'true') return true;
  if (env.ADMIN_MFA_REQUIRED === 'false') return false;
  return env.APP_ENV === 'staging' || env.APP_ENV === 'production';
}

/** Phương thức an toàn (không ghi) cho token impersonate */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** So sánh hằng thời gian (băm SHA-256 hai phía để độ dài bằng nhau) – S12 / pentest F9 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
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

/**
 * Guard toàn cục: cookie httpOnly (web) hoặc Bearer (mobile) → req.user; @Public() bỏ qua; @Roles() kiểm tra vai trò.
 * S12: (1) token impersonate (`scope = read_only`) chỉ GET/HEAD, cấm /admin/*, mọi request ghi audit `impersonation.request`;
 * (2) admin/superadmin gọi endpoint có @Roles phải có phiên đã xác minh TOTP (claim `mfa`) khi adminMfaRequired → 403 `mfa_required`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = getLogger({ component: 'auth.guard' });
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly revocation: SessionRevocationService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = extractToken(req);
    let claims: AccessClaims | null = null;
    if (token) claims = await this.jwt.verifyAccess(token);
    // Phiên đã thu hồi (logout/thu hồi từ xa/refresh reuse/xoá tài khoản/khoá tài khoản) → coi như chưa đăng nhập
    if (claims && (await this.revocation.isRevoked(claims.sid))) claims = null;
    if (claims) req.user = { id: claims.sub, sessionId: claims.sid, roles: claims.roles ?? [], isGuest: !!claims.guest, mfa: claims.mfa === true, ...(claims.scope === 'read_only' && claims.imp ? { impersonatedBy: claims.imp } : {}) };
    if (req.user?.impersonatedBy) await this.enforceImpersonation(req);
    if (isPublic) return true;
    if (!req.user) throw new Unauthorized();
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.some((r) => req.user!.roles.includes(r)) && !req.user.roles.includes('superadmin')) {
      throw new Forbidden('Insufficient role', { required: roles });
    }
    if (roles?.length && adminMfaRequired(this.env) && !req.user.mfa && req.user.roles.some((r) => (MFA_ROLES as readonly string[]).includes(r))) {
      const exempt = this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT, [ctx.getHandler(), ctx.getClass()]);
      if (!exempt) throw new MfaRequired({ reason: 'step_up_required' });
    }
    return true;
  }

  /** Token impersonate: chỉ đọc + không vào /admin; audit mỗi request (trước khi chạy handler – kể cả khi bị chặn) */
  private async enforceImpersonation(req: AuthedRequest): Promise<void> {
    const user = req.user!;
    const route = (req as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url ?? req.url.split('?')[0] ?? '';
    const blocked = !READ_ONLY_METHODS.has(req.method) ? 'impersonation_read_only' : /^\/v1\/admin(\/|$)/.test(route) ? 'impersonation_admin_forbidden' : null;
    try {
      await this.audit.log({ action: 'impersonation.request', actorUserId: user.impersonatedBy ?? null, actorRole: 'admin', entityType: 'user', entityId: user.id, after: { impersonation_id: user.sessionId, method: req.method, route, blocked }, ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
    } catch (err) {
      // Không ghi được audit → không cho đi tiếp (fail-closed)
      this.logger.error({ err: (err as Error).message }, 'impersonation audit failed');
      throw new Forbidden('Impersonation audit unavailable', { reason: 'impersonation_audit_failed' });
    }
    if (blocked) throw new Forbidden('Impersonation token is read-only', { reason: blocked });
  }
}

/** Guard cho API nội bộ (CMS → API): header X-Internal-Token */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly expected: string) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = req.headers['x-internal-token'];
    // S12 (pentest F9): so sánh hằng thời gian
    if (typeof token !== 'string' || token.length === 0 || !constantTimeEquals(token, this.expected)) throw new Unauthorized('Invalid internal token');
    return true;
  }
}
