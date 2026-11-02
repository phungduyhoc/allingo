/**
 * Thông báo đẩy (Web Push, Sprint 6) – chuyển `PushPayload` của API thành tham số `showNotification` (thuần – có test,
 * dùng trong service worker). `title`/`body` null → dịch theo `push.<template_code>.title|body` (i18n nhúng lúc build SW).
 * Đường dẫn mở khi bấm chỉ nhận đường dẫn tương đối CÙNG origin; thiếu tiền tố locale → thêm theo `locale` của payload.
 */

export const PUSH_LOCALES = ['vi', 'en'] as const;
export type PushLocale = (typeof PUSH_LOCALES)[number];
export type PushStrings = Record<string, { title: string; body: string } | undefined>;

export interface PushPayloadLike {
  v?: unknown;
  notification_id?: unknown;
  template_code?: unknown;
  title?: unknown;
  body?: unknown;
  url?: unknown;
  tag?: unknown;
  locale?: unknown;
  sent_at?: unknown;
}

export interface NotificationSpec {
  title: string;
  options: {
    body: string;
    tag: string;
    icon: string;
    badge: string;
    lang: string;
    data: { url: string; notification_id: string | null; template_code: string };
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Chuẩn hoá đường dẫn: chỉ "/…" (không "//", không giao thức); thêm /vi|/en nếu thiếu */
export function safePushPath(raw: unknown, locale: PushLocale): string {
  const p = str(raw);
  if (!p || !p.startsWith('/') || p.startsWith('//') || /[\s\\]/.test(p)) return `/${locale}/toeic/dashboard`;
  if (/^\/(vi|en)(\/|$|\?|#)/.test(p)) return p;
  return `/${locale}${p === '/' ? '/toeic/dashboard' : p}`;
}

export function pushLocaleOf(v: unknown): PushLocale {
  const s = str(v)?.slice(0, 2).toLowerCase();
  return (PUSH_LOCALES as readonly string[]).includes(s ?? '') ? (s as PushLocale) : 'vi';
}

/** Dữ liệu `push` (đã parse JSON hoặc chuỗi) → thông báo; payload hỏng → thông báo mặc định "Đến giờ học" */
export function notificationFromPayload(raw: unknown, i18n: Record<PushLocale, PushStrings>): NotificationSpec {
  let p: PushPayloadLike = {};
  if (typeof raw === 'string') {
    try {
      p = JSON.parse(raw) as PushPayloadLike;
    } catch {
      p = { body: raw };
    }
  } else if (raw && typeof raw === 'object') p = raw;
  const locale = pushLocaleOf(p.locale);
  const template = str(p.template_code) ?? 'study_reminder';
  const strings = i18n[locale]?.[template] ??
    i18n[locale]?.study_reminder ??
    i18n.vi?.study_reminder ?? { title: 'Allingo', body: '' };
  return {
    title: str(p.title) ?? strings.title,
    options: {
      body: str(p.body) ?? strings.body,
      tag: str(p.tag) ?? `allingo-${template}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: locale,
      data: { url: safePushPath(p.url, locale), notification_id: str(p.notification_id), template_code: template },
    },
  };
}
