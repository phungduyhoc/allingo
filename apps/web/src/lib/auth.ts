import { unwrap } from '@allingo/api-client';
import { getApi } from './api';
import { getDeviceFingerprint } from './fingerprint';
import { clearReferral, getPendingReferral } from './referral';
import { attributionField } from './analytics/attribution';
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

const FP_BLOCKED_KEY = 'allingo.fp_header_blocked';

function fpHeaderBlocked(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(FP_BLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function markFpHeaderBlocked(): void {
  try {
    window.sessionStorage.setItem(FP_BLOCKED_KEY, '1');
  } catch {
    /* bỏ qua */
  }
}

/**
 * Mã giới thiệu đang chờ (link `/register?ref=`) – gửi kèm khi tạo tài khoản (đăng ký, OTP, OAuth). S10: kèm `attribution`
 * lần chạm đầu (UTM/referrer/trang đích – lib/analytics/attribution); server chỉ lưu khi TẠO tài khoản, đăng nhập lại bỏ qua.
 */
function referralField(): { referral_code?: string } {
  const ref = getPendingReferral();
  return ref ? { referral_code: ref.code } : {};
}

type AuthPath = '/auth/register' | '/auth/otp/verify' | '/auth/oauth/{provider}';

/**
 * POST xác thực kèm `X-Device-Fingerprint` (S8 – chống lạm dụng referral). Nếu trình duyệt chặn header ở preflight CORS
 * (API chưa khai báo header trong `allowedHeaders`) thì fetch ném TypeError TRƯỚC khi request được gửi → gửi lại không header
 * và nhớ trong phiên để không thử lại (header là tín hiệu phụ, không được làm hỏng đăng ký).
 */
async function authPost(path: AuthPath, init: { body: unknown; params?: unknown }): Promise<AuthTokens> {
  const api = getApi();
  const fp = fpHeaderBlocked() ? null : await getDeviceFingerprint();
  const call = (headers?: Record<string, string>) => api.POST(path as '/auth/register', { ...(init as object), body: init.body as never, ...(headers ? { headers } : {}) });
  if (fp) {
    try {
      return unwrap(await call({ 'X-Device-Fingerprint': fp })) as unknown as AuthTokens;
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      markFpHeaderBlocked();
    }
  }
  return unwrap(await call()) as unknown as AuthTokens;
}

/** POST /auth/guest → API đặt cookie allingo_at/allingo_rt; trả user khách (SPEC-ISSUES S4) */
export async function createGuestSession(): Promise<User> {
  const api = getApi();
  const res = unwrap(await api.POST('/auth/guest')) as unknown as GuestSession & Partial<AuthTokens>;
  setGuestToken(res.guest_token);
  return res.user;
}

export async function register(input: { email: string; password: string; display_name: string; ui_locale?: string; accept_terms: boolean; marketing_opt_in?: boolean }): Promise<User> {
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}), ...referralField(), ...attributionField() };
  const res = await authPost('/auth/register', { body });
  setGuestToken(null);
  clearReferral();
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
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}), ...referralField(), ...attributionField() };
  const res = await authPost('/auth/otp/verify', { body });
  setGuestToken(null);
  clearReferral();
  return res.user;
}

/** Google Identity Services: gửi id_token (credential) – 409 link_required khi email đã có tài khoản mật khẩu */
export async function signInWithGoogle(input: { id_token: string; link_password?: string; ui_locale?: string }): Promise<User> {
  const guest = getGuestToken();
  const body = { ...input, ...(guest ? { guest_token: guest } : {}), ...referralField(), ...attributionField() };
  const res = await authPost('/auth/oauth/{provider}', { params: { path: { provider: 'google' } }, body });
  setGuestToken(null);
  clearReferral();
  return res.user;
}
