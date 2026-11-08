import { CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { FeatureDisabled } from '../../shared/http/errors.js';
import { FeatureFlagService } from './feature-flags.service.js';

export const KILL_SWITCH_KEY = 'killSwitchFlag';
/**
 * Kill-switch (S11): handler chỉ chạy khi cờ bật cho người gọi; tắt → 503 `feature_disabled`
 * `{ details: { flag, message_key: 'errors.feature_disabled', retry_after_sec: 60 } }` + `Retry-After`. Đánh giá sau AuthGuard
 * (rollout theo user/percent) và trước token bucket (không tốn lượt). Hiệu lực theo FeatureFlagService (< 60 s).
 */
export const KillSwitch = (flag: string) => SetMetadata(KILL_SWITCH_KEY, flag);

@Injectable()
export class KillSwitchGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const flag = this.reflector.getAllAndOverride<string | undefined>(KILL_SWITCH_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!flag) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: { id: string } }>();
    if (!(await this.flags.isEnabled(flag, { userId: req.user?.id ?? null }))) throw new FeatureDisabled(flag);
    return true;
  }
}
