import { type NotificationItem } from '@allingo/schemas/api/billing';
import { type NotificationTemplateCode } from '@allingo/schemas/api/growth';
import { pickLocalized, type LocalizedText } from '@allingo/schemas/common';
import { formatVnd } from '@/lib/billing';
import { VN_TIME_ZONE } from '@/lib/quota';
import { DEFAULT_PROGRAM } from '@allingo/schemas/program/registry';

/**
 * Nội dung hiển thị của thông báo in-app (S8): dịch theo `template_code` (khoá i18n `notifications.templates.<code>.title|body`)
 * với tham số lấy từ `payload` (`payload.data` ưu tiên). Thứ tự:
 *   1) server đã dựng `title` cùng ngôn ngữ giao diện (`payload.locale`) → dùng nguyên văn (chính xác nhất);
 *   2) web có bản dịch + đủ tham số bắt buộc → dịch;
 *   3) `title`/`body` của server (ngôn ngữ khác) → dự phòng;
 *   4) chuỗi chung theo loại (category).
 * Thuần – nhận hàm dịch (next-intl `useTranslations('notifications')` hoặc `createTranslator`) để test được.
 */

export interface Translator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

type Params = Record<string, string | number>;

/**
 * Tham số bắt buộc của từng mẫu – thiếu thì không dịch ở web (tránh câu thiếu chữ). Mã S12 (`support.reply`,
 * `content.report_resolved`, `beta.invite`) đã thuộc `NOTIFICATION_TEMPLATE_CODES` chung (B6/S149).
 */
export const TEMPLATE_REQUIRED_PARAMS: Record<NotificationTemplateCode, readonly string[]> = {
  'billing.order_paid': ['plan', 'total'],
  'billing.invoice_issued': ['series', 'invoice', 'total', 'lookup'],
  'billing.subscription_expiring': ['plan', 'date', 'days'],
  'billing.subscription_expired': ['plan'],
  'billing.trial_started': ['plan', 'trial_days', 'date'],
  'billing.trial_ending': ['plan', 'date'],
  'billing.trial_ended': ['plan'],
  'growth.referral_rewarded': ['credits', 'referrer', 'stage'],
  'learning.study_reminder': [],
  'learning.weekly_summary': ['minutes', 'attempts', 'xp'],
  'learning.streak_at_risk': [],
  'learning.badge_awarded': [],
  'learning.plan_adjust_ready': [],
  'admin.invoice_failed': ['op', 'order', 'attempts', 'error'],
  // S12
  'support.reply': ['subject', 'credits'],
  'content.report_resolved': ['fixed'],
  'beta.invite': [],
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function formatDate(iso: unknown, locale: string): string | null {
  const s = str(iso);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeZone: VN_TIME_ZONE }).format(d);
}

/** Tham số ICU từ payload (dữ liệu mẫu của NotificationService) */
export function templateParams(item: Pick<NotificationItem, 'payload'> & Partial<Pick<NotificationItem, 'template_code'>>, locale: string): Params {
  const p = (item.payload ?? {});
  const d = p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
  const src: Record<string, unknown> = { ...p, ...d };
  const out: Params = {};
  const plan = src.plan_name;
  if (plan && typeof plan === 'object') out.plan = pickLocalized(plan as LocalizedText, locale);
  else if (str(plan)) out.plan = str(plan)!;
  const total = num(src.total);
  if (total !== null) out.total = formatVnd(total, locale);
  const date = formatDate(src.period_end ?? src.trial_ends_at ?? src.ends_at, locale);
  if (date) out.date = date;
  const days = num(src.days_before ?? src.days_left);
  if (days !== null) out.days = days;
  for (const [k, from] of [
    ['trial_days', 'trial_days'],
    ['credits', 'credits'],
    ['minutes', 'minutes'],
    ['attempts', 'attempts'],
    ['xp', 'xp'],
  ] as const) {
    const v = num(src[from]);
    if (v !== null) out[k] = v;
  }
  // S12: support.reply có `credits` = 0 khi không cấp bù (vẫn là tham số bắt buộc của ICU plural)
  if (item.template_code === 'support.reply' && out.credits === undefined) out.credits = 0;
  for (const [k, from] of [
    ['subject', 'subject'],
    ['series', 'series'],
    ['invoice', 'invoice_no'],
    ['lookup', 'lookup_code'],
    ['op', 'op'],
    ['error', 'error_code'],
    ['stage', 'stage'],
  ] as const) {
    const v = str(src[from]);
    if (v) out[k] = v;
  }
  if (typeof src.is_referrer === 'boolean') out.referrer = src.is_referrer ? 'yes' : 'no';
  if (typeof src.fixed === 'boolean') out.fixed = src.fixed ? 'yes' : 'no';
  const order = str(src.order_id);
  if (order) out.order = order.slice(0, 8);
  return out;
}

export interface NotificationText {
  title: string;
  body: string | null;
  source: 'server' | 'web' | 'generic';
}

export function notificationText(item: NotificationItem, t: Translator, locale: string): NotificationText {
  const p = (item.payload ?? {});
  const serverTitle = item.title ?? str(p.title);
  const serverBody = item.body ?? str(p.body);
  const serverLocale = str(p.locale);
  if (serverTitle && serverLocale === locale) return { title: serverTitle, body: serverBody, source: 'server' };

  const code = item.template_code as keyof typeof TEMPLATE_REQUIRED_PARAMS;
  const base = `templates.${item.template_code}`;
  if (t.has(`${base}.title`)) {
    const params = templateParams(item, locale);
    const required = TEMPLATE_REQUIRED_PARAMS[code] ?? [];
    if (required.every((k) => params[k] !== undefined)) {
      try {
        return { title: t(`${base}.title`, params), body: t.has(`${base}.body`) ? t(`${base}.body`, params) : null, source: 'web' };
      } catch {
        /* thiếu tham số không khai báo → dự phòng bên dưới */
      }
    }
  }
  if (serverTitle) return { title: serverTitle, body: serverBody, source: 'server' };
  const category = item.category ?? str(p.category) ?? 'system';
  const key = t.has(`generic.${category}`) ? `generic.${category}` : 'generic.system';
  return { title: t(key), body: serverBody, source: 'generic' };
}

/**
 * Đường dẫn trong web từ `url` của thông báo: chỉ đường dẫn tương đối (chặn `//host`, `javascript:`), bỏ tiền tố locale,
 * ánh xạ đường dẫn chung của server sang route web (`/practice` → `/toeic/practice`; S9: `/today` → `/toeic/today`, `/plan` →
 * `/toeic/plan` (giữ `?proposal=`), `/badges` giữ nguyên; `/stats` → dashboard). Đường dẫn đã có `/toeic/...` (API mới) giữ nguyên.
 */
export function resolveNotificationHref(url: string | null | undefined, program: string = DEFAULT_PROGRAM): string | null {
  const u = str(url);
  if (!u || !u.startsWith('/') || u.startsWith('//') || u.startsWith('/\\')) return null;
  let path = u.replace(/^\/(vi|en)(?=\/|$)/, '') || '/';
  // S12: `/support/tickets/{id}` (support.reply), `/beta?code=` (beta.invite), `/attempts/{id}/review?focus=<qv>` | `/support`
  // (content.report_resolved – B6/S148) là route web có sẵn – giữ nguyên
  // C1: đường dẫn chung → khu học của chương trình đang học (`program` – useProgram() của caller)
  const ALIASES: Record<string, string> = { '/practice': `/${program}/practice`, '/today': `/${program}/today`, '/plan': `/${program}/plan`, '/stats': `/${program}/dashboard`, '/dashboard': `/${program}/dashboard`, '/support/tickets': '/support' };
  const [pathname, rest = ''] = path.split(/(?=[?#])/);
  if (pathname && ALIASES[pathname]) path = ALIASES[pathname] + rest;
  return path;
}
