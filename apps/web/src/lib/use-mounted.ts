'use client';

import * as React from 'react';

const subscribe = () => () => undefined;

/** true sau khi hydrate ở client (false khi render server) – không gây setState trong effect */
export function useMounted(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** Đọc một giá trị chỉ có ở client (localStorage…) an toàn với hydration; server trả `fallback` */
export function useClientValue<T>(read: () => T, fallback: T): T {
  return React.useSyncExternalStore(
    subscribe,
    () => read(),
    () => fallback,
  );
}
