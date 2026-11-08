/**
 * Biến môi trường public của web (NEXT_PUBLIC_*). Kiểm tra lúc nạp module; Next inline giá trị tại build nên phải đọc từng biến
 * tường minh (không dùng process.env[key]). S10: kiểm tra thủ công (không dùng Zod) để mọi trang – kể cả landing – không phải tải
 * thư viện Zod chỉ vì cấu hình (giảm JS client).
 */

function url(name: string, value: string | undefined, fallback: string): string {
  const v = value || fallback;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    return v.replace(/\/$/, '');
  } catch {
    throw new Error(`Invalid NEXT_PUBLIC_* environment: ${name} must be an http(s) URL`);
  }
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = value || fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`Invalid NEXT_PUBLIC_* environment: ${name} must be one of ${allowed.join(', ')}`);
  return v as T;
}

/** URL https tuỳ chọn (link cộng đồng) – trống/sai → null (ẩn link, không làm hỏng trang) */
function optionalHttps(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function rate(value: string | undefined): number {
  const n = value ? Number(value) : 1;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

export const env = {
  apiUrl: url('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL, 'http://localhost:4000/v1'),
  appUrl: url('NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000'),
  defaultLocale: oneOf('NEXT_PUBLIC_DEFAULT_LOCALE', process.env.NEXT_PUBLIC_DEFAULT_LOCALE, ['vi', 'en'] as const, 'vi'),
  /** '1' → dùng fetch giả lập (src/mock) thay cho API thật; mặc định tắt */
  apiMock: oneOf('NEXT_PUBLIC_API_MOCK', process.env.NEXT_PUBLIC_API_MOCK, ['0', '1'] as const, '0') === '1',
  /** Google Identity Services client id – trống thì ẩn nút Google */
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null,
  /** S11: Sentry web (không SDK – lib/telemetry/sentry.ts); trống → tắt báo lỗi + Web Vitals RUM */
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || null,
  sentryEnvironment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  sentryRelease: process.env.NEXT_PUBLIC_SENTRY_RELEASE || (process.env.NEXT_PUBLIC_GIT_SHA ? `allingo-web@${process.env.NEXT_PUBLIC_GIT_SHA}` : 'allingo-web@0.1.0'),
  /** Tỉ lệ lấy mẫu lỗi / Web Vitals (0–1, mặc định 1) */
  sentrySampleRate: rate(process.env.NEXT_PUBLIC_SENTRY_SAMPLE_RATE),
  sentryVitalsSampleRate: rate(process.env.NEXT_PUBLIC_SENTRY_VITALS_SAMPLE_RATE),
  /** S12: kênh phản hồi cộng đồng beta (nhóm Zalo / Discord) – trống thì ẩn */
  communityZaloUrl: optionalHttps(process.env.NEXT_PUBLIC_COMMUNITY_ZALO_URL),
  communityDiscordUrl: optionalHttps(process.env.NEXT_PUBLIC_COMMUNITY_DISCORD_URL),
} as const;
