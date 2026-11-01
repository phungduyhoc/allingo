import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OtpChannel } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { RedisService } from '../../../shared/cache/redis.module.js';
import { RateLimited, Unauthorized } from '../../../shared/http/errors.js';
import { MailerService } from '../../../shared/notify/mailer.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { ConsoleOtpSender, EmailOtpSender, EsmsSmsSender, MemoryOtpSender, ZaloZnsSender, type OtpSender } from './otp-sender.js';

interface OtpRecord {
  hash: string;
  attempts: number;
  expiresAt: number;
}

/**
 * OTP 6 số: hiệu lực OTP_TTL_SECONDS (5 phút), sai OTP_MAX_ATTEMPTS (5) → khoá OTP_LOCK_MINUTES (30),
 * tối đa OTP_REQUEST_LIMIT (3) yêu cầu / OTP_REQUEST_WINDOW_MINUTES (15) cho mỗi định danh (CLAUDE.md §9).
 * Lưu băm HMAC(code, identifier) trong Redis; Redis degrade → Map trong bộ nhớ (một instance, cảnh báo).
 */
@Injectable()
export class OtpService {
  private readonly logger = getLogger({ component: 'iam.otp' });
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  readonly memorySender: MemoryOtpSender | null;
  private readonly senders: Record<OtpChannel, OtpSender>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    mailer: MailerService,
  ) {
    const mode = env.OTP_SENDER === 'auto' && env.APP_ENV === 'test' ? 'memory' : env.OTP_SENDER;
    if (mode === 'memory') {
      this.memorySender = new MemoryOtpSender();
      this.senders = { email: this.memorySender, sms: this.memorySender, zalo: this.memorySender };
    } else if (mode === 'console') {
      this.memorySender = null;
      const c = new ConsoleOtpSender();
      this.senders = { email: c, sms: c, zalo: c };
    } else {
      this.memorySender = null;
      const dev = env.APP_ENV === 'development';
      this.senders = {
        email: new EmailOtpSender(mailer),
        sms: dev && !env.ESMS_API_KEY ? new ConsoleOtpSender() : new EsmsSmsSender(env.ESMS_API_KEY),
        zalo: dev && !env.ZALO_ZNS_ACCESS_TOKEN ? new ConsoleOtpSender() : new ZaloZnsSender(env.ZALO_ZNS_ACCESS_TOKEN),
      };
    }
  }

  // ----------------------------------------------------------------- lưu trữ (Redis → memory)
  private async kvGet(key: string): Promise<string | null> {
    const r = await this.redis.safe((c) => c.get(key));
    if (r !== null) return r;
    if (this.redis.isHealthy) return null;
    const m = this.memory.get(key);
    if (!m) return null;
    if (m.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return m.value;
  }
  private async kvSet(key: string, value: string, ttlSec: number): Promise<void> {
    const ok = await this.redis.safe((c) => c.set(key, value, 'EX', ttlSec));
    if (ok === null) this.memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
  private async kvDel(key: string): Promise<void> {
    await this.redis.safe((c) => c.del(key));
    this.memory.delete(key);
  }
  private async kvIncr(key: string, ttlSec: number): Promise<number> {
    const n = await this.redis.safe(async (c) => {
      const v = await c.incr(key);
      if (v === 1) await c.expire(key, ttlSec);
      return v;
    });
    if (n !== null) return n;
    const cur = Number((await this.kvGet(key)) ?? '0') + 1;
    const m = this.memory.get(key);
    this.memory.set(key, { value: String(cur), expiresAt: m?.expiresAt ?? Date.now() + ttlSec * 1000 });
    return cur;
  }

  // ----------------------------------------------------------------- nghiệp vụ
  static normalizeIdentifier(input: { phone?: string; email?: string }): { kind: 'phone' | 'email'; id: string } {
    if (input.email) return { kind: 'email', id: input.email.trim().toLowerCase() };
    let p = (input.phone ?? '').replace(/[\s.-]/g, '');
    if (p.startsWith('0')) p = `+84${p.slice(1)}`;
    if (!p.startsWith('+')) p = `+${p}`;
    return { kind: 'phone', id: p };
  }

  private hash(code: string, id: string): string {
    return createHmac('sha256', this.env.AUTH_SECRET).update(`${id}:${code}`).digest('hex');
  }

  private generate(): string {
    if (this.env.OTP_DEV_FIXED_CODE && this.env.APP_ENV !== 'production') return this.env.OTP_DEV_FIXED_CODE.padStart(6, '0').slice(-6);
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** Gửi OTP; 429 khi vượt giới hạn yêu cầu hoặc đang bị khoá */
  async request(input: { phone?: string; email?: string; channel: OtpChannel; locale?: 'vi' | 'en' }): Promise<{ channel: OtpChannel; retryAfter: number; expiresIn: number }> {
    const { id } = OtpService.normalizeIdentifier(input);
    const lockTtl = await this.lockRemaining(id);
    if (lockTtl > 0) throw new RateLimited(lockTtl);
    const windowSec = this.env.OTP_REQUEST_WINDOW_MINUTES * 60;
    const n = await this.kvIncr(`otp:req:${id}`, windowSec);
    if (n > this.env.OTP_REQUEST_LIMIT) throw new RateLimited(windowSec);

    const code = this.generate();
    const rec: OtpRecord = { hash: this.hash(code, id), attempts: 0, expiresAt: Date.now() + this.env.OTP_TTL_SECONDS * 1000 };
    await this.kvSet(`otp:code:${id}`, JSON.stringify(rec), this.env.OTP_TTL_SECONDS);
    try {
      await this.senders[input.channel].send({ channel: input.channel, target: id, code, ttlSeconds: this.env.OTP_TTL_SECONDS, locale: input.locale ?? 'vi' });
    } catch (err) {
      this.logger.warn({ channel: input.channel, err: (err as Error).message }, 'otp send failed');
      await this.kvDel(`otp:code:${id}`);
      throw err;
    }
    return { channel: input.channel, retryAfter: 60, expiresIn: this.env.OTP_TTL_SECONDS };
  }

  /** Xác minh: sai → tăng attempts; đủ OTP_MAX_ATTEMPTS → khoá; đúng → xoá mã */
  async verify(input: { phone?: string; email?: string; otp: string }): Promise<{ kind: 'phone' | 'email'; id: string }> {
    const ident = OtpService.normalizeIdentifier(input);
    const lockTtl = await this.lockRemaining(ident.id);
    if (lockTtl > 0) throw new RateLimited(lockTtl);
    const raw = await this.kvGet(`otp:code:${ident.id}`);
    const rec = raw ? (JSON.parse(raw) as OtpRecord) : null;
    if (!rec || rec.expiresAt < Date.now()) throw new Unauthorized('OTP expired or not requested', { reason: 'otp_expired' });
    const expected = Buffer.from(rec.hash, 'hex');
    const given = Buffer.from(this.hash(input.otp, ident.id), 'hex');
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      await this.kvDel(`otp:code:${ident.id}`);
      await this.kvDel(`otp:req:${ident.id}`);
      return ident;
    }
    rec.attempts += 1;
    if (rec.attempts >= this.env.OTP_MAX_ATTEMPTS) {
      await this.kvDel(`otp:code:${ident.id}`);
      await this.kvSet(`otp:lock:${ident.id}`, '1', this.env.OTP_LOCK_MINUTES * 60);
      throw new RateLimited(this.env.OTP_LOCK_MINUTES * 60);
    }
    const ttl = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000));
    await this.kvSet(`otp:code:${ident.id}`, JSON.stringify(rec), ttl);
    throw new Unauthorized('Invalid OTP', { reason: 'otp_invalid', attempts_left: this.env.OTP_MAX_ATTEMPTS - rec.attempts });
  }

  private async lockRemaining(id: string): Promise<number> {
    const ttl = await this.redis.safe((c) => c.ttl(`otp:lock:${id}`));
    if (ttl !== null) return ttl > 0 ? ttl : 0;
    const m = this.memory.get(`otp:lock:${id}`);
    return m && m.expiresAt > Date.now() ? Math.ceil((m.expiresAt - Date.now()) / 1000) : 0;
  }
}
