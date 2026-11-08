/**
 * Đồng ý cookie phân tích (S10, PDPL – Nghị định 13/2023): mặc định KHÔNG đo; chỉ khi người học bấm "Đồng ý" mới gửi sự kiện
 * phễu (`POST /analytics/events`, `consent: true`) và tạo id ẩn danh. Lựa chọn lưu localStorage `allingo.consent.v1`
 * (`{analytics, at, v}`), đổi lại được ở chân trang ("Cài đặt cookie"). Rút lại đồng ý → xoá id ẩn danh.
 * Script khởi động (`CONSENT_BOOT_SCRIPT`, chạy trước khi vẽ) đặt `html[data-consent]` khi đã có lựa chọn → CSS ẩn banner ngay
 * từ HTML tĩnh (không nháy, không CLS). Mọi truy cập storage bọc try/catch (chế độ riêng tư → coi như chưa chọn).
 */

export const CONSENT_KEY = 'allingo.consent.v1';
export const ANON_ID_KEY = 'allingo.anon_id';
export const CONSENT_VERSION = 1;
/** Sự kiện window: lựa chọn thay đổi (detail = ConsentState) */
export const CONSENT_EVENT = 'allingo:consent';
/** Sự kiện window: mở lại banner (nút ở chân trang) */
export const CONSENT_OPEN_EVENT = 'allingo:consent-open';

export interface ConsentState {
  analytics: boolean;
  at: string;
  v: number;
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof v?.analytics !== 'boolean' || typeof v.at !== 'string') return null;
    // Phiên bản chính sách cũ → hỏi lại
    if (v.v !== CONSENT_VERSION) return null;
    return { analytics: v.analytics, at: v.at, v: v.v };
  } catch {
    return null;
  }
}

export function readConsent(store: KeyValueStore | null = browserStore()): ConsentState | null {
  try {
    return parseConsent(store?.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

export function hasAnalyticsConsent(store: KeyValueStore | null = browserStore()): boolean {
  return readConsent(store)?.analytics === true;
}

export function writeConsent(analytics: boolean, store: KeyValueStore | null = browserStore(), now = new Date()): ConsentState {
  const state: ConsentState = { analytics, at: now.toISOString(), v: CONSENT_VERSION };
  try {
    store?.setItem(CONSENT_KEY, JSON.stringify(state));
    if (!analytics) store?.removeItem(ANON_ID_KEY);
  } catch {
    /* storage không dùng được – lựa chọn chỉ có hiệu lực trong trang này */
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.consent = analytics ? 'analytics' : 'necessary';
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: state }));
  return state;
}

/** id ẩn danh cho phễu trước đăng nhập – CHỈ tạo khi đã đồng ý; không chứa thông tin cá nhân */
export function anonymousId(store: KeyValueStore | null = browserStore(), random: () => string = randomId): string | null {
  if (!hasAnalyticsConsent(store)) return null;
  try {
    const cur = store?.getItem(ANON_ID_KEY);
    if (cur && /^[A-Za-z0-9_-]{8,64}$/.test(cur)) return cur;
    const id = random();
    store?.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    return random();
  }
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Chạy inline trong <body> trước banner: đã có lựa chọn → html[data-consent] (CSS ẩn banner trước khi vẽ) */
export const CONSENT_BOOT_SCRIPT = `try{var c=JSON.parse(localStorage.getItem(${JSON.stringify(CONSENT_KEY)})||'null');if(c&&c.v===${CONSENT_VERSION}&&typeof c.analytics==='boolean')document.documentElement.dataset.consent=c.analytics?'analytics':'necessary'}catch(e){}`;
