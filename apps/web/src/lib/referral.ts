/**
 * Mã giới thiệu từ link chia sẻ (S8): `/register?ref=<code>&utm_*` (API `/r/{code}` chuyển hướng tới đây). Lưu localStorage
 * `allingo.referral` (30 ngày) để người dùng đi vòng qua trang khác/đăng nhập OTP/Google vẫn gửi được `referral_code`
 * khi tạo tài khoản. UTM chỉ giữ để hiển thị/đo lường phía web (hợp đồng đăng ký không có trường UTM).
 */

export const REFERRAL_STORAGE_KEY = 'allingo.referral';
const TTL_MS = 30 * 86_400_000;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export interface PendingReferral {
  code: string;
  utm: Partial<Record<(typeof UTM_KEYS)[number], string>>;
  captured_at: string;
}

/** Đọc `ref` (+ UTM) từ query; mã hợp lệ: 4–32 ký tự chữ/số (chuẩn hoá in hoa) */
export function parseReferralParams(search: string | URLSearchParams, now = new Date()): PendingReferral | null {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  const raw = (params.get('ref') ?? '').trim();
  if (!/^[A-Za-z0-9]{4,32}$/.test(raw)) return null;
  const utm: PendingReferral['utm'] = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) utm[k] = v.slice(0, 100);
  }
  return { code: raw.toUpperCase(), utm, captured_at: now.toISOString() };
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveReferral(ref: PendingReferral): void {
  try {
    storage()?.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(ref));
  } catch {
    /* bỏ qua */
  }
}

/** Mã đang chờ dùng khi đăng ký (hết hạn sau 30 ngày → null) */
export function getPendingReferral(now = Date.now()): PendingReferral | null {
  try {
    const raw = storage()?.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingReferral;
    if (!v?.code || now - Date.parse(v.captured_at) > TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  try {
    storage()?.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* bỏ qua */
  }
}
