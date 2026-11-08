'use client';

import * as React from 'react';

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * S11 (hiệu năng): dựng `children` SAU khi trình duyệt rảnh (requestIdleCallback, tối đa `timeout` ms) và trong transition →
 * React chia nhỏ công việc (~5 ms/lần) thay vì một tác vụ dài lúc trang đầu dựng. Dùng cho phần dưới màn hình đầu (thẻ phụ của
 * dashboard); `fallback` (khung chờ cùng kích thước) giữ bố cục không nhảy (CLS).
 */
export function Deferred({ children, fallback = null, timeout = 1200 }: { children: React.ReactNode; fallback?: React.ReactNode; timeout?: number }) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const w = window as IdleWindow;
    const run = () => React.startTransition(() => setShow(true));
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 150);
    return () => window.clearTimeout(id);
  }, [timeout]);
  return <>{show ? children : fallback}</>;
}
