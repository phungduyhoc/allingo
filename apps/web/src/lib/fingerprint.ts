/**
 * Dấu vân tay thiết bị cho chống lạm dụng referral (S8, header `X-Device-Fingerprint` ≥ 8 ký tự ở /auth/register,
 * /auth/otp/verify, /auth/oauth/{provider}). KHÔNG chứa PII: băm (SHA-256) các đặc điểm trình duyệt chung (ngôn ngữ, múi giờ,
 * màn hình, số nhân CPU…) + một id ngẫu nhiên lưu localStorage `allingo.device_id`. Server chỉ lưu sha256 của giá trị này.
 * Ổn định giữa các lần tải trang trên cùng trình duyệt; xoá dữ liệu trang → id mới (chấp nhận được – chỉ là tín hiệu phụ).
 */

export const DEVICE_ID_KEY = 'allingo.device_id';

export interface DeviceTraits {
  userAgent: string;
  language: string;
  languages: string;
  timeZone: string;
  screen: string;
  pixelRatio: number;
  cores: number;
  memory: number;
  platform: string;
  touch: number;
}

/** Đặc điểm trình duyệt (không định danh cá nhân); thiếu API → giá trị rỗng */
export function collectTraits(): DeviceTraits {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  const scr = typeof screen !== 'undefined' ? screen : null;
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* ignore */
  }
  return {
    userAgent: nav.userAgent ?? '',
    language: nav.language ?? '',
    languages: (nav.languages ?? []).join(','),
    timeZone,
    screen: scr ? `${scr.width}x${scr.height}x${scr.colorDepth}` : '',
    pixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    cores: nav.hardwareConcurrency ?? 0,
    memory: nav.deviceMemory ?? 0,
    platform: nav.userAgentData?.platform ?? nav.platform ?? '',
    touch: nav.maxTouchPoints ?? 0,
  };
}

/** Chuỗi chuẩn hoá (khoá sắp xếp) để cùng đặc điểm → cùng chuỗi */
export function traitsString(traits: DeviceTraits): string {
  return Object.keys(traits)
    .sort()
    .map((k) => `${k}=${String(traits[k as keyof DeviceTraits])}`)
    .join('|');
}

/** Băm dự phòng khi không có Web Crypto (trang http không an toàn): 2 × cyrb53 → 128 bit hex */
export function fallbackHash(input: string): string {
  const cyrb53 = (str: string, seed: number): string => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };
  return cyrb53(input, 1) + cyrb53(input, 2);
}

/** Dấu vân tay = "fp1." + hex(SHA-256(deviceId | đặc điểm)); thuần, xác định theo đầu vào */
export async function computeFingerprint(traits: DeviceTraits, deviceId: string): Promise<string> {
  const input = `${deviceId}|${traitsString(traits)}`;
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input));
    return `fp1.${Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  return `fp0.${fallbackHash(input)}`;
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let memoryId: string | null = null;

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Id ngẫu nhiên của thiết bị (localStorage, bọc try/catch; bị chặn → id trong bộ nhớ của phiên) */
export function getOrCreateDeviceId(store?: KeyValueStore | null): string {
  let s: KeyValueStore | null = store ?? null;
  if (!s) {
    try {
      s = typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      s = null;
    }
  }
  try {
    const existing = s?.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = randomId();
    s?.setItem(DEVICE_ID_KEY, id);
    if (s) return id;
  } catch {
    /* localStorage bị chặn – dùng id trong bộ nhớ */
  }
  memoryId ??= randomId();
  return memoryId;
}

let cached: Promise<string | null> | null = null;

/** Dấu vân tay của trình duyệt hiện tại (ghi nhớ trong phiên); lỗi → null (không gửi header) */
export function getDeviceFingerprint(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  cached ??= computeFingerprint(collectTraits(), getOrCreateDeviceId()).catch(() => null);
  return cached;
}
