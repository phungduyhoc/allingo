import { REFERRAL_DEFAULTS, notificationPreferencesPatchSchema, type NotificationCategories, type NotificationPreferences } from '@allingo/schemas';
import { addLedger, notificationDto, notify } from './billing-core';
import type { BillingDeps, MockRouteDef } from './billing';
import type { MockReferralRecord, MockState, MockUserRecord } from './state';

/**
 * Route giả lập Growth S8: referral (mã cấp lười, joined → started → upgraded, thưởng hai chiều 200/200 · 500/500, trần tháng,
 * cùng thiết bị → `duplicate_device`), thông báo in-app (cursor, chưa đọc, đọc/đọc tất cả), tuỳ chọn theo loại × kênh, trang quản lý
 * theo token email (HMAC – cùng thuật toán API, khoá mock `MOCK_UNSUBSCRIBE_SECRET` để E2E tự ký).
 */

/** Khoá ký token huỷ đăng ký của mock (API thật: NOTIFY_UNSUBSCRIBE_SECRET / dẫn xuất AUTH_SECRET) */
export const MOCK_UNSUBSCRIBE_SECRET = 'allingo-mock-unsubscribe-secret';

const DEFAULT_CATEGORIES: NotificationCategories = {
  learning: { email: true, push: true, inapp: true },
  billing: { email: true, push: true, inapp: true },
  marketing: { email: false, push: false, inapp: true },
};
const DEFAULT_PREFS: NotificationPreferences = {
  channels: { email: true, push: true, zalo: false, inapp: true },
  quiet_hours: { start: '22:00', end: '07:00' },
  reminder_times: ['20:00'],
};
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const utf8b64url = (text: string) => b64url(new TextEncoder().encode(text));

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return b64url(sig).slice(0, 22);
}

/** Token `v1.<userId base64url>.<scope>.<sig>` như `makeUnsubscribeToken` của API */
export async function makeMockUnsubscribeToken(userId: string, scope: string): Promise<string> {
  const body = `v1.${utf8b64url(userId)}.${scope}`;
  return `${body}.${await hmac(MOCK_UNSUBSCRIBE_SECRET, body)}`;
}

async function verifyToken(token: string): Promise<{ userId: string; scope: 'learning' | 'billing' | 'marketing' | 'all' } | null> {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, uid, scope, sig] = parts as [string, string, string, string];
  if (!['learning', 'billing', 'marketing', 'all'].includes(scope)) return null;
  if ((await hmac(MOCK_UNSUBSCRIBE_SECRET, `v1.${uid}.${scope}`)) !== sig) return null;
  try {
    const userId = atob(uid.replace(/-/g, '+').replace(/_/g, '/'));
    return /^[0-9a-f-]{36}$/i.test(userId) ? { userId, scope: scope as 'all' } : null;
  } catch {
    return null;
  }
}

const mask = (name: string) => (name.length <= 2 ? `${name[0] ?? ''}*` : `${name.slice(0, 2)}***`);
const vnMonth = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 7);

export interface ReferralHooks {
  onRegistered: (user: MockUserRecord, code: string | undefined, deviceFp: string | null) => void;
  onAttemptGraded: (userId: string) => void;
  onOrderPaid: (userId: string) => void;
}

export function referralHooks(state: MockState, uuid: () => string, nowIso: () => string): ReferralHooks {
  const cfg = REFERRAL_DEFAULTS;
  const reward = (r: MockReferralRecord, stage: 'started' | 'upgraded') => {
    if (r.rewarded[stage] || r.blocked_reason) return;
    const monthCount = Object.values(state.referrals).filter((x) => x.referrer_id === r.referrer_id && (x.rewarded.started || x.rewarded.upgraded) && vnMonth(x.started_at ?? x.joined_at) === vnMonth(nowIso())).length;
    if (monthCount >= cfg.monthly_cap) return;
    r.rewarded[stage] = true;
    const amounts = cfg.rewards[stage];
    for (const [userId, credits, isReferrer] of [
      [r.referrer_id, amounts.referrer, true],
      [r.referee_id, amounts.referee, false],
    ] as const) {
      if (!credits) continue;
      addLedger(state, userId, { delta: credits, reason: 'referral', ref: { type: 'referral', id: r.id }, note: stage });
      notify(state, userId, 'growth.referral_rewarded', { credits, stage, is_referrer: isReferrer }, { category: 'billing', url: '/account/referral' });
    }
  };
  return {
    onRegistered: (user, code, deviceFp) => {
      if (!code) return;
      const referrer = Object.values(state.users).find((u) => u.referral_code === code.trim().toUpperCase());
      if (!referrer || referrer.id === user.id) return;
      const sameDevice = !!deviceFp && Object.values(state.referrals).some((x) => x.device_fp === deviceFp && Date.now() - Date.parse(x.joined_at) < cfg.abuse_window_hours * 3_600_000);
      const id = uuid();
      state.referrals[id] = { id, referrer_id: referrer.id, referee_id: user.id, code: code.trim().toUpperCase(), status: 'joined', joined_at: nowIso(), started_at: null, upgraded_at: null, rewarded: { started: false, upgraded: false }, blocked_reason: sameDevice ? 'duplicate_device' : null, device_fp: deviceFp };
    },
    onAttemptGraded: (userId) => {
      const r = Object.values(state.referrals).find((x) => x.referee_id === userId);
      if (!r || r.status !== 'joined') return;
      r.status = 'started';
      r.started_at = nowIso();
      reward(r, 'started');
    },
    onOrderPaid: (userId) => {
      const r = Object.values(state.referrals).find((x) => x.referee_id === userId);
      if (!r || r.status === 'upgraded') return;
      r.started_at ??= nowIso();
      r.status = 'upgraded';
      r.upgraded_at = nowIso();
      reward(r, 'upgraded');
    },
  };
}

export function growthRoutes(d: BillingDeps): MockRouteDef[] {
  const { state, persist, route, json, error, nowIso } = d;
  const origin = () => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const codeOf = (u: MockUserRecord): string => {
    if (u.referral_code) return u.referral_code;
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    u.referral_code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    persist();
    return u.referral_code;
  };
  const prefsOf = (userId: string): NotificationPreferences => {
    const p = state.prefs[userId] ?? DEFAULT_PREFS;
    return { ...p, categories: p.categories ?? DEFAULT_CATEGORIES, frequency: { marketing_email_per_week: 1, push_per_day: 2 }, timezone: 'Asia/Ho_Chi_Minh' };
  };
  const mergeCategories = (cur: NotificationCategories, patch: Partial<Record<keyof NotificationCategories, Partial<NotificationCategories['learning']>>> | undefined): NotificationCategories => ({
    learning: { ...cur.learning, ...(patch?.learning ?? {}) },
    billing: { ...cur.billing, ...(patch?.billing ?? {}) },
    marketing: { ...cur.marketing, ...(patch?.marketing ?? {}) },
  });
  const UTM = 'utm_source=referral&utm_medium=share&utm_campaign=referral';

  return [
    // --------------------------------------------------------------------- referral
    route('GET', '/me/referral', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      if (u.is_guest) return error(403, 'forbidden', 'Guest accounts cannot refer – register first', { reason: 'guest_account' });
      const code = codeOf(u);
      const link = `${origin()}/r/${code}?${UTM}`;
      const mine = Object.values(state.referrals).filter((r) => r.referrer_id === u.id).sort((a, b) => b.joined_at.localeCompare(a.joined_at));
      const earned = state.ledger.filter((l) => l.user_id === u.id && l.reason === 'referral').reduce((s, l) => s + l.delta, 0);
      const month = vnMonth(nowIso());
      const text = `Nhận ${REFERRAL_DEFAULTS.rewards.started.referee} credit AI miễn phí khi bắt đầu luyện thi với Allingo. ${link}`;
      return json(200, {
        code,
        link,
        landing_url: `${origin()}/register?ref=${code}&${UTM}`,
        share: {
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
          zalo: link,
          messenger: `fb-messenger://share/?link=${encodeURIComponent(link)}`,
          text,
        },
        og: { title: 'Luyện thi TOEIC · IELTS · JLPT · HSK cùng AI – Allingo', description: `Nhận ${REFERRAL_DEFAULTS.rewards.started.referee} credit AI miễn phí khi bắt đầu luyện thi với Allingo.`, image: `${origin()}/og/referral.png` },
        enabled: true,
        joined: mine.length,
        started: mine.filter((r) => r.status !== 'joined').length,
        upgraded: mine.filter((r) => r.status === 'upgraded').length,
        credits_earned: earned,
        rewards: { this_month: mine.filter((r) => (r.rewarded.started || r.rewarded.upgraded) && vnMonth(r.started_at ?? r.joined_at) === month).length, monthly_cap: REFERRAL_DEFAULTS.monthly_cap, skipped: mine.filter((r) => r.blocked_reason).length },
        config: { rewards: REFERRAL_DEFAULTS.rewards, monthly_cap: REFERRAL_DEFAULTS.monthly_cap },
        recent: mine.slice(0, 20).map((r) => ({ id: r.id, display_name: mask(state.users[r.referee_id]?.display_name ?? 'Học viên'), status: r.status, joined_at: r.joined_at, started_at: r.started_at, upgraded_at: r.upgraded_at, rewarded: r.rewarded, blocked_reason: r.blocked_reason })),
      });
    }),
    route('GET', '/referrals/{code}', ({ params }) => {
      const code = (params.code ?? '').toUpperCase();
      const referrer = Object.values(state.users).find((u) => u.referral_code === code);
      const url = `${origin()}/r/${code}?${UTM}`;
      return json(200, {
        code,
        valid: !!referrer,
        referrer_name: referrer ? mask(referrer.display_name) : null,
        reward: { referee_started: REFERRAL_DEFAULTS.rewards.started.referee, referee_upgraded: REFERRAL_DEFAULTS.rewards.upgraded.referee },
        og: { title: 'Allingo', description: 'Luyện thi cùng AI', image: `${origin()}/og/referral.png`, url },
        register_url: `${origin()}/register?ref=${code}&${UTM}`,
      });
    }),

    // --------------------------------------------------------------------- thông báo in-app
    route('GET', '/me/notifications', ({ url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const unreadOnly = url.searchParams.get('unread') === 'true';
      const mine = Object.values(state.notifications).filter((n) => n.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const rows = mine.filter((n) => !unreadOnly || !n.read_at);
      const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 20) || 20);
      const start = Number(url.searchParams.get('cursor') ?? 0) || 0;
      return json(200, { data: rows.slice(start, start + limit).map(notificationDto), next_cursor: start + limit < rows.length ? String(start + limit) : null, unread_count: mine.filter((n) => !n.read_at).length });
    }),
    route('POST', '/me/notifications/{notificationId}/read', ({ params }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const n = state.notifications[params.notificationId!];
      if (!n || n.user_id !== u.id) return error(404, 'not_found', 'Notification not found');
      n.read_at ??= nowIso();
      persist();
      return json(200, notificationDto(n));
    }),
    route('POST', '/me/notifications/read-all', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      let updated = 0;
      for (const n of Object.values(state.notifications)) {
        if (n.user_id !== u.id || n.read_at) continue;
        n.read_at = nowIso();
        updated++;
      }
      persist();
      return json(200, { updated, unread_count: 0 });
    }),

    // --------------------------------------------------------------------- tuỳ chọn (đè route S6 – thêm categories/frequency/timezone)
    route('GET', '/me/notification-preferences', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      return json(200, { ...prefsOf(u.id), push_subscriptions: Object.values(state.pushSubs).filter((s) => s.user_id === u.id).length });
    }),
    route('PATCH', '/me/notification-preferences', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const parsed = notificationPreferencesPatchSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Invalid preferences', { issues: parsed.error.issues.map((i) => i.path.join('.')) });
      const cur = prefsOf(u.id);
      const next: NotificationPreferences = {
        channels: { ...cur.channels, ...(parsed.data.channels ?? {}) },
        quiet_hours: parsed.data.quiet_hours ?? cur.quiet_hours,
        reminder_times: parsed.data.reminder_times ?? cur.reminder_times,
        categories: mergeCategories(cur.categories ?? DEFAULT_CATEGORIES, parsed.data.categories),
        updated_at: nowIso(),
      };
      state.prefs[u.id] = next;
      persist();
      return json(200, { ...prefsOf(u.id), push_subscriptions: Object.values(state.pushSubs).filter((s) => s.user_id === u.id).length });
    }),

    // --------------------------------------------------------------------- quản lý theo token email (không cần đăng nhập)
    route('GET', '/notifications/manage', async ({ url }) => {
      const v = await verifyToken(url.searchParams.get('token') ?? '');
      const u = v ? state.users[v.userId] : undefined;
      if (!v || !u) return error(400, 'validation_failed', 'Invalid token', { issues: [{ path: 'token', message: 'invalid', code: 'invalid_token' }] });
      const email = u.email ?? '';
      return json(200, { ...prefsOf(u.id), email_masked: email ? `${email.slice(0, 2)}***@${email.split('@')[1] ?? ''}` : null, token_category: v.scope });
    }),
    route('PATCH', '/notifications/manage', async ({ url, body }) => {
      const v = await verifyToken(url.searchParams.get('token') ?? '');
      const u = v ? state.users[v.userId] : undefined;
      if (!v || !u) return error(400, 'validation_failed', 'Invalid token', { issues: [{ path: 'token', message: 'invalid', code: 'invalid_token' }] });
      const b = (body ?? {}) as { categories?: Partial<Record<keyof NotificationCategories, Partial<NotificationCategories['learning']>>>; channels?: { email?: boolean } };
      const cur = prefsOf(u.id);
      state.prefs[u.id] = { ...cur, channels: { ...cur.channels, ...(b.channels?.email !== undefined ? { email: b.channels.email } : {}) }, categories: mergeCategories(cur.categories ?? DEFAULT_CATEGORIES, b.categories), updated_at: nowIso() };
      persist();
      const email = u.email ?? '';
      return json(200, { ...prefsOf(u.id), email_masked: email ? `${email.slice(0, 2)}***@${email.split('@')[1] ?? ''}` : null, token_category: v.scope });
    }),
  ];
}
