import { createHash } from 'node:crypto';
import { CanActivate, type ExecutionContext, Global, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../cache/redis.module.js';
import { getLogger } from '../telemetry/logger.js';
import { HTTP_METRICS } from '../telemetry/metrics.js';
import { RateLimited } from './errors.js';

/**
 * Token bucket theo người dùng/IP cho endpoint đắt (S11 – bổ sung giới hạn toàn cục @fastify/rate-limit theo IP).
 * Trạng thái ở Redis (Lua nguyên tử, đồng hồ = Redis TIME → nhất quán giữa replica). Redis mất → cho qua (fail-open, có log
 * + metric) vì quota/credit/khoá OTP vẫn chặn ở DB/Redis riêng. Header: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
 * `Retry-After` (khi 429) – cùng tên với giới hạn toàn cục (OpenAPI info.description).
 */
export interface BucketConfig {
  /** Số token tối đa (burst) */
  capacity: number;
  /** Số token nạp lại mỗi `perSeconds` giây */
  refill: number;
  perSeconds: number;
  /** Khoá theo: user (đã đăng nhập; khách/ẩn danh → IP), ip, identifier (email/phone trong body, băm) */
  by: 'user' | 'ip' | 'identifier';
}

/** Bucket mặc định (nhân với RATE_LIMIT_BUCKET_MULTIPLIER) – xem docs/slo.md §Giới hạn tốc độ */
export const RATE_BUCKETS = {
  explain: { capacity: 20, refill: 20, perSeconds: 60, by: 'user' },
  tutor: { capacity: 20, refill: 20, perSeconds: 60, by: 'user' },
  dictionary_ai: { capacity: 30, refill: 30, perSeconds: 60, by: 'user' },
  submit: { capacity: 10, refill: 10, perSeconds: 60, by: 'user' },
  orders: { capacity: 10, refill: 10, perSeconds: 600, by: 'user' },
  pay: { capacity: 10, refill: 10, perSeconds: 600, by: 'user' },
  // IP: đủ rộng cho lớp học sau NAT (B2B, ~40–60 học sinh cùng IP); dò mật khẩu một tài khoản do khoá theo email chặn
  // (LoginProtectionService), giới hạn theo định danh OTP do OtpService chặn (3 yêu cầu/15′, 5 lần sai khoá 30′)
  otp_ip: { capacity: 30, refill: 30, perSeconds: 900, by: 'ip' },
  login_ip: { capacity: 100, refill: 100, perSeconds: 300, by: 'ip' },
  register_ip: { capacity: 60, refill: 60, perSeconds: 3600, by: 'ip' },
  webhook_ip: { capacity: 120, refill: 120, perSeconds: 60, by: 'ip' },
  uploads: { capacity: 30, refill: 30, perSeconds: 600, by: 'user' },
  // S12 – beta & phản hồi: đăng ký chờ theo IP (công khai), đổi mã mời (chống dò mã), góp ý/báo lỗi/ticket, MFA
  waitlist_ip: { capacity: 20, refill: 20, perSeconds: 3600, by: 'ip' },
  beta_redeem: { capacity: 10, refill: 10, perSeconds: 600, by: 'user' },
  feedback: { capacity: 10, refill: 10, perSeconds: 600, by: 'user' },
  support: { capacity: 10, refill: 10, perSeconds: 3600, by: 'user' },
  mfa: { capacity: 10, refill: 10, perSeconds: 600, by: 'user' },
} as const satisfies Record<string, BucketConfig>;
export type BucketName = keyof typeof RATE_BUCKETS;

export const RATE_LIMIT_KEY = 'rateLimitBuckets';
/** Gắn một hoặc nhiều bucket cho handler (mọi bucket phải còn token) */
export const RateLimit = (...buckets: BucketName[]) => SetMetadata(RATE_LIMIT_KEY, buckets);

export interface BucketState {
  tokens: number;
  ts: number;
}

/** Bước token bucket thuần (cùng thuật toán với Lua – dùng cho unit test) */
export function tokenBucketStep(state: BucketState | null, cfg: { capacity: number; ratePerMs: number }, nowMs: number, cost = 1): { allowed: boolean; state: BucketState; remaining: number; retryAfterMs: number } {
  let tokens = state ? state.tokens : cfg.capacity;
  let ts = state ? state.ts : nowMs;
  if (nowMs > ts) {
    tokens = Math.min(cfg.capacity, tokens + (nowMs - ts) * cfg.ratePerMs);
    ts = nowMs;
  }
  if (tokens >= cost) return { allowed: true, state: { tokens: tokens - cost, ts }, remaining: Math.floor(tokens - cost), retryAfterMs: 0 };
  return { allowed: false, state: { tokens, ts }, remaining: Math.floor(tokens), retryAfterMs: Math.ceil((cost - tokens) / cfg.ratePerMs) };
}

const LUA = `
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local b = redis.call('HMGET', KEYS[1], 't', 'ts')
local tokens = tonumber(b[1])
local ts = tonumber(b[2])
if tokens == nil then tokens = cap; ts = now end
if now > ts then tokens = math.min(cap, tokens + (now - ts) * rate); ts = now end
local allowed = 0
local retry = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 else retry = math.ceil((cost - tokens) / rate) end
redis.call('HSET', KEYS[1], 't', tostring(tokens), 'ts', tostring(ts))
redis.call('PEXPIRE', KEYS[1], ttl)
return { allowed, math.floor(tokens), retry }
`;

export interface TakeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  /** true khi Redis không sẵn sàng (cho qua) */
  degraded?: boolean;
}

@Injectable()
export class RateLimitService {
  private readonly logger = getLogger({ component: 'rate-limit' });
  private readonly allow: Set<string>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {
    this.allow = new Set(env.RATE_LIMIT_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean));
  }

  get enabled(): boolean {
    return this.env.RATE_LIMIT_BUCKETS_ENABLED;
  }

  isAllowlistedIp(ip: string | undefined | null): boolean {
    return !!ip && this.allow.has(ip);
  }

  configOf(name: BucketName): { capacity: number; ratePerMs: number; ttlMs: number } {
    const b = RATE_BUCKETS[name];
    const m = this.env.RATE_LIMIT_BUCKET_MULTIPLIER;
    const capacity = Math.max(1, Math.round(b.capacity * m));
    const ratePerMs = (b.refill * m) / (b.perSeconds * 1000);
    return { capacity, ratePerMs, ttlMs: Math.ceil((capacity / ratePerMs) * 1.2) + 1000 };
  }

  /** Lấy `cost` token của bucket `name` cho khoá `subject` (đã chuẩn hoá: `u:<id>`, `ip:<ip>`, `id:<hash>`) */
  async take(name: BucketName, subject: string, cost = 1): Promise<TakeResult> {
    const cfg = this.configOf(name);
    if (!this.redis.isHealthy) return { allowed: true, limit: cfg.capacity, remaining: cfg.capacity, retryAfterSec: 0, degraded: true };
    try {
      const key = `${this.env.QUEUE_PREFIX}:rl:${name}:${subject}`;
      const r = (await this.redis.client.eval(LUA, 1, key, cfg.capacity, cfg.ratePerMs, cost, cfg.ttlMs)) as [number, number, number];
      return { allowed: r[0] === 1, limit: cfg.capacity, remaining: Math.max(0, r[1]), retryAfterSec: Math.max(1, Math.ceil(r[2] / 1000)) };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, bucket: name }, 'rate limit check failed (fail-open)');
      return { allowed: true, limit: cfg.capacity, remaining: cfg.capacity, retryAfterSec: 0, degraded: true };
    }
  }

  /** Xoá trạng thái bucket (test/admin mở khoá) */
  async reset(name: BucketName, subject: string): Promise<void> {
    await this.redis.safe((r) => r.del(`${this.env.QUEUE_PREFIX}:rl:${name}:${subject}`));
  }
}

/** Định danh đăng nhập/OTP chuẩn hoá (email lowercase / số điện thoại chỉ chữ số) → sha256 rút gọn – không lưu PII trong khoá Redis */
export function identifierSubject(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const raw = typeof b.email === 'string' ? b.email.trim().toLowerCase() : typeof b.phone === 'string' ? b.phone.replace(/\D/g, '') : null;
  if (!raw) return null;
  return `id:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

/**
 * Guard toàn cục chạy SAU AuthGuard (req.user đã có): áp các bucket khai báo bằng @RateLimit. Bucket `ip` bỏ qua IP trong
 * RATE_LIMIT_ALLOWLIST (healthcheck nội bộ, test). Vượt → 429 `rate_limited` + `Retry-After`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.limiter.enabled || ctx.getType() !== 'http') return true;
    const buckets = this.reflector.getAllAndOverride<BucketName[] | undefined>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!buckets?.length) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: { id: string; isGuest: boolean } }>();
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    let tightest: TakeResult | null = null;
    for (const name of buckets) {
      const by = RATE_BUCKETS[name].by;
      let subject: string | null;
      if (by === 'user') subject = req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
      else if (by === 'ip') subject = `ip:${req.ip}`;
      else subject = identifierSubject(req.body);
      if (!subject) continue;
      if (subject.startsWith('ip:') && this.limiter.isAllowlistedIp(req.ip)) continue;
      const r = await this.limiter.take(name, subject);
      if (!tightest || r.remaining < tightest.remaining) tightest = r;
      if (!r.allowed) {
        HTTP_METRICS.rateLimited.inc({ bucket: name });
        void reply.header('x-ratelimit-limit', r.limit).header('x-ratelimit-remaining', 0).header('retry-after', r.retryAfterSec);
        throw new RateLimited(r.retryAfterSec, { bucket: name });
      }
    }
    if (tightest) void reply.header('x-ratelimit-limit', tightest.limit).header('x-ratelimit-remaining', tightest.remaining);
    return true;
  }
}

@Global()
@Module({ providers: [RateLimitService], exports: [RateLimitService] })
export class RateLimitModule {}
