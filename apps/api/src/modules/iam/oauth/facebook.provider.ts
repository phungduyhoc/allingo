import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../../../config/env.js';
import { fetchJson, OAuthVerificationError, type OAuthProfile, type OAuthProvider, type OAuthVerifyInput } from './oauth-provider.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const JWKS_URL = 'https://www.facebook.com/.well-known/oauth/openid/jwks/';
const ISSUER = 'https://www.facebook.com';

interface FbClaims extends JWTPayload {
  email?: string;
  name?: string;
  picture?: string;
  nonce?: string;
}

/**
 * Facebook Login: (a) OIDC id_token (Limited Login iOS / JS SDK với openid) xác minh bằng JWKS;
 * (b) code (web redirect) → access token → /me (email, name, picture). Access token không lưu DB.
 */
export class FacebookOAuthProvider implements OAuthProvider {
  readonly code = 'facebook' as const;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly env: Pick<Env, 'FACEBOOK_CLIENT_ID' | 'FACEBOOK_CLIENT_SECRET'>) {}

  enabled(): boolean {
    return !!this.env.FACEBOOK_CLIENT_ID;
  }

  async verify(input: OAuthVerifyInput): Promise<OAuthProfile> {
    if (input.idToken) {
      this.jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
      let claims: FbClaims;
      try {
        const r = await jwtVerify(input.idToken, this.jwks, { issuer: ISSUER, audience: this.env.FACEBOOK_CLIENT_ID!, algorithms: ['RS256'] });
        claims = r.payload;
      } catch (err) {
        throw new OAuthVerificationError((err as Error).message, 'invalid_token');
      }
      if (input.nonce && claims.nonce !== input.nonce) throw new OAuthVerificationError('nonce mismatch', 'nonce_mismatch');
      if (!claims.sub) throw new OAuthVerificationError('sub missing', 'invalid_token');
      return { provider: 'facebook', providerUid: claims.sub, email: claims.email ?? null, emailVerified: !!claims.email, displayName: claims.name ?? null, avatarUrl: claims.picture ?? null, raw: { sub: claims.sub } };
    }
    if (!input.code) throw new OAuthVerificationError('id_token or code required', 'missing_token');
    if (!this.env.FACEBOOK_CLIENT_SECRET) throw new OAuthVerificationError('code flow needs FACEBOOK_CLIENT_SECRET', 'code_flow_disabled');
    const q = new URLSearchParams({ client_id: this.env.FACEBOOK_CLIENT_ID!, client_secret: this.env.FACEBOOK_CLIENT_SECRET, code: input.code, redirect_uri: input.redirectUri ?? '' });
    const tok = await fetchJson<{ access_token?: string }>(`${GRAPH}/oauth/access_token?${q.toString()}`);
    if (!tok.access_token) throw new OAuthVerificationError('access_token missing', 'invalid_token');
    // Xác minh token thuộc app của mình
    const dbg = await fetchJson<{ data?: { app_id?: string; is_valid?: boolean; user_id?: string } }>(`${GRAPH}/debug_token?input_token=${encodeURIComponent(tok.access_token)}&access_token=${this.env.FACEBOOK_CLIENT_ID}|${this.env.FACEBOOK_CLIENT_SECRET}`);
    if (!dbg.data?.is_valid || dbg.data.app_id !== this.env.FACEBOOK_CLIENT_ID) throw new OAuthVerificationError('token not valid for this app', 'invalid_token');
    const me = await fetchJson<{ id: string; name?: string; email?: string; picture?: { data?: { url?: string } } }>(`${GRAPH}/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(tok.access_token)}`);
    return { provider: 'facebook', providerUid: me.id, email: me.email ?? null, emailVerified: !!me.email, displayName: me.name ?? null, avatarUrl: me.picture?.data?.url ?? null, raw: { sub: me.id } };
  }
}
