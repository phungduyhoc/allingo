/**
 * Che dữ liệu cá nhân/bí mật trong log, trace và báo lỗi (CLAUDE.md §9; S11).
 *
 * Hai lớp:
 *  1) theo TÊN KHOÁ (không phân biệt hoa thường, bỏ `_`/`-`): password, token, cookie, authorization, otp, email, phone,
 *     tax_code, secret, signature… ở mọi độ sâu (≤ MAX_DEPTH) → `[redacted]`;
 *  2) theo GIÁ TRỊ chuỗi: email, số điện thoại VN, JWT, `Bearer …`, tham số query nhạy cảm trong URL → nhãn thay thế.
 * Dùng chung cho pino (formatters.log + hooks.logMethod) và ErrorReporter (Sentry) – không phụ thuộc thư viện.
 */
export const REDACTED = '[redacted]';
const MAX_DEPTH = 8;
const MAX_ARRAY = 50;

/** Tên khoá đã chuẩn hoá (lowercase, bỏ `_` `-`) coi là nhạy cảm */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'guesttoken',
  'turnstiletoken',
  'csrftoken',
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'xinternaltoken',
  'xcsrftoken',
  'otp',
  'otpcode',
  'email',
  'useremail',
  'buyeremail',
  'phone',
  'phonenumber',
  'mobile',
  'taxcode',
  'buyertaxcode',
  'secret',
  'clientsecret',
  'apikey',
  'privatekey',
  'hashsecret',
  'secretkey',
  'accesskey',
  'signature',
  'vnpsecurehash',
  'mac',
  'cardnumber',
  'pan',
  'cvv',
  'essaytext',
  'transcript',
  'answers',
  'address',
  'buyername',
  'buyeraddress',
  'fullname',
  'dob',
  'dateofbirth',
]);

const norm = (k: string) => k.toLowerCase().replace(/[_-]/g, '');

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(norm(key));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Số điện thoại VN: +84 / 84 / 0 + 9–10 chữ số (cho phép dấu cách/chấm/gạch giữa nhóm)
const PHONE_RE = /(?<![\w.-])(?:\+?84|0)(?:[\s.-]?\d){9,10}(?![\w])/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// key=value trong URL/query/form: token, code, otp, secret, signature, password…
const QUERY_SECRET_RE = /([?&;](?:access_token|refresh_token|id_token|token|code|otp|secret|signature|sig|password|vnp_SecureHash|mac|key)=)[^&#\s"']+/gi;

/** Che email/phone/JWT/Bearer/tham số bí mật trong một chuỗi */
export function redactString(s: string): string {
  if (s.length < 6) return s;
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret – đây là bộ che bí mật (thay token/secret bằng nhãn), không chứa bí mật
  return s.replace(JWT_RE, '[jwt]').replace(BEARER_RE, '$1 [redacted]').replace(QUERY_SECRET_RE, '$1[redacted]').replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}

/**
 * Bản sao đã che của một giá trị bất kỳ (object/array/Error/chuỗi). Không sửa đối tượng gốc; vòng tham chiếu → `[circular]`.
 * Error: giữ `name`, `message` (đã che), `stack` (đã che), `code`, `statusCode`.
 */
export function redactDeep<T>(value: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value) as T;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]' as T;
  if (seen.has(value)) return '[circular]' as T;
  seen.add(value);
  if (value instanceof Error) {
    const e = value as Error & { code?: unknown; statusCode?: unknown; cause?: unknown };
    const out: Record<string, unknown> = { type: e.name, message: redactString(e.message ?? '') };
    if (e.stack) out.stack = redactString(e.stack);
    if (e.code !== undefined) out.code = e.code;
    if (e.statusCode !== undefined) out.statusCode = e.statusCode;
    if (e.cause !== undefined) out.cause = redactDeep(e.cause, depth + 1, seen);
    return out as T;
  }
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}B]` as T;
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => redactDeep(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) arr.push(`[+${value.length - MAX_ARRAY} more]`);
    return arr as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) && v !== null && v !== undefined && v !== '' ? REDACTED : redactDeep(v, depth + 1, seen);
  }
  return out as T;
}
