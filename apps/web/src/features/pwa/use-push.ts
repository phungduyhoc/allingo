'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { ApiError } from '@allingo/api-client';
import { deletePushSubscription, getVapidKey, registerPushSubscription } from '@/lib/learning-api';
import { isIosSafari, isStandalone } from './install-state';
import {
  PUSH_DEVICE_KEY,
  pushSupport,
  sameKey,
  subscriptionBody,
  urlBase64ToUint8Array,
  type PushSupport,
} from './push';

export const PUSH_SUBS_KEY = ['me', 'push-subscriptions'] as const;

export type PushErrorKind = 'denied' | 'server_disabled' | 'no_worker' | 'failed';

export interface PushState {
  support: PushSupport | null;
  permission: NotificationPermission | null;
  /** Thiết bị này đang có đăng ký (trình duyệt) */
  subscribed: boolean;
  /** id bản ghi server của thiết bị này (nếu biết) */
  deviceId: string | null;
  busy: boolean;
  error: { kind: PushErrorKind; message?: string } | null;
}

function readDevice(): { endpoint: string; id: string } | null {
  try {
    const raw = window.localStorage.getItem(PUSH_DEVICE_KEY);
    return raw ? (JSON.parse(raw) as { endpoint: string; id: string }) : null;
  } catch {
    return null;
  }
}
function writeDevice(v: { endpoint: string; id: string } | null) {
  try {
    if (v) window.localStorage.setItem(PUSH_DEVICE_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(PUSH_DEVICE_KEY);
  } catch {
    /* bỏ qua */
  }
}

async function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing?.active) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => window.setTimeout(() => r(null), timeoutMs)),
  ]);
}

/**
 * Đăng ký Web Push cho thiết bị hiện tại: CHỈ xin quyền khi người học bấm (không tự hỏi) → khoá VAPID (GET /push/vapid-public-key)
 * → `pushManager.subscribe` (đổi khoá → huỷ đăng ký cũ) → POST /me/push-subscriptions (idempotent theo endpoint).
 * Tắt → `unsubscribe()` + DELETE /me/push-subscriptions/{id}.
 */
export function usePush() {
  const locale = useLocale();
  const qc = useQueryClient();
  const [state, setState] = React.useState<PushState>({
    support: null,
    permission: null,
    subscribed: false,
    deviceId: null,
    busy: false,
    error: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const support = pushSupport({
        hasSw: 'serviceWorker' in navigator,
        hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
        hasNotification: typeof Notification !== 'undefined',
        ios: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
        standalone: isStandalone(),
      });
      let subscribed = false;
      if (support === 'supported') {
        const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
        const sub = await reg?.pushManager.getSubscription().catch(() => null);
        subscribed = !!sub;
      }
      const device = readDevice();
      if (!cancelled)
        setState((s) => ({
          ...s,
          support,
          permission: typeof Notification !== 'undefined' ? Notification.permission : null,
          subscribed,
          deviceId: device?.id ?? null,
        }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = React.useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    const fail = (kind: PushErrorKind, message?: string) =>
      setState((s) => ({
        ...s,
        busy: false,
        error: { kind, message },
        permission: typeof Notification !== 'undefined' ? Notification.permission : s.permission,
      }));
    try {
      // Xin quyền ngay trong cử chỉ bấm (Safari/Firefox yêu cầu)
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') return fail('denied');
      const vapid = await getVapidKey();
      if (!vapid.enabled || !vapid.public_key) return fail('server_disabled');
      const reg = await readyRegistration();
      if (!reg) return fail('no_worker');
      const key = urlBase64ToUint8Array(vapid.public_key);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe().catch(() => undefined);
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const body = subscriptionBody(sub.toJSON(), navigator.userAgent, locale);
      if (!body) return fail('failed', 'invalid subscription');
      const saved = await registerPushSubscription(body);
      writeDevice({ endpoint: body.endpoint, id: saved.id });
      void qc.invalidateQueries({ queryKey: PUSH_SUBS_KEY });
      void qc.invalidateQueries({ queryKey: ['me', 'notification-preferences'] });
      setState((s) => ({
        ...s,
        busy: false,
        subscribed: true,
        permission: 'granted',
        deviceId: saved.id,
        error: null,
      }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'feature_disabled') return fail('server_disabled');
      fail('failed', err instanceof Error ? err.message : String(err));
    }
  }, [locale, qc]);

  const disable = React.useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe().catch(() => undefined);
      const device = readDevice();
      if (device?.id) await deletePushSubscription(device.id);
      writeDevice(null);
      void qc.invalidateQueries({ queryKey: PUSH_SUBS_KEY });
      void qc.invalidateQueries({ queryKey: ['me', 'notification-preferences'] });
      setState((s) => ({ ...s, busy: false, subscribed: false, deviceId: null }));
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: false,
        error: { kind: 'failed', message: err instanceof Error ? err.message : String(err) },
      }));
    }
  }, [qc]);

  return { state, enable, disable };
}
