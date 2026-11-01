import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../../../config/env.js';
import { fetchJson, OAuthVerificationError, type OAuthProfile, type OAuthProvider, type OAuthVerifyInput } from './oauth-provider.js';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface GoogleClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
}

/** Google Identity Services: client gửi id_token (One Tap / GIS) hoặc authorization code (redirect flow). */
export class GoogleOAuthProvider implements OAuthProvider {
  readonly code = 'google' as const;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {}

  enabled(): boolean {
    return !!this.env.GOOGLE_CLIENT_ID;
  }

  async verify(input: OAuthVerifyInput): Promise<OAuthProfile> {
    let idToken = input.idToken;
    if (!idToken && input.code) {
      if (!this.env.GOOGLE_CLIENT_SECRET) throw new OAuthVerificationError('code flow needs GOOGLE_CLIENT_SECRET', 'code_flow_disabled');
      const body = new URLSearchParams({
        code: input.code,
        client_id: this.env.GOOGLE_CLIENT_ID!,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: input.redirectUri ?? 'postmessage',
        grant_type: 'authorization_code',
      });
      const tok = await fetchJson<{ id_token?: string }>(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      idToken = tok.id_token;
    }
    if (!idToken) throw new OAuthVerificationError('id_token missing', 'missing_token');
    this.jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    let claims: GoogleClaims;
    try {
      const r = await jwtVerify(idToken, this.jwks, { issuer: ISSUERS, audience: this.env.GOOGLE_CLIENT_ID!, algorithms: ['RS256'] });
      claims = r.payload;
    } catch (err) {
      throw new OAuthVerificationError((err as Error).message, 'invalid_token');
    }
    if (input.nonce && claims.nonce !== input.nonce) throw new OAuthVerificationError('nonce mismatch', 'nonce_mismatch');
    if (!claims.sub) throw new OAuthVerificationError('sub missing', 'invalid_token');
    return {
      provider: 'google',
      providerUid: claims.sub,
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true,
      displayName: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
      raw: { sub: claims.sub, email_verified: claims.email_verified ?? null, hd: (claims as { hd?: string }).hd ?? null },
    };
  }
}
