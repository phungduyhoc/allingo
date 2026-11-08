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

export const env = {
  apiUrl: url('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL, 'http://localhost:4000/v1'),
  appUrl: url('NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000'),
  defaultLocale: oneOf('NEXT_PUBLIC_DEFAULT_LOCALE', process.env.NEXT_PUBLIC_DEFAULT_LOCALE, ['vi', 'en'] as const, 'vi'),
  /** '1' → dùng fetch giả lập (src/mock) thay cho API thật; mặc định tắt */
  apiMock: oneOf('NEXT_PUBLIC_API_MOCK', process.env.NEXT_PUBLIC_API_MOCK, ['0', '1'] as const, '0') === '1',
  /** Google Identity Services client id – trống thì ẩn nút Google */
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null,
} as const;
