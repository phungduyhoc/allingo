import type { AttributionInput } from '@allingo/schemas';
import { browserStore, type KeyValueStore } from './consent';

/**
 * Attribution lần chạm đầu (S10): UTM + referrer ngoài site + trang đích (không query) + thời điểm, lưu localStorage
 * `allingo.attribution.v1` ở LẦN ĐẦU (không ghi đè) và gửi kèm `attribution` khi đăng ký / OTP / Google – server lưu vào
 * `iam.users.attribution` một lần khi tạo tài khoản (ADR-0033). Không lưu thông tin cá nhân: giá trị UTM giống email/số điện
 * thoại bị bỏ; referrer chỉ giữ origin; landing_path bỏ query/hash. Lưu cục bộ, chỉ rời trình duyệt cùng yêu cầu đăng ký.
 */

export const ATTRIBUTION_KEY = 'allingo.attribution.v1';
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const MAX: Record<(typeof UTM)[number], number> = { utm_source: 100, utm_medium: 100, utm_campaign: 150, utm_term: 150, utm_content: 150 };
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+?\d[\s.-]?){8,}/;

/** Giá trị UTM an toàn: cắt độ dài, bỏ nếu giống email/số điện thoại */
export function cleanUtm(v: string | null, max: number): string | undefined {
  const s = v?.trim();
  if (!s || EMAIL_RE.test(s) || PHONE_RE.test(s)) return undefined;
  return s.slice(0, max);
}

/** Từ URL hiện tại + document.referrer → attribution (thuần, có test) */
export function attributionFromLocation(href: string, referrer: string, now = new Date()): AttributionInput {
  const url = new URL(href);
  const out: AttributionInput = { landing_path: url.pathname.slice(0, 512), first_seen_at: now.toISOString() };
  for (const k of UTM) {
    const v = cleanUtm(url.searchParams.get(k), MAX[k]);
    if (v) out[k] = v;
  }
  if (referrer) {
    try {
      const ref = new URL(referrer);
      // Chỉ nguồn ngoài site (điều hướng nội bộ không phải "nguồn")
      if (ref.host && ref.host !== url.host && /^https?:$/.test(ref.protocol)) out.referrer = ref.origin.slice(0, 2048);
    } catch {
      /* referrer không phải URL */
    }
  }
  return out;
}

export function readAttribution(store: KeyValueStore | null = browserStore()): AttributionInput | null {
  try {
    const raw = store?.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as AttributionInput;
    return v && typeof v === 'object' && typeof v.first_seen_at === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Ghi attribution nếu CHƯA có (lần chạm đầu thắng). Trả bản đang lưu. */
export function captureAttribution(href: string, referrer: string, store: KeyValueStore | null = browserStore(), now = new Date()): AttributionInput | null {
  const existing = readAttribution(store);
  if (existing) return existing;
  const a = attributionFromLocation(href, referrer, now);
  try {
    store?.setItem(ATTRIBUTION_KEY, JSON.stringify(a));
  } catch {
    /* bỏ qua */
  }
  return a;
}

/** Trường `attribution` cho thân register/otp verify/oauth (rỗng khi chưa có) */
export function attributionField(store: KeyValueStore | null = browserStore()): { attribution?: AttributionInput } {
  const a = readAttribution(store);
  return a ? { attribution: a } : {};
}
