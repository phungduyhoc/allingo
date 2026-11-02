/**
 * Trạng thái cài PWA (A2HS): bắt `beforeinstallprompt` sớm (module nạp cùng layout gốc), đếm lượt truy cập để chỉ gợi ý
 * cài sau 2 lần (FR-PWA), nhớ "Để sau" 14 ngày. iOS Safari không có sự kiện → hướng dẫn "Thêm vào MH chính".
 * Mọi truy cập storage bọc try/catch (private mode, storage bị chặn).
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export const VISITS_KEY = 'allingo.pwa.visits';
export const DISMISSED_KEY = 'allingo.pwa.dismissed';
const SESSION_KEY = 'allingo.pwa.counted';
export const MIN_VISITS = 2;
export const SNOOZE_MS = 14 * 24 * 3600_000;

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export const installStore = {
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getSnapshot: () => deferred,
  getServerSnapshot: (): BeforeInstallPromptEvent | null => null,
  isInstalled: () => installed,
  prompt: async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const ev = deferred;
    if (!ev) return 'unavailable';
    deferred = null;
    emit();
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice.outcome;
  },
};

function read(key: string, storage: () => Storage): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string, storage: () => Storage): void {
  try {
    storage().setItem(key, value);
  } catch {
    /* bỏ qua */
  }
}

/** Đếm một lượt truy cập mỗi phiên trình duyệt; trả tổng số lượt */
export function countVisit(): number {
  if (typeof window === 'undefined') return 0;
  const n = Number(read(VISITS_KEY, () => window.localStorage)) || 0;
  if (read(SESSION_KEY, () => window.sessionStorage)) return n;
  write(SESSION_KEY, '1', () => window.sessionStorage);
  write(VISITS_KEY, String(n + 1), () => window.localStorage);
  return n + 1;
}

export function snoozeInstall(now = Date.now()): void {
  if (typeof window !== 'undefined') write(DISMISSED_KEY, String(now), () => window.localStorage);
}

export function isSnoozed(now = Date.now()): boolean {
  if (typeof window === 'undefined') return true;
  const at = Number(read(DISMISSED_KEY, () => window.localStorage)) || 0;
  return at > 0 && now - at < SNOOZE_MS;
}

/** iPhone/iPad Safari (kể cả iPadOS báo là Mac có cảm ứng) */
export function isIosSafari(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Quyết định hiển thị banner (thuần – có test) */
export function shouldShowInstall(input: {
  visits: number;
  snoozed: boolean;
  standalone: boolean;
  hasPrompt: boolean;
  ios: boolean;
}): 'prompt' | 'ios' | null {
  if (input.standalone || input.snoozed || input.visits < MIN_VISITS) return null;
  if (input.hasPrompt) return 'prompt';
  if (input.ios) return 'ios';
  return null;
}
