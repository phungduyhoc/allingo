import type { OAuthProviderCode } from '@allingo/schemas';
import { OAuthVerificationError, type OAuthProfile, type OAuthProvider, type OAuthVerifyInput } from './oauth-provider.js';

/**
 * Provider giả lập cho dev/test (OAUTH_MOCK=true hoặc APP_ENV=test): id_token = `mock:<uid>:<email>:<name>[:unverified]`.
 * Dùng cho test tích hợp liên kết tài khoản mà không cần mạng.
 */
export class MockOAuthProvider implements OAuthProvider {
  constructor(readonly code: OAuthProviderCode) {}

  enabled(): boolean {
    return true;
  }

  async verify(input: OAuthVerifyInput): Promise<OAuthProfile> {
    const token = input.idToken ?? input.code;
    if (!token?.startsWith('mock:')) throw new OAuthVerificationError('mock token must start with mock:', 'invalid_token');
    const [, uid, email, name, flag] = token.split(':');
    if (!uid) throw new OAuthVerificationError('uid missing', 'invalid_token');
    return {
      provider: this.code,
      providerUid: uid,
      email: email || null,
      emailVerified: !!email && flag !== 'unverified',
      displayName: name || null,
      avatarUrl: null,
      raw: { sub: uid, mock: true },
    };
  }
}
