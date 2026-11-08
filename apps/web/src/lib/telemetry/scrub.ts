/**
 * Che dữ liệu cá nhân/bí mật trước khi gửi báo lỗi/RUM từ trình duyệt (S11; CLAUDE.md §9). Cùng quy tắc với
 * `apps/api/src/shared/telemetry/redact.ts`: theo TÊN KHOÁ (password, token, email, phone…) và theo GIÁ TRỊ chuỗi (email, số điện
 * thoại VN, JWT, `Bearer …`, tham số query nhạy cảm). Không phụ thuộc thư viện.
 */
export const REDACTED = '[redacted]';
const MAX_DEPTH = 6;
const MAX_ARRAY = 30;
const MAX_STRING = 2000;

const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'linkpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'guesttoken',
  'credential',
  'authorization',
  'cookie',
  'cookies',
  'otp',
  'otpcode',
  'code',
  'email',
  'phone',
  'phonenumber',
  'mobile',
  'taxcode',
  'buyertaxcode',
  'buyeremail',
  'buyername',
  'buyeraddress',
  'address',
  'fullname',
  'displayname',
  'secret',
  'signature',
  'apikey',
  'body',
  'note',
  'essaytext',
  'transcript',
  'answers',
]);

const norm = (k: string) => k.toLowerCase().replace(/[_-]/g, '');
export const isSensitiveKey = (key: string) => SENSITIVE_KEYS.has(norm(key));

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w.-])(?:\+?84|0)(?:[\s.-]?\d){9,10}(?!\w)/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const QUERY_SECRET_RE = /([?&;#](?:access_token|refresh_token|id_token|token|code|otp|secret|signature|sig|password|key|email|phone|ref)=)[^&#\s"']+/gi;

/** Che email/phone/JWT/Bearer/tham số bí mật trong một chuỗi (cắt ≤ 2.000 ký tự) */
export function scrubString(s: string): string {
  const v = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  if (v.length < 6) return v;
  return v.replace(JWT_RE, '[jwt]').replace(BEARER_RE, '$1 [redacted]').replace(QUERY_SECRET_RE, '$1[redacted]').replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}

/** Bản sao đã che của giá trị bất kỳ (không sửa gốc; vòng tham chiếu → `[circular]`) */
export function scrubDeep<T>(value: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value) as T;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]' as T;
  if (seen.has(value)) return '[circular]' as T;
  seen.add(value);
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => scrubDeep(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) arr.push(`[+${value.length - MAX_ARRAY} more]`);
    return arr as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) && v !== null && v !== undefined && v !== '' ? REDACTED : scrubDeep(v, depth + 1, seen);
  }
  return out as T;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * URL an toàn để gửi đi: bỏ query + hash (token quản lý thông báo, `?next=`, mã giới thiệu…), id (uuid, số dài, mã) → `:id`.
 * `/vi/attempts/3f…/review?focus=…` → `/vi/attempts/:id/review`.
 */
export function scrubUrl(url: string): string {
  let path = url;
  try {
    const u = new URL(url, 'http://x');
    path = (/^https?:\/\//.test(url) ? u.origin : '') + u.pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? '';
  }
  return path.replace(UUID_RE, ':id').replace(/\/\d{4,}(?=\/|$)/g, '/:id').replace(/\/(r|referrals)\/[^/]+/g, '/$1/:code');
}
