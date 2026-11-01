import type { OAuthProviderCode } from '@allingo/schemas';

/** Hồ sơ đã xác minh từ nhà cung cấp (không log) */
export interface OAuthProfile {
  provider: OAuthProviderCode;
  providerUid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  /** raw_profile lưu DB (đã lược: không access token) */
  raw: Record<string, unknown>;
}

export interface OAuthVerifyInput {
  idToken?: string;
  code?: string;
  redirectUri?: string;
  nonce?: string;
}

/**
 * Adapter theo nhà cung cấp (ADR-0022): xác minh id_token (JWKS) hoặc đổi code lấy token rồi xác minh.
 * Thiếu env → enabled() = false; API trả feature_disabled, web ẩn nút.
 */
export interface OAuthProvider {
  readonly code: OAuthProviderCode;
  enabled(): boolean;
  verify(input: OAuthVerifyInput): Promise<OAuthProfile>;
}

export class OAuthVerificationError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'OAuthVerificationError';
  }
}

/** fetch có timeout cho các lời gọi tới nhà cung cấp */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string };
    if (!res.ok) throw new OAuthVerificationError(`provider responded ${res.status}`, typeof body.error === 'string' ? body.error : 'provider_error');
    return body;
  } finally {
    clearTimeout(timer);
  }
}
