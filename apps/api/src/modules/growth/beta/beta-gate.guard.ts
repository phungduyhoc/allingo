import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BETA_EXEMPT, IS_PUBLIC, type AuthedRequest } from '../../../shared/auth/auth.guard.js';
import { BetaRequired } from '../../../shared/http/errors.js';
import { BetaService } from './beta.service.js';

/**
 * Beta gate toàn cục (S12): chạy sau AuthGuard. Khi `ff.growth.beta_gate` bật, người dùng đăng nhập chưa có quyền beta gọi
 * endpoint app → 403 `beta_required`. Không chặn: endpoint @Public (landing/catalog công khai/flags/waitlist/webhook/internal),
 * endpoint @BetaExempt (auth, GET|PATCH|DELETE /me, sessions, consents, MFA, đổi mã, hỗ trợ), vai trò nội bộ + beta_tester,
 * allowlist `rules.user_ids`. Cờ đọc qua FeatureFlagService (cache 3 tầng, đổi có hiệu lực < 60 s).
 */
@Injectable()
export class BetaGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly beta: BetaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(BETA_EXEMPT, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) return true; // AuthGuard đã từ chối nếu cần đăng nhập
    const a = await this.beta.access(req.user);
    if (!a.allowed) throw new BetaRequired();
    return true;
  }
}
