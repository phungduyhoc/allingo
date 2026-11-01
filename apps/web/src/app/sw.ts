/// <reference lib="webworker" />
import { CacheableResponsePlugin, CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, RangeRequestsPlugin, Serwist, StaleWhileRevalidate, type PrecacheEntry } from 'serwist';

/**
 * Service worker Allingo (thư viện runtime `serwist`), đóng gói bằng esbuild → public/sw.js (xem scripts/build-sw.mjs).
 * - Precache "shell": trang offline (vi/en), manifest, icon. Không có precache manifest từ bundler (Turbopack) nên
 *   dùng revision = build id được inject lúc build.
 * - Runtime: _next/static CacheFirst; ảnh/audio StaleWhileRevalidate; điều hướng NetworkFirst với fallback offline.
 * - KHÔNG cache API (origin NEXT_PUBLIC_API_URL): NetworkOnly để dữ liệu bài làm/credit luôn mới.
 */

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST?: (PrecacheEntry | string)[] };
declare const __SW_BUILD_ID: string;
declare const __API_ORIGIN: string;

const BUILD_ID = typeof __SW_BUILD_ID === 'string' ? __SW_BUILD_ID : 'dev';
const API_ORIGIN = typeof __API_ORIGIN === 'string' ? __API_ORIGIN : '';

const SHELL: PrecacheEntry[] = [
  { url: '/vi/offline', revision: BUILD_ID },
  { url: '/en/offline', revision: BUILD_ID },
  { url: '/manifest.webmanifest', revision: BUILD_ID },
  { url: '/icons/icon.svg', revision: BUILD_ID },
  { url: '/icons/icon-192.png', revision: BUILD_ID },
];

const serwist = new Serwist({
  precacheEntries: [...SHELL, ...(self.__SW_MANIFEST ?? [])],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [
    {
      // API: không cache
      matcher: ({ url }) => API_ORIGIN !== '' && url.origin === API_ORIGIN,
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({ cacheName: 'allingo-static', plugins: [new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: 30 * 24 * 3600 })] }),
    },
    {
      matcher: ({ request, url }) => request.destination === 'image' || /\.(png|jpg|jpeg|webp|avif|svg|gif|ico)$/i.test(url.pathname),
      handler: new StaleWhileRevalidate({ cacheName: 'allingo-images', plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 14 * 24 * 3600 }), new CacheableResponsePlugin({ statuses: [0, 200] })] }),
    },
    {
      matcher: ({ request, url }) => request.destination === 'audio' || /\.(wav|mp3|m4a|ogg|aac)$/i.test(url.pathname),
      handler: new StaleWhileRevalidate({
        cacheName: 'allingo-audio',
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 7 * 24 * 3600 }), new CacheableResponsePlugin({ statuses: [0, 200] }), new RangeRequestsPlugin()],
      }),
    },
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
      handler: new NetworkFirst({ cacheName: 'allingo-pages', networkTimeoutSeconds: 8, plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 3600 })] }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: '/vi/offline',
        matcher: ({ request }) => request.destination === 'document' && !new URL(request.url).pathname.startsWith('/en/'),
      },
      {
        url: '/en/offline',
        matcher: ({ request }) => request.destination === 'document' && new URL(request.url).pathname.startsWith('/en/'),
      },
    ],
  },
});

serwist.addEventListeners();
