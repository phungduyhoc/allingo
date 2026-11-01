'use client';

import * as React from 'react';

/** media query của trình duyệt (SSR/không hỗ trợ → `fallback`) */
export function useMediaQuery(query: string, fallback = false): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
