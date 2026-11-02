import type { AttributionInput } from '@allingo/schemas';

/** Dạng lưu iam.users.attribution (v1.1 – S10) – không PII: referrer chỉ còn host, landing_path không query/fragment */
export interface StoredAttribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer_host: string | null;
  landing_path: string | null;
  first_seen_at: string | null;
  captured_at: string;
  /** Kênh suy ra: utm_medium | referral (mã giới thiệu) | organic (referrer máy tìm kiếm) | referrer | direct */
  channel: string;
}

const SEARCH_HOSTS = /(^|\.)(google|bing|yahoo|duckduckgo|coccoc|yandex|baidu)\./i;
/** Ký tự điều khiển + khoảng trắng thừa; giữ chữ Unicode (tên chiến dịch tiếng Việt) */
const clean = (v: string | undefined, max: number): string | null => {
  if (!v) return null;
  const s = [...v]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  // Không lưu thứ trông như email/số điện thoại trong UTM (đôi khi bị gắn nhầm)
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s) || /\+?\d[\d\s.-]{8,}\d/.test(s)) return null;
  return s || null;
};

function hostOf(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().slice(0, 255) || null;
  } catch {
    return null;
  }
}

function pathOf(p: string | undefined): string | null {
  if (!p) return null;
  let path = p.trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return null;
  }
  path = path.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/')) path = `/${path}`;
  return path.slice(0, 256);
}

/**
 * Chuẩn hoá attribution khi tạo tài khoản (lần chạm đầu – không ghi đè). Trả null khi không có thông tin nào ngoài thời điểm
 * (không lưu hàng rỗng). `referralCode` có → kênh `referral`.
 */
export function sanitizeAttribution(input: AttributionInput | undefined | null, opts: { referralCode?: string | null; now?: Date; ownHosts?: string[] } = {}): StoredAttribution | null {
  if (!input && !opts.referralCode) return null;
  const a = input ?? {};
  const host = hostOf(a.referrer);
  const own = (opts.ownHosts ?? []).map((h) => h.toLowerCase());
  const referrerHost = host && !own.includes(host) ? host : null;
  const out: StoredAttribution = {
    utm_source: clean(a.utm_source, 100),
    utm_medium: clean(a.utm_medium, 100),
    utm_campaign: clean(a.utm_campaign, 150),
    utm_term: clean(a.utm_term, 150),
    utm_content: clean(a.utm_content, 150),
    referrer_host: referrerHost,
    landing_path: pathOf(a.landing_path),
    first_seen_at: a.first_seen_at ? new Date(a.first_seen_at).toISOString() : null,
    captured_at: (opts.now ?? new Date()).toISOString(),
    channel: 'direct',
  };
  out.channel = out.utm_medium ? out.utm_medium.toLowerCase() : opts.referralCode ? 'referral' : referrerHost && SEARCH_HOSTS.test(referrerHost) ? 'organic' : referrerHost ? 'referrer' : 'direct';
  const hasInfo = out.utm_source || out.utm_medium || out.utm_campaign || out.referrer_host || out.landing_path || opts.referralCode;
  return hasInfo ? out : null;
}
