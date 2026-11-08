import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { RateLimited } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';

/**
 * Chống dò mật khẩu & enumerate tài khoản (S11 – ASVS V2.2, V3):
 *  - Khoá đăng nhập theo email (sha256, không PII trong khoá Redis): LOGIN_MAX_FAILURES lần sai trong
 *    LOGIN_FAILURE_WINDOW_MINUTES → khoá LOGIN_LOCK_MINUTES (429 `rate_limited`, `details.reason = 'login_locked'`).
 *    Áp như nhau cho email KHÔNG tồn tại (không lộ tồn tại qua hành vi khoá); audit `auth.login_locked` chỉ khi có user.
 *  - Đăng nhập thành công → xoá bộ đếm. Redis mất → bỏ qua (bucket theo IP ở edge/WAF vẫn chặn).
 */
@Injectable()
export class LoginProtectionService {
  private readonly logger = getLogger({ component: 'login-protection' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private subject(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  }
  private failKey(s: string) {
    return `${this.env.QUEUE_PREFIX}:login:fail:${s}`;
  }
  private lockKey(s: string) {
    return `${this.env.QUEUE_PREFIX}:login:lock:${s}`;
  }

  async assertNotLocked(email: string): Promise<void> {
    const ttl = await this.redis.safe((r) => r.pttl(this.lockKey(this.subject(email))));
    if (ttl !== null && ttl > 0) throw new RateLimited(Math.ceil(ttl / 1000), { reason: 'login_locked' });
  }

  async recordFailure(email: string, userId: string | null, meta: { ip?: string | null; userAgent?: string | null }): Promise<void> {
    const s = this.subject(email);
    const n = await this.redis.safe(async (r) => {
      const [[, count]] = (await r.multi().incr(this.failKey(s)).pexpire(this.failKey(s), this.env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000, 'NX').exec()) as [[unknown, number]];
      return count;
    });
    if (n === null || n < this.env.LOGIN_MAX_FAILURES) return;
    await this.redis.safe((r) => r.multi().set(this.lockKey(s), '1', 'PX', this.env.LOGIN_LOCK_MINUTES * 60_000).del(this.failKey(s)).exec());
    this.logger.warn({ failures: n }, 'login locked after repeated failures');
    if (userId) {
      await this.audit
        .log({ action: 'auth.login_locked', actorUserId: null, entityType: 'user', entityId: userId, after: { failures: n, lock_minutes: this.env.LOGIN_LOCK_MINUTES }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null })
        .catch((err: Error) => this.logger.error({ err: err.message }, 'audit failed'));
    }
  }

  async recordSuccess(email: string): Promise<void> {
    await this.redis.safe((r) => r.del(this.failKey(this.subject(email))));
  }

  /** Mở khoá (admin/test) */
  async unlock(email: string): Promise<void> {
    const s = this.subject(email);
    await this.redis.safe((r) => r.del(this.failKey(s), this.lockKey(s)));
  }
}

/**
 * Thời gian phản hồi tối thiểu (S11 – chống enumerate theo thời gian ở login/register/otp): chờ tới `minMs` + jitter ≤ 10 %
 * dù thành công hay lỗi; vượt quá thì trả ngay. `minMs = 0` → tắt.
 */
export async function withMinDuration<T>(minMs: number, fn: () => Promise<T>): Promise<T> {
  if (minMs <= 0) return fn();
  const started = performance.now();
  const target = minMs + randomInt(0, Math.max(1, Math.round(minMs / 10)));
  const pad = async () => {
    const left = target - (performance.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  };
  try {
    const out = await fn();
    await pad();
    return out;
  } catch (err) {
    await pad();
    throw err;
  }
}
