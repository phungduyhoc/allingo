import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { schema } from '@allingo/db';
import { eq } from 'drizzle-orm';
import { DOMAIN_EVENTS, GUEST_SESSION_DAYS, GUEST_WELCOME_CREDITS, type AuthTokens, type GuestSession, type LoginInput, type RegisterInput } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { JwtService } from '../../shared/auth/jwt.service.js';
import { Unauthorized } from '../../shared/http/errors.js';
import { t } from '../../shared/i18n/messages.js';
import { CreditService } from '../billing/index.js';
import type { DbOrTx } from '../../shared/db/db.module.js';
import { MergeService } from './merge.service.js';
import { SessionsService, type IssuedTokens } from './sessions.service.js';
import { UsersService } from './users.service.js';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  device?: Record<string, unknown>;
}

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Lõi xác thực Sprint 0 (ADR-0020): email/mật khẩu Argon2id, phiên khách, ghép khách, refresh xoay vòng */
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
    private readonly credits: CreditService,
  ) {}

  /** Credit khởi điểm: khách nhận GUEST_WELCOME_CREDITS; tài khoản đăng ký nhận credits_included của gói Free (cấp lại hằng tháng – Sprint 7) */
  private async grantWelcomeCredits(tx: DbOrTx, userId: string, kind: 'guest' | 'registered'): Promise<void> {
    let amount = GUEST_WELCOME_CREDITS;
    if (kind === 'registered') {
      const [free] = await tx.select({ credits: schema.billingPlans.creditsIncluded }).from(schema.billingPlans).where(eq(schema.billingPlans.code, 'free')).limit(1);
      amount = free?.credits ?? 0;
    }
    if (amount > 0) await this.credits.grant(tx, userId, amount, 'subscription_grant', { refType: 'plan', note: kind === 'guest' ? 'guest_welcome' : 'free_monthly' });
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<{ tokens: IssuedTokens; body: AuthTokens }> {
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
    const guestId = input.guest_token ? await this.jwt.verifyGuestToken(input.guest_token) : null;
    const result = await this.dbs.db.transaction(async (tx) => {
      const user = await this.users.createEmailUser(tx, { email: input.email, passwordHash, displayName: input.display_name, uiLocale: input.ui_locale });
      await this.grantWelcomeCredits(tx, user.id, 'registered');
      if (guestId) await this.merge.mergeGuestInto(tx, guestId, user.id);
      await this.outbox.write(tx, { aggregateType: 'user', aggregateId: user.id, eventType: DOMAIN_EVENTS.USER_REGISTERED, payload: { user_id: user.id, provider: 'email', merged_guest: !!guestId } });
      const roles = await this.users.getRoles(user.id, tx);
      const tokens = await this.sessions.create(tx, { id: user.id, isGuest: false }, roles, { device: deviceOf(meta), ip: meta.ip });
      return { user, tokens };
    });
    const dto = await this.users.toDto(result.user);
    return { tokens: result.tokens, body: { access_token: result.tokens.accessToken, expires_in: result.tokens.expiresIn, user: dto } };
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<{ tokens: IssuedTokens; body: AuthTokens }> {
    const user = await this.users.findByEmail(input.email);
    // So sánh thời gian đều để tránh enumerate email
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, input.password) : await argon2.verify(DUMMY_HASH, input.password).catch(() => false);
    if (!user || !ok || user.status !== 'active') throw new Unauthorized('Invalid email or password');
    const guestId = input.guest_token ? await this.jwt.verifyGuestToken(input.guest_token) : null;
    const tokens = await this.dbs.db.transaction(async (tx) => {
      if (guestId) await this.merge.mergeGuestInto(tx, guestId, user.id);
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
      await this.grantWelcomeCredits(tx, user.id, 'guest');
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

function deviceOf(meta: RequestMeta): Record<string, unknown> {
  return { ...(meta.device ?? {}), ua: meta.userAgent?.slice(0, 200) ?? null };
}


