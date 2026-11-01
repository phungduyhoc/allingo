import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Env } from '../../../config/env.js';
import { fetchJson, OAuthVerificationError, type OAuthProfile, type OAuthProvider, type OAuthVerifyInput } from './oauth-provider.js';

const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const ISSUER = 'https://appleid.apple.com';

interface AppleClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean | 'true' | 'false';
  is_private_email?: boolean | 'true' | 'false';
  nonce?: string;
}

/**
 * Sign in with Apple: id_token (native/JS SDK) hoặc code (web redirect). Tên chỉ có ở lần đầu, client gửi display_name.
 * client_secret cho code flow là JWT ES256 ký bằng APPLE_PRIVATE_KEY (p8) – hoặc đặt sẵn APPLE_CLIENT_SECRET.
 */
export class AppleOAuthProvider implements OAuthProvider {
  readonly code = 'apple' as const;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly env: Pick<Env, 'APPLE_CLIENT_ID' | 'APPLE_CLIENT_SECRET' | 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY'>) {}

  enabled(): boolean {
    return !!this.env.APPLE_CLIENT_ID;
  }

  private async clientSecret(): Promise<string> {
    if (this.env.APPLE_CLIENT_SECRET) return this.env.APPLE_CLIENT_SECRET;
    if (!this.env.APPLE_TEAM_ID || !this.env.APPLE_KEY_ID || !this.env.APPLE_PRIVATE_KEY) throw new OAuthVerificationError('apple code flow needs APPLE_CLIENT_SECRET or TEAM_ID/KEY_ID/PRIVATE_KEY', 'code_flow_disabled');
    const key = await importPKCS8(this.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.env.APPLE_KEY_ID })
      .setIssuer(this.env.APPLE_TEAM_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setAudience(ISSUER)
      .setSubject(this.env.APPLE_CLIENT_ID!)
      .sign(key);
  }

  async verify(input: OAuthVerifyInput): Promise<OAuthProfile> {
    let idToken = input.idToken;
    if (!idToken && input.code) {
      const body = new URLSearchParams({
        code: input.code,
        client_id: this.env.APPLE_CLIENT_ID!,
        client_secret: await this.clientSecret(),
        grant_type: 'authorization_code',
        ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
      });
      const tok = await fetchJson<{ id_token?: string }>(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      idToken = tok.id_token;
    }
    if (!idToken) throw new OAuthVerificationError('id_token missing', 'missing_token');
    this.jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    let claims: AppleClaims;
    try {
      const r = await jwtVerify(idToken, this.jwks, { issuer: ISSUER, audience: this.env.APPLE_CLIENT_ID!, algorithms: ['RS256'] });
      claims = r.payload;
    } catch (err) {
      throw new OAuthVerificationError((err as Error).message, 'invalid_token');
    }
    if (input.nonce && claims.nonce !== input.nonce) throw new OAuthVerificationError('nonce mismatch', 'nonce_mismatch');
    if (!claims.sub) throw new OAuthVerificationError('sub missing', 'invalid_token');
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    return {
      provider: 'apple',
      providerUid: claims.sub,
      email: claims.email ?? null,
      emailVerified: verified,
      displayName: null,
      avatarUrl: null,
      raw: { sub: claims.sub, is_private_email: claims.is_private_email ?? null },
    };
  }
}
