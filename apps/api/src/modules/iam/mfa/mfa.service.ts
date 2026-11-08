import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Độ dài tag AES-256-GCM cố định 16 byte (128 bit) */
const GCM_TAG_BYTES = 16;
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { MFA_TOTP } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { adminMfaRequired, MFA_ROLES, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { MfaEnrollmentLookup } from '../../../shared/auth/mfa-enrollment.lookup.js';
import { RedisService } from '../../../shared/cache/redis.module.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { Conflict, Forbidden, RateLimited, Unauthorized, ValidationFailed } from '../../../shared/http/errors.js';
import { SessionsService } from '../sessions.service.js';
import { UsersService } from '../users.service.js';
import { base32Encode, newRecoveryCode, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from './totp.js';

const { iamMfaFactors } = schema;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

type RecoveryCode = { hash: string; used_at: string | null };

/**
 * MFA TOTP cho admin/superadmin (S12 – pentest-1): enroll (secret mã hoá AES-256-GCM) → confirm (mã đầu tiên, 10 mã khôi phục
 * hiển thị một lần) → step-up mỗi phiên (POST /auth/mfa/verify → iam.sessions.mfa_verified_at + access token claim `mfa`).
 * Chống dùng lại mã (last_used_step), khoá 15′ sau 5 lần sai (Redis, dự phòng bộ nhớ), audit mọi sự kiện, không log mã/secret.
 */
@Injectable()
export class MfaService {
  private readonly key: Buffer;
  private readonly localFailures = new Map<string, { n: number; until: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly enrollment: MfaEnrollmentLookup,
  ) {
    this.key = createHash('sha256').update(env.MFA_ENCRYPTION_KEY || `${env.AUTH_SECRET}:mfa-totp-v1`).digest();
  }

  private assertEligible(user: AuthUser): void {
    if (user.impersonatedBy) throw new Forbidden('Not allowed while impersonating', { reason: 'impersonation_read_only' });
    if (user.isGuest || !user.roles.some((r) => (MFA_ROLES as readonly string[]).includes(r))) throw new Forbidden('MFA is available for admin roles only', { reason: 'mfa_not_available' });
  }

  encrypt(secret: Buffer): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: GCM_TAG_BYTES });
    const ct = Buffer.concat([c.update(secret), c.final()]);
    return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
  }

  decrypt(enc: string): Buffer {
    const [v, iv, tag, ct] = enc.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('invalid secret envelope');
    const tagBuf = Buffer.from(tag, 'base64url');
    // Chỉ nhận tag đủ 16 byte – tag ngắn hơn làm yếu xác thực GCM (Semgrep gcm-no-tag-length)
    if (tagBuf.length !== GCM_TAG_BYTES) throw new Error('invalid secret envelope');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'), { authTagLength: GCM_TAG_BYTES });
    d.setAuthTag(tagBuf);
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]);
  }

  private async factor(userId: string) {
    const [row] = await this.dbs.db.select().from(iamMfaFactors).where(and(eq(iamMfaFactors.userId, userId), eq(iamMfaFactors.kind, 'totp'))).limit(1);
    return row ?? null;
  }

  async status(user: AuthUser) {
    const f = await this.factor(user.id);
    const required = adminMfaRequired(this.env) && user.roles.some((r) => (MFA_ROLES as readonly string[]).includes(r));
    return {
      required,
      enrolled: !!f?.confirmedAt,
      pending_enrollment: !!f && !f.confirmedAt,
      session_verified: !!user.mfa,
      recovery_codes_remaining: f?.confirmedAt ? (f.recoveryCodes ?? []).filter((c) => !c.used_at).length : 0,
    };
  }

  async isEnrolled(userId: string): Promise<boolean> {
    return !!(await this.factor(userId))?.confirmedAt;
  }

  async enroll(user: AuthUser) {
    this.assertEligible(user);
    const existing = await this.factor(user.id);
    if (existing?.confirmedAt) throw new Conflict('TOTP already enrolled', { reason: 'mfa_already_enrolled' });
    const secret = newTotpSecret();
    const secretEnc = this.encrypt(secret);
    await this.dbs.db
      .insert(iamMfaFactors)
      .values({ userId: user.id, kind: 'totp', secretEnc, confirmedAt: null, lastUsedStep: null, recoveryCodes: [] })
      .onConflictDoUpdate({ target: [iamMfaFactors.userId, iamMfaFactors.kind], set: { secretEnc, confirmedAt: null, lastUsedStep: null, recoveryCodes: [] } });
    const row = await this.users.findById(user.id);
    const secretBase32 = base32Encode(secret);
    await this.audit.log({ action: 'mfa.enroll_started', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'user', entityId: user.id });
    return { secret: secretBase32, otpauth_url: otpauthUrl({ issuer: this.env.MFA_ISSUER, account: row?.email ?? user.id, secretBase32, digits: MFA_TOTP.digits, period: MFA_TOTP.period }), digits: MFA_TOTP.digits, period: MFA_TOTP.period, algorithm: 'SHA1' as const };
  }

  async confirm(user: AuthUser, code: string) {
    this.assertEligible(user);
    await this.assertNotLocked(user.id);
    const f = await this.factor(user.id);
    if (!f) throw new Conflict('Start enrollment first', { reason: 'mfa_not_enrolled' });
    if (f.confirmedAt) throw new Conflict('TOTP already enrolled', { reason: 'mfa_already_enrolled' });
    const r = verifyTotp(this.decrypt(f.secretEnc), code, this.clock.now(), { period: MFA_TOTP.period, digits: MFA_TOTP.digits, window: MFA_TOTP.window, lastUsedStep: f.lastUsedStep });
    if (!r.ok) return this.fail(user, 'mfa.confirm_failed');
    const codes = Array.from({ length: MFA_TOTP.recovery_codes }, () => newRecoveryCode());
    await this.dbs.db.update(iamMfaFactors).set({ confirmedAt: new Date(this.clock.now()), lastUsedStep: r.step, recoveryCodes: codes.map((c) => ({ hash: hashCode(c), used_at: null })) }).where(eq(iamMfaFactors.id, f.id));
    await this.clearFailures(user.id);
    await this.enrollment.invalidate(user.id);
    await this.audit.log({ action: 'mfa.enrolled', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'user', entityId: user.id, after: { kind: 'totp', recovery_codes: codes.length } });
    const tokens = await this.stepUp(user);
    return { ...tokens, recovery_codes: codes };
  }

  /** Step-up phiên hiện tại bằng TOTP hoặc mã khôi phục */
  async verify(user: AuthUser, input: { code?: string; recovery_code?: string }) {
    this.assertEligible(user);
    await this.assertNotLocked(user.id);
    const f = await this.factor(user.id);
    if (!f?.confirmedAt) throw new Conflict('TOTP is not enrolled', { reason: 'mfa_not_enrolled' });
    if (input.code) {
      const r = verifyTotp(this.decrypt(f.secretEnc), input.code, this.clock.now(), { period: MFA_TOTP.period, digits: MFA_TOTP.digits, window: MFA_TOTP.window, lastUsedStep: f.lastUsedStep });
      if (!r.ok) return this.fail(user, 'mfa.verify_failed', r.reason);
      // Chống replay đồng thời: chỉ cập nhật khi bước mới lớn hơn bước đã lưu
      const upd = await this.dbs.db.execute(sqlUpdateStep(f.id, r.step));
      if (!(upd as unknown as unknown[]).length) return this.fail(user, 'mfa.verify_failed', 'replayed');
    } else {
      const target = hashCode(normalizeRecoveryCode(input.recovery_code ?? ''));
      const codes = (f.recoveryCodes ?? []) as RecoveryCode[];
      const idx = codes.findIndex((c) => !c.used_at && c.hash === target);
      if (idx < 0) return this.fail(user, 'mfa.verify_failed', 'invalid_recovery_code');
      codes[idx] = { ...codes[idx]!, used_at: new Date(this.clock.now()).toISOString() };
      await this.dbs.db.update(iamMfaFactors).set({ recoveryCodes: codes }).where(eq(iamMfaFactors.id, f.id));
    }
    await this.clearFailures(user.id);
    await this.audit.log({ action: 'mfa.verified', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'session', entityId: user.sessionId, after: { method: input.code ? 'totp' : 'recovery_code' } });
    return this.stepUp(user);
  }

  async regenerateRecoveryCodes(user: AuthUser, code: string) {
    this.assertEligible(user);
    await this.assertNotLocked(user.id);
    const f = await this.factor(user.id);
    if (!f?.confirmedAt) throw new Conflict('TOTP is not enrolled', { reason: 'mfa_not_enrolled' });
    const r = verifyTotp(this.decrypt(f.secretEnc), code, this.clock.now(), { period: MFA_TOTP.period, digits: MFA_TOTP.digits, window: MFA_TOTP.window, lastUsedStep: f.lastUsedStep });
    if (!r.ok) return this.fail(user, 'mfa.recovery_regenerate_failed', r.reason);
    const codes = Array.from({ length: MFA_TOTP.recovery_codes }, () => newRecoveryCode());
    await this.dbs.db.update(iamMfaFactors).set({ lastUsedStep: r.step, recoveryCodes: codes.map((c) => ({ hash: hashCode(c), used_at: null })) }).where(eq(iamMfaFactors.id, f.id));
    await this.clearFailures(user.id);
    await this.audit.log({ action: 'mfa.recovery_regenerated', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'user', entityId: user.id });
    return { recovery_codes: codes };
  }

  private async stepUp(user: AuthUser): Promise<{ access_token: string; expires_in: number; mfa: true }> {
    const roles = await this.users.getRoles(user.id);
    const t = await this.sessions.markMfaVerified(user.sessionId, { id: user.id, isGuest: user.isGuest }, roles);
    if (!t) throw new Unauthorized('Session expired');
    return { access_token: t.accessToken, expires_in: t.expiresIn, mfa: true };
  }

  // ------------------------------------------------------------------ chống dò mã
  private fkey(userId: string): string {
    return `mfa:fail:${userId}`;
  }

  private async assertNotLocked(userId: string): Promise<void> {
    const n = await this.redis.safe((r) => r.get(this.fkey(userId)));
    const local = this.localFailures.get(userId);
    const count = n !== null ? Number(n) : local && local.until > Date.now() ? local.n : 0;
    if (count >= MAX_FAILURES) {
      const ttl = (await this.redis.safe((r) => r.ttl(this.fkey(userId)))) ?? Math.ceil(((local?.until ?? Date.now()) - Date.now()) / 1000);
      throw new RateLimited(Math.max(1, ttl ?? LOCK_SECONDS), { reason: 'mfa_locked' });
    }
  }

  private async fail(user: AuthUser, action: string, reason = 'invalid'): Promise<never> {
    const n = await this.redis.safe(async (r) => {
      const v = await r.incr(this.fkey(user.id));
      if (v === 1) await r.expire(this.fkey(user.id), LOCK_SECONDS);
      return v;
    });
    if (n === null) {
      const cur = this.localFailures.get(user.id);
      this.localFailures.set(user.id, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: Date.now() + LOCK_SECONDS * 1000 });
    }
    await this.audit.log({ action, actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'user', entityId: user.id, after: { reason } });
    throw new ValidationFailed({ reason: 'mfa_invalid', issues: [{ path: 'code', code: 'mfa_invalid', message: 'invalid or already used code' }] }, 'Invalid MFA code');
  }

  private async clearFailures(userId: string): Promise<void> {
    this.localFailures.delete(userId);
    await this.redis.safe((r) => r.del(this.fkey(userId)));
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** UPDATE … SET last_used_step = $step WHERE id = $id AND (last_used_step IS NULL OR last_used_step < $step) RETURNING id */
function sqlUpdateStep(id: string, step: number) {
  return sql`update iam.mfa_factors set last_used_step = ${step} where id = ${id} and (last_used_step is null or last_used_step < ${step}) returning id`;
}
