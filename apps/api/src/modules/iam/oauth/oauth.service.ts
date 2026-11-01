import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { DOMAIN_EVENTS, OAUTH_PROVIDERS, type AuthTokens, type OAuthInput, type OAuthProviderCode } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { JwtService } from '../../../shared/auth/jwt.service.js';
import { Conflict, FeatureDisabled, Unauthorized } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { ConsentsService } from '../consents.service.js';
import { MergeService } from '../merge.service.js';
import { SessionsService, type IssuedTokens } from '../sessions.service.js';
import { UsersService } from '../users.service.js';
import { WelcomeCreditsService } from '../welcome-credits.service.js';
import { AppleOAuthProvider } from './apple.provider.js';
import { FacebookOAuthProvider } from './facebook.provider.js';
import { GoogleOAuthProvider } from './google.provider.js';
import { MockOAuthProvider } from './mock.provider.js';
import { OAuthVerificationError, type OAuthProvider } from './oauth-provider.js';

export interface OAuthMeta {
  ip?: string | null;
  userAgent?: string | null;
  device?: Record<string, unknown>;
}

/**
 * Đăng nhập/đăng ký qua Google, Apple, Facebook (ADR-0022):
 * 1) identity (provider, uid) đã có → đăng nhập, không tạo trùng;
 * 2) chưa có identity nhưng email đã có tài khoản → KHÔNG auto-merge: tài khoản có mật khẩu phải gửi `link_password`,
 *    tài khoản không mật khẩu (OTP/OAuth khác) gửi `link_confirm: true`; thiếu → 409 `link_required`;
 * 3) chưa có gì → tạo user mới (email chỉ đặt khi đã xác minh), identity, consents, credit chào mừng, ghép khách.
 */
@Injectable()
export class OAuthService {
  private readonly logger = getLogger({ component: 'iam.oauth' });
  private readonly providers: Record<OAuthProviderCode, OAuthProvider>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly merge: MergeService,
    private readonly consents: ConsentsService,
    private readonly welcome: WelcomeCreditsService,
    private readonly jwt: JwtService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {
    const mock = env.OAUTH_MOCK || env.APP_ENV === 'test';
    this.providers = mock
      ? { google: new MockOAuthProvider('google'), apple: new MockOAuthProvider('apple'), facebook: new MockOAuthProvider('facebook') }
      : { google: new GoogleOAuthProvider(env), apple: new AppleOAuthProvider(env), facebook: new FacebookOAuthProvider(env) };
    if (mock) this.logger.warn('OAuth mock providers enabled – never use in production');
  }

  /** Danh sách provider đang bật (web dùng để hiện/ẩn nút) */
  enabledProviders(): OAuthProviderCode[] {
    return OAUTH_PROVIDERS.filter((p) => this.providers[p].enabled());
  }

  async signIn(code: OAuthProviderCode, input: OAuthInput, meta: OAuthMeta): Promise<{ tokens: IssuedTokens; body: AuthTokens & { linked?: boolean; created?: boolean } }> {
    const provider = this.providers[code];
    if (!provider.enabled()) throw new FeatureDisabled(`ff.iam.oauth.${code}`);
    let profile;
    try {
      profile = await provider.verify({ idToken: input.id_token, code: input.code, redirectUri: input.redirect_uri, nonce: input.nonce });
    } catch (err) {
      if (err instanceof OAuthVerificationError) throw new Unauthorized('OAuth verification failed', { provider: code, reason: err.reason });
      throw err;
    }
    const guestId = input.guest_token ? await this.jwt.verifyGuestToken(input.guest_token) : null;
    const email = profile.emailVerified && profile.email ? profile.email.trim().toLowerCase() : null;

    const result = await this.dbs.db.transaction(async (tx) => {
      const identity = await this.users.findIdentity(code, profile.providerUid, tx);
      let userId: string;
      let created = false;
      let linked = false;
      if (identity) {
        userId = identity.userId;
      } else {
        const existing = email ? await this.users.findByEmail(email, tx) : null;
        if (existing) {
          // Yêu cầu xác nhận liên kết (không auto-merge)
          if (existing.passwordHash) {
            if (!input.link_password) throw new Conflict('Account with this email exists; confirm linking with password', { code: 'link_required', provider: code, requires: 'password' });
            const ok = await argon2.verify(existing.passwordHash, input.link_password);
            if (!ok) throw new Unauthorized('Invalid password for account linking', { provider: code });
          } else if (!input.link_confirm) {
            throw new Conflict('Account with this email exists; confirm linking', { code: 'link_required', provider: code, requires: 'confirm' });
          }
          if (existing.status !== 'active') throw new Unauthorized('Account inactive');
          userId = existing.id;
          linked = true;
          await this.audit.log({ action: 'auth.identity_linked', actorUserId: userId, entityType: 'user', entityId: userId, after: { provider: code }, ip: meta.ip, userAgent: meta.userAgent }, tx);
        } else {
          const user = await this.users.createExternalUser(tx, {
            email,
            displayName: input.display_name ?? profile.displayName ?? defaultName(code),
            avatarUrl: profile.avatarUrl,
            uiLocale: input.ui_locale,
          });
          userId = user.id;
          created = true;
          await this.consents.recordSignupConsents(tx, userId, { ip: meta.ip });
          await this.welcome.grant(tx, userId, 'registered');
          if (guestId) await this.merge.mergeGuestInto(tx, guestId, userId, { ip: meta.ip, userAgent: meta.userAgent });
          await this.outbox.write(tx, { aggregateType: 'user', aggregateId: userId, eventType: DOMAIN_EVENTS.USER_REGISTERED, payload: { user_id: userId, provider: code, merged_guest: !!guestId } });
        }
        await this.users.linkIdentity(tx, { userId, provider: code, providerUid: profile.providerUid, email: profile.email, rawProfile: profile.raw });
      }
      const user = await this.users.findById(userId, tx);
      if (!user || user.status !== 'active') throw new Unauthorized('Account inactive');
      if (!created && guestId) await this.merge.mergeGuestInto(tx, guestId, userId, { ip: meta.ip, userAgent: meta.userAgent });
      const roles = await this.users.getRoles(userId, tx);
      const tokens = await this.sessions.create(tx, { id: userId, isGuest: false }, roles, { device: { ...(meta.device ?? {}), ua: meta.userAgent?.slice(0, 200) ?? null, provider: code }, ip: meta.ip });
      return { user, tokens, created, linked };
    });
    const dto = await this.users.toDto(result.user);
    return { tokens: result.tokens, body: { access_token: result.tokens.accessToken, expires_in: result.tokens.expiresIn, user: dto, created: result.created, linked: result.linked } };
  }
}

function defaultName(code: OAuthProviderCode): string {
  return code === 'apple' ? 'Apple user' : code === 'google' ? 'Google user' : 'Facebook user';
}
