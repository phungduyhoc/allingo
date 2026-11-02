import type { PushSubscriptionInput } from '@allingo/schemas';

/**
 * Web Push phía trình duyệt (thuần – có test): chuyển khoá VAPID base64url → Uint8Array cho `pushManager.subscribe`,
 * `PushSubscription.toJSON()` → body `POST /me/push-subscriptions`, đánh giá khả năng hỗ trợ.
 */

export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** So khoá applicationServerKey của đăng ký hiện có với khoá VAPID của server (đổi khoá → đăng ký lại) */
export function sameKey(current: ArrayBuffer | null | undefined, vapid: Uint8Array): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  if (a.length !== vapid.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== vapid[i]) return false;
  return true;
}

export function subscriptionBody(
  json: PushSubscriptionJSON,
  userAgent: string | null,
  locale: string | null,
): PushSubscriptionInput | null {
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  const loc =
    locale && ['vi', 'en', 'ja', 'ko', 'th'].includes(locale) ? (locale as PushSubscriptionInput['locale']) : undefined;
  return {
    endpoint: json.endpoint,
    expirationTime: typeof json.expirationTime === 'number' ? Math.round(json.expirationTime) : null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    ...(userAgent ? { user_agent: userAgent.slice(0, 300) } : {}),
    ...(loc ? { locale: loc } : {}),
  };
}

export type PushSupport = 'supported' | 'unsupported' | 'ios-install';

export function pushSupport(env: {
  hasSw: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  ios: boolean;
  standalone: boolean;
}): PushSupport {
  // iOS 16.4+: Web Push chỉ có trong PWA đã cài vào màn hình chính
  if (env.ios && !env.standalone) return 'ios-install';
  if (!env.hasSw || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  return 'supported';
}

/** Nhớ id đăng ký server của thiết bị này (để huỷ đúng bản ghi) */
export const PUSH_DEVICE_KEY = 'allingo.push.device';
