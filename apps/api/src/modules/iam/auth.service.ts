import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { DOMAIN_EVENTS, GUEST_SESSION_DAYS, type AttributionInput, type AuthTokens, type GuestSession, type LoginInput, type OtpVerifyInput, type RegisterInput } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { JwtService } from '../../shared/auth/jwt.service.js';
import { Unauthorized } from '../../shared/http/errors.js';
import { t } from '../../shared/i18n/messages.js';
import { sanitizeAttribution, type StoredAttribution } from './attribution.js';
import { ConsentsService } from './consents.service.js';
import { MergeService } from './merge.service.js';
import { OtpService } from './otp/otp.service.js';
import { SessionsService, type IssuedTokens } from './sessions.service.js';
import { TurnstileService } from './turnstile.service.js';
import { UsersService } from './users.service.js';
import { WelcomeCreditsService } from './welcome-credits.service.js';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  device?: Record<string, unknown>;
}

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Lõi xác thực (ADR-0020/0022): email/mật khẩu Argon2id, OTP, phiên khách, ghép khách, refresh xoay vòng; OAuth ở OAuthService */
@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly merge: MergeService,
    private readonly jwt: JwtService,
    private readonly outbox: OutboxService,
    private readonly welcome: WelcomeCreditsService,
    private readonly consents: ConsentsService,
    private readonly otp: OtpService,
    private readonly turnstile: TurnstileService,
  ) {}

  async register(input: RegisterInput, meta: RequestMeta): Promise<{ tokens: IssuedTokens; body: AuthTokens }> {
    await this.turnstile.assert(input.turnstile_token, meta.ip, 'register');
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
    const guestId = input.guest_token ? await this.jwt.verifyGuestToken(input.guest_token) : null;
    const result = await this.dbs.db.transaction(async (tx) => {
      const user = await this.users.createEmailUser(tx, { email: input.email, passwordHash, displayName: input.display_name, uiLocale: input.ui_locale });
      await this.consents.recordSignupConsents(tx, user.id, { accept: input.accept_terms, marketing: input.marketing_opt_in, ip: meta.ip });
      const attribution = this.attributionOf(input.attribution, input.referral_code);
      await this.users.setAttribution(tx, user.id, attribution);
      await this.welcome.grant(tx, user.id, 'registered');
      if (guestId) await this.merge.mergeGuestInto(tx, guestId, user.id, meta);
      await this.outbox.write(tx, { aggregateType: 'user', aggregateId: user.id, eventType: DOMAIN_EVENTS.USER_REGISTERED, payload: { ...registeredPayload(user.id, 'email', !!guestId, input.referral_code, meta), ...attributionEventFields(attribution) } });
      const roles = await this.users.getRoles(user.id, tx);
      const tokens = await this.sessions.create(tx, { id: user.id, isGuest: false }, roles, { device: deviceOf(meta), ip: meta.ip });
      return { user, tokens };
    });
    // S8: referral – growth nghe local + outbox user.registered (mã giới thiệu, fingerprint băm, IP)
    this.outbox.emitLocal(DOMAIN_EVENTS.USER_REGISTERED, registeredPayload(result.user.id, 'email', !!guestId, input.referral_code, meta));
    const dto = await this.users.toDto(result.user);
    return { tokens: result.tokens, body: { access_token: result.tokens.accessToken, expires_in: result.tokens.expiresIn, user: dto } };
  }

  /** S10: attribution đã chuẩn hoá (referrer của chính site Allingo không tính) */
  attributionOf(input: AttributionInput | undefined, referralCode: string | undefined): StoredAttribution | null {
    const own = [this.env.WEB_PUBLIC_URL, this.env.API_PUBLIC_URL].map((u) => {
      try {
        return new URL(u).hostname;
      } catch {
        return '';
      }
    });
    return sanitizeAttribution(input, { referralCode: referralCode?.trim() || null, ownHosts: own.filter(Boolean) });
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<{ tokens: IssuedTokens; body: AuthTokens }> {
    await this.turnstile.assert(input.turnstile_token, meta.ip, 'login');
    const user = await this.users.findByEmail(input.email);
    // So sánh thời gian đều để tránh enumerate email
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, input.password) : await argon2.verify(DUMMY_HASH, input.password).catch(() => false);
    if (!user || !ok || user.status !== 'active') throw new Unauthorized('Invalid email or password');
    const guestId = input.guest_token ? await this.jwt.verifyGuestToken(input.guest_token) : null;
    const tokens = await this.dbs.db.transaction(async (tx) => {
      if (guestId) await this.merge.mergeGuestInto(tx, guestId, user.id, meta);
      const roles = await this.users.getRoles(user.id, tx);
      return this.sessions.create(tx, { id: user.id, isGuest: false }, roles, { device: deviceOf(meta), ip: meta.ip });
    });
    const dto = await this.users.toDto(user);
    return { tokens, body: { access_token: tokens.accessToken, expires_in: tokens.expiresIn, user: dto } };
  }

  /** Tạo tài khoản khách + phiên; guest_token dùng để ghép khi đăng ký */
  async guest(meta: RequestMeta, locale: 'vi' | 'en' = 'vi'): Promise<{ tokens: IssuedTokens; body: GuestSession & { access_token: string; expires_in: number } }> {
    const ttl = GUEST_SESSION_DAYS * 86_400;
    const result = await this.dbs.db.transaction(async (tx) => {
      const user = await this.users.createGuest(tx, t(locale, 'guest_display_name'), locale);
      await this.welcome.grant(tx, user.id, 'guest');
      const tokens = await this.sessions.create(tx, { id: user.id, isGuest: true }, ['learner'], { device: deviceOf(meta), ip: meta.ip });
      return { user, tokens };
    });
    const guestToken = await this.jwt.signGuestToken(result.user.id, ttl);
    const dto = await this.users.toDto(result.user);
    return {
      tokens: result.tokens,
      body: { guest_token: guestToken, expires_at: new Date(Date.now() + ttl * 1000).toISOString(), user: dto, access_token: result.tokens.accessToken, expires_in: result.tokens.expiresIn },
    };
  }

  /** OTP: gửi mã (429 khi vượt giới hạn/khoá) */
  async otpRequest(input: { phone?: string; email?: string; channel: 'zalo' | 'sms' | 'email'; turnstile_token?: string }, meta: RequestMeta, locale: 'vi' | 'en' = 'vi') {
    await this.turnstile.assert(input.turnstile_token, meta.ip, 'otp');
    const r = await this.otp.request({ phone: input.phone, email: input.email, channel: input.channel, locale });
    return { status: 'sent' as const, channel: r.channel, retry_after: r.retryAfter, expires_in: r.expiresIn };
  }

  /** OTP: xác minh → đăng nhập; chưa có tài khoản → tạo mới (identity provider phone/email), ghép khách */
  async otpVerify(input: OtpVerifyInput, meta: RequestMeta): Promise<{ tokens: IssuedTokens; body: AuthTokens & { created?: boolean } }> {
    const ident = await this.otp.verify(input);
    const guestId = input.guest_token ? await this.jwt.verifyGuestToken(input.guest_token) : null;
    const result = await this.dbs.db.transaction(async (tx) => {
      let user = ident.kind === 'email' ? await this.users.findByEmail(ident.id, tx) : await this.users.findByPhone(ident.id, tx);
      let created = false;
      if (!user) {
        user = await this.users.createExternalUser(tx, { email: ident.kind === 'email' ? ident.id : null, phone: ident.kind === 'phone' ? ident.id : null, displayName: input.display_name ?? (ident.kind === 'phone' ? `User ${ident.id.slice(-4)}` : ident.id.split('@')[0]!), uiLocale: input.ui_locale });
        created = true;
        await this.consents.recordSignupConsents(tx, user.id, { ip: meta.ip });
        const attribution = this.attributionOf(input.attribution, input.referral_code);
        await this.users.setAttribution(tx, user.id, attribution);
        await this.welcome.grant(tx, user.id, 'registered');
        await this.outbox.write(tx, { aggregateType: 'user', aggregateId: user.id, eventType: DOMAIN_EVENTS.USER_REGISTERED, payload: { ...registeredPayload(user.id, ident.kind, !!guestId, input.referral_code, meta), ...attributionEventFields(attribution) } });
      }
      if (user.status !== 'active') throw new Unauthorized('Account inactive');
      await this.users.linkIdentity(tx, { userId: user.id, provider: ident.kind, providerUid: ident.id, email: ident.kind === 'email' ? ident.id : null });
      if (guestId) await this.merge.mergeGuestInto(tx, guestId, user.id, meta);
      const roles = await this.users.getRoles(user.id, tx);
      const tokens = await this.sessions.create(tx, { id: user.id, isGuest: false }, roles, { device: { ...deviceOf(meta), provider: ident.kind }, ip: meta.ip });
      return { user, tokens, created };
    });
    if (result.created) this.outbox.emitLocal(DOMAIN_EVENTS.USER_REGISTERED, registeredPayload(result.user.id, ident.kind, !!guestId, input.referral_code, meta));
    const dto = await this.users.toDto(result.user);
    return { tokens: result.tokens, body: { access_token: result.tokens.accessToken, expires_in: result.tokens.expiresIn, user: dto, created: result.created } };
  }

  async refresh(refreshToken: string | undefined): Promise<{ tokens: IssuedTokens; body: AuthTokens }> {
    if (!refreshToken) throw new Unauthorized('Missing refresh token');
    const tokens = await this.sessions.rotate(
      refreshToken,
      (id) => this.users.getRoles(id),
      async (id) => (await this.users.findById(id))?.isGuest ?? false,
    );
    const userRow = await this.users.findById(await this.subjectOf(tokens.accessToken));
    if (!userRow || userRow.status !== 'active') throw new Unauthorized('Account inactive');
    const dto = await this.users.toDto(userRow);
    return { tokens, body: { access_token: tokens.accessToken, expires_in: tokens.expiresIn, user: dto } };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.sessions.revoke(sessionId, userId);
  }

  private async subjectOf(accessToken: string): Promise<string> {
    const claims = await this.jwt.verifyAccess(accessToken);
    if (!claims) throw new Unauthorized();
    return claims.sub;
  }

  /** Cookie httpOnly cho web (CLAUDE.md §3 Auth) */
  cookieOptions(kind: 'access' | 'refresh') {
    const base = { httpOnly: true, sameSite: 'lax' as const, secure: this.env.COOKIE_SECURE, domain: this.env.COOKIE_DOMAIN, path: '/' };
    return kind === 'access' ? { ...base, maxAge: this.jwt.accessTtl } : { ...base, path: '/v1/auth', maxAge: this.jwt.refreshTtl };
  }
}

/** Hash giả dùng để giữ thời gian verify ổn định khi email không tồn tại */
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$8Cq6U5Kf6nM4mXhA9bZ5xJmE5Q9m0i9o0mN9iBz7yQ0';

/**
 * Payload outbox `user.registered` (S8): `referral_code` (nếu có), `device_fp` = sha256 fingerprint thiết bị do client gửi
 * (header X-Device-Fingerprint – không lưu bản gốc), `ip` để growth chống lạm dụng referral.
 */
export function registeredPayload(userId: string, provider: string, mergedGuest: boolean, referralCode: string | undefined, meta: RequestMeta): Record<string, unknown> {
  return { user_id: userId, provider, merged_guest: mergedGuest, referral_code: referralCode?.trim().toUpperCase() || null, device_fp: typeof meta.device?.fp === 'string' ? meta.device.fp : null, ip: meta.ip ?? null };
}

/** S10: trường attribution trong payload `user.registered` (analytics/phễu) – chỉ kênh + UTM, không referrer/landing */
export function attributionEventFields(a: StoredAttribution | null): Record<string, unknown> {
  return a ? { attribution: { channel: a.channel, utm_source: a.utm_source, utm_medium: a.utm_medium, utm_campaign: a.utm_campaign } } : {};
}

function deviceOf(meta: RequestMeta): Record<string, unknown> {
  return { ...(meta.device ?? {}), ua: meta.userAgent?.slice(0, 200) ?? null };
}


