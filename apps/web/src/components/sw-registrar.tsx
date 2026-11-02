'use client';

import * as React from 'react';
// Bắt beforeinstallprompt càng sớm càng tốt (module nạp cùng layout gốc)
import '@/features/pwa/install-state';

/** Cờ bật service worker ở bản dev (chỉ e2e/thử tay PWA): localStorage `allingo.sw.dev = 1` */
export const SW_DEV_FLAG = 'allingo.sw.dev';

function devOptIn(): boolean {
  try {
    return window.localStorage.getItem(SW_DEV_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Chỉ bản dev: Turbopack nạp động chunk HMR riêng của từng trang (không có trong HTML) → SW không biết để lưu sẵn. Mở trang
 * offline trong iframe ẩn một lần mỗi phiên (sau khi SW điều khiển trang) để mọi chunk của nó đi qua SW và được cache.
 * Bản production: HTML đã liệt kê đủ JS/CSS – SW tự lưu lúc cài (xem src/app/sw.ts).
 */
async function warmOfflinePage(): Promise<void> {
  try {
    if (window.sessionStorage.getItem('allingo.sw.warm') === '1') return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      );
    }
    window.sessionStorage.setItem('allingo.sw.warm', '1');
    const locale = window.location.pathname.startsWith('/en') ? 'en' : 'vi';
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.src = `/${locale}/offline`;
    frame.addEventListener('load', () => window.setTimeout(() => frame.remove(), 3000), { once: true });
    document.body.appendChild(frame);
  } catch {
    /* bỏ qua */
  }
}

/**
 * Đăng ký service worker (public/sw.js, đóng gói bằng `pnpm sw:build`) – ở production; bản dev chỉ khi bật cờ
 * `allingo.sw.dev` (SW nhận `?dev=1` → không giữ chunk cũ), vì cache dễ gây nhầm lẫn khi sửa mã.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const prod = process.env.NODE_ENV === 'production';
    if (!prod && !devOptIn()) return;
    const url = prod ? '/sw.js' : '/sw.js?dev=1';
    const register = () => {
      navigator.serviceWorker
        .register(url, { scope: '/' })
        .then(() => {
          if (!prod) void warmOfflinePage();
        })
        .catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
