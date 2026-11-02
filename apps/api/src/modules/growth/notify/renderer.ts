import { createHmac, timingSafeEqual } from 'node:crypto';
import Handlebars from 'handlebars';
import { NOTIFICATION_FREQUENCY, pickLocalized, type DeliveryChannel, type NotificationCategories, type NotificationCategory } from '@allingo/schemas';
import { EMAIL_LAYOUT, type TemplateDef } from './templates.js';

/**
 * Dựng nội dung thông báo (Sprint 8) – thuần: Handlebars (HTML escape cho email HTML, noEscape cho text/push/in-app),
 * helper `vnd`, `date` (giờ Asia/Ho_Chi_Minh), `t` (chuỗi đa ngôn ngữ), `eq`. Cache bản biên dịch theo (template, locale, phần).
 */
export type RenderLocale = 'vi' | 'en';

export interface RenderedNotification {
  locale: RenderLocale;
  subject: string;
  html: string;
  text: string;
  push: { title: string; body: string };
  inapp: { title: string; body: string };
  url: string;
}

const hbs = Handlebars.create();
hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);

const cache = new Map<string, Handlebars.TemplateDelegate>();
function compile(key: string, src: string, escape: boolean): Handlebars.TemplateDelegate {
  const k = `${key}:${escape ? 'h' : 't'}`;
  let fn = cache.get(k);
  if (!fn) {
    fn = hbs.compile(src, { noEscape: !escape, strict: false });
    cache.set(k, fn);
  }
  return fn;
}

export function renderLocale(uiLocale: string | null | undefined): RenderLocale {
  return uiLocale === 'vi' ? 'vi' : 'en';
}

function helpers(locale: RenderLocale) {
  return {
    vnd: (n: unknown) => {
      const v = Math.floor(Number(n) || 0);
      return `${v.toLocaleString('vi-VN')} ₫`;
    },
    date: (iso: unknown) => {
      if (typeof iso !== 'string' && !(iso instanceof Date)) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
    },
    t: (v: unknown) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') return pickLocalized(v as Record<string, string>, locale);
      return '';
    },
  };
}

export function renderNotification(def: TemplateDef, uiLocale: string | null | undefined, data: Record<string, unknown>, links: { appUrl: string; manageUrl: string; unsubscribeUrl: string | null }): RenderedNotification {
  const locale = renderLocale(uiLocale);
  const tpl = def.locales[locale];
  const h = helpers(locale);
  const opts = { helpers: h };
  const path = compile(`${def.code}:url`, def.url, false)(data, opts);
  const link = `${links.appUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const ctx = { ...data, link };
  const key = `${def.code}:${locale}`;
  const subject = compile(`${key}:subject`, tpl.subject, false)(ctx, opts).trim();
  const bodyHtml = compile(`${key}:html`, tpl.html, true)(ctx, opts);
  const bodyText = compile(`${key}:text`, tpl.text, false)(ctx, opts);
  const layoutCtx = { subject, manage_url: links.manageUrl, unsubscribe_url: def.transactional ? null : links.unsubscribeUrl, transactional: def.transactional };
  const html = compile(`layout:${locale}:html`, EMAIL_LAYOUT[locale].html, true)({ ...layoutCtx, body: bodyHtml }, opts);
  const text = compile(`layout:${locale}:text`, EMAIL_LAYOUT[locale].text, false)({ ...layoutCtx, body: bodyText }, opts);
  return {
    locale,
    subject,
    html,
    text,
    push: { title: compile(`${key}:push.title`, tpl.push.title, false)(ctx, opts).trim(), body: compile(`${key}:push.body`, tpl.push.body, false)(ctx, opts).trim() },
    inapp: { title: compile(`${key}:inapp.title`, tpl.inapp.title, false)(ctx, opts).trim(), body: compile(`${key}:inapp.body`, tpl.inapp.body, false)(ctx, opts).trim() },
    url: path,
  };
}

// ----------------------------------------------------------------------------- chính sách giao (thuần)
export interface DeliveryPrefs {
  channels: Partial<Record<string, boolean>>;
  categories: NotificationCategories;
  quiet_hours: { start: string; end: string };
}

export interface DeliveryCounts {
  /** Email marketing đã gửi trong 7 ngày gần nhất */
  marketingEmails7d: number;
  /** Push không giao dịch đã gửi trong ngày (giờ VN) */
  pushesToday: number;
}

export type DeliveryDecision = { action: 'send' } | { action: 'defer'; at: Date; reason: 'quiet_hours' } | { action: 'skip'; reason: 'channel_disabled' | 'category_disabled' | 'rate_limited' | 'quiet_hours' };

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Phút trong ngày theo giờ VN (UTC+7, không có giờ mùa hè) */
export function vnMinuteOfDay(d: Date): number {
  const t = new Date(d.getTime() + 7 * 3600_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** Trong giờ yên lặng [start, end) giờ VN (khoảng qua nửa đêm: 22:00–07:00) */
export function inQuietHours(now: Date, quiet: { start: string; end: string }): boolean {
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  if (s === e) return false;
  const m = vnMinuteOfDay(now);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Thời điểm kết thúc giờ yên lặng kế tiếp (UTC) */
export function quietHoursEnd(now: Date, quiet: { start: string; end: string }): Date {
  const e = minutesOf(quiet.end);
  const m = vnMinuteOfDay(now);
  let delta = e - m;
  if (delta <= 0) delta += 24 * 60;
  const at = new Date(now.getTime() + delta * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

/**
 * Quyết định giao một kênh: kênh tắt → skip; loại tắt → skip (trừ email/in-app giao dịch); tần suất (không giao dịch):
 * ≤ 1 email marketing / 7 ngày, ≤ 2 push / ngày; push trong giờ yên lặng → theo chính sách mẫu (defer/skip/ignore).
 */
export function decideDelivery(input: { channel: DeliveryChannel; category: NotificationCategory | 'system'; transactional: boolean; quietPolicy: 'defer' | 'skip' | 'ignore'; prefs: DeliveryPrefs; counts: DeliveryCounts; now: Date; force?: boolean }): DeliveryDecision {
  const { channel, category, transactional, prefs, counts, now } = input;
  if (input.force) return { action: 'send' };
  const bypass = transactional && (channel === 'email' || channel === 'inapp');
  if (!bypass && prefs.channels[channel] === false) return { action: 'skip', reason: 'channel_disabled' };
  if (!bypass && category !== 'system' && prefs.categories[category]?.[channel] === false) return { action: 'skip', reason: 'category_disabled' };
  if (!transactional) {
    if (channel === 'email' && category === 'marketing' && counts.marketingEmails7d >= NOTIFICATION_FREQUENCY.marketing_email_per_week) return { action: 'skip', reason: 'rate_limited' };
    if (channel === 'push' && counts.pushesToday >= NOTIFICATION_FREQUENCY.push_per_day) return { action: 'skip', reason: 'rate_limited' };
  }
  if (channel === 'push' && input.quietPolicy !== 'ignore' && inQuietHours(now, prefs.quiet_hours)) {
    return input.quietPolicy === 'defer' ? { action: 'defer', at: quietHoursEnd(now, prefs.quiet_hours), reason: 'quiet_hours' } : { action: 'skip', reason: 'quiet_hours' };
  }
  return { action: 'send' };
}

// ----------------------------------------------------------------------------- link huỷ đăng ký ký HMAC
export type UnsubscribeScope = NotificationCategory | 'all';
const SCOPES: readonly UnsubscribeScope[] = ['learning', 'billing', 'marketing', 'all'];

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url').slice(0, 22);
}

/** Token `v1.<userId base64url>.<scope>.<sig>` – không hết hạn (link huỷ đăng ký phải dùng được lâu dài – RFC 8058) */
export function makeUnsubscribeToken(secret: string, userId: string, scope: UnsubscribeScope): string {
  const body = `v1.${Buffer.from(userId, 'utf8').toString('base64url')}.${scope}`;
  return `${body}.${sign(secret, body)}`;
}

export function verifyUnsubscribeToken(secret: string, token: string): { userId: string; scope: UnsubscribeScope } | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, uid, scope, sig] = parts as [string, string, string, string];
  if (!SCOPES.includes(scope as UnsubscribeScope)) return null;
  const expected = sign(secret, `v1.${uid}.${scope}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const userId = Buffer.from(uid, 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return { userId, scope: scope as UnsubscribeScope };
}

/** Khoá ký: NOTIFY_UNSUBSCRIBE_SECRET hoặc dẫn xuất từ AUTH_SECRET (tách miền khoá) */
export function unsubscribeSecret(env: { NOTIFY_UNSUBSCRIBE_SECRET?: string; AUTH_SECRET: string }): string {
  return env.NOTIFY_UNSUBSCRIBE_SECRET ?? createHmac('sha256', env.AUTH_SECRET).update('allingo:notify:unsubscribe:v1').digest('hex');
}
