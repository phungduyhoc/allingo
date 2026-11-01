import { unwrap } from '@allingo/api-client';
import { getApi } from './api';
import type { AuthTokens, GuestSession, User } from './types';

const GUEST_TOKEN_KEY = 'allingo.guest_token';

/** guest_token lưu localStorage để gửi kèm khi đăng ký/đăng nhập (ghép tiến độ khách) */
export function getGuestToken(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(GUEST_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setGuestToken(token: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (token) window.localStorage.setItem(GUEST_TOKEN_KEY, token);
    else window.localStorage.removeItem(GUEST_TOKEN_KEY);
  } catch {
    /* localStorage có thể bị chặn (private mode) – bỏ qua */
  }
}

/** POST /auth/guest → API đặt cookie allingo_at/allingo_rt; trả user khách (SPEC-ISSUES S4) */
export async function createGuestSession(): Promise<User> {
  const api = getApi();
  const res = unwrap(await api.POST('/auth/guest')) as unknown as GuestSession & Partial<AuthTokens>;
  setGuestToken(res.guest_token);
  return res.user;
}

export async function register(input: { email: string; password: string; display_name: string; ui_locale?: string; accept_terms: boolean; marketing_opt_in?: boolean }): Promise<User> {
  const api = getApi();
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}) };
  const res = unwrap(await api.POST('/auth/register', { body: body as never })) as unknown as AuthTokens;
  setGuestToken(null);
  return res.user;
}

export async function login(input: { email: string; password: string }): Promise<User> {
  const api = getApi();
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}) };
  const res = unwrap(await api.POST('/auth/login', { body: body as never })) as unknown as AuthTokens;
  setGuestToken(null);
  return res.user;
}

export async function logout(): Promise<void> {
  const api = getApi();
  await api.POST('/auth/logout');
  setGuestToken(null);
}

/** OTP qua email: gửi mã (202) – trả thời hạn và thời gian chờ gửi lại */
export async function requestEmailOtp(email: string): Promise<{ retry_after: number; expires_in: number }> {
  const api = getApi();
  const res = unwrap(await api.POST('/auth/otp/request', { body: { email, channel: 'email' } as never })) as unknown as { retry_after: number; expires_in: number };
  return res;
}

/** OTP qua email: xác minh → đăng nhập (tạo tài khoản nếu chưa có), ghép tiến độ khách */
export async function verifyEmailOtp(input: { email: string; otp: string; ui_locale?: string }): Promise<User> {
  const api = getApi();
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}) };
  const res = unwrap(await api.POST('/auth/otp/verify', { body: body as never })) as unknown as AuthTokens;
  setGuestToken(null);
  return res.user;
}

/** Google Identity Services: gửi id_token (credential) – 409 link_required khi email đã có tài khoản mật khẩu */
export async function signInWithGoogle(input: { id_token: string; link_password?: string; ui_locale?: string }): Promise<User> {
  const api = getApi();
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}) };
  const res = unwrap(await api.POST('/auth/oauth/{provider}', { params: { path: { provider: 'google' } }, body: body as never })) as unknown as AuthTokens;
  setGuestToken(null);
  return res.user;
}
