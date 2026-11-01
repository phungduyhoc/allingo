'use client';

import * as React from 'react';

/**
 * Đăng ký service worker (public/sw.js, đóng gói bằng `pnpm sw:build`) – chỉ ở production,
 * vì ở dev Next/Turbopack không sinh tệp này và cache dễ gây nhầm lẫn khi sửa mã.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
