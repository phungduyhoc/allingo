/// <reference lib="webworker" />
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  RangeRequestsPlugin,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
} from 'serwist';
import { classifyRequest, offlineUrlFor, staticAssetsInHtml, type SwStrategy } from '../lib/pwa/sw-routes';
import { notificationFromPayload, type PushLocale, type PushStrings } from '../lib/pwa/push-payload';

/**
 * Service worker Allingo (thư viện runtime `serwist`), đóng gói bằng esbuild → public/sw.js (xem scripts/build-sw.mjs).
 * - Precache "shell": trang offline (vi/en) + JS/CSS mà trang offline cần (đọc từ HTML lúc cài), manifest, icon.
 *   Không có precache manifest từ bundler (Turbopack) nên dùng revision = build id được inject lúc build.
 * - Runtime (quy tắc ở lib/pwa/sw-routes.ts, có test): _next/static CacheFirst; ảnh/audio StaleWhileRevalidate;
 *   điều hướng: mạng → mất mạng thì trang offline (danh sách đề đã xem lưu cục bộ). KHÔNG cache API (NetworkOnly).
 * - Web Push (S6): `push` → showNotification (title/body null → i18n nhúng lúc build), `notificationclick` → mở/đưa tab lên.
 * - `?dev=1` (đăng ký ở bản dev khi bật cờ – e2e): _next/static NetworkFirst để không giữ chunk cũ khi sửa mã.
 */

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST?: (PrecacheEntry | string)[] };
declare const __SW_BUILD_ID: string;
declare const __API_URL: string;
declare const __PUSH_I18N: Record<PushLocale, PushStrings>;

const BUILD_ID = typeof __SW_BUILD_ID === 'string' ? __SW_BUILD_ID : 'dev';
const API_URL = typeof __API_URL === 'string' ? new URL(__API_URL) : null;
const PUSH_I18N: Record<PushLocale, PushStrings> = typeof __PUSH_I18N === 'object' ? __PUSH_I18N : { vi: {}, en: {} };
const DEV = new URL(self.location.href).searchParams.get('dev') === '1';
const OFFLINE_PAGES = ['/vi/offline', '/en/offline'];
const STATIC_CACHE = 'allingo-static';
/**
 * Trang offline KHÔNG đi qua precache của Serwist: precache tải `/vi/offline?__WB_REVISION__=…` nên HTML mang trạng thái router
 * của URL có query → Next không hydrate khi phục vụ ở URL khác. Tự tải đúng URL `/vi/offline` vào cache theo build id.
 */
const OFFLINE_CACHE = `allingo-offline-${BUILD_ID}`;

const SHELL: PrecacheEntry[] = [
  { url: '/manifest.webmanifest', revision: BUILD_ID },
  { url: '/icons/icon.svg', revision: BUILD_ID },
  { url: '/icons/icon-192.png', revision: BUILD_ID },
];

const strategyOf = (request: Request, url: URL): SwStrategy =>
  classifyRequest({
    url,
    method: request.method,
    destination: request.destination,
    mode: request.mode,
    accept: request.headers.get('accept'),
    origin: self.location.origin,
    apiOrigin: API_URL?.origin ?? '',
    apiPath: API_URL?.pathname ?? '',
  });

const serwist = new Serwist({
  precacheEntries: [...SHELL, ...(self.__SW_MANIFEST ?? [])],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: [
    { matcher: ({ request, url }) => strategyOf(request, url) === 'api', handler: new NetworkOnly() },
    {
      matcher: ({ request, url }) => strategyOf(request, url) === 'static',
      handler: DEV
        ? new NetworkFirst({ cacheName: STATIC_CACHE, networkTimeoutSeconds: 10 })
        : new CacheFirst({
            cacheName: STATIC_CACHE,
            plugins: [new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: 30 * 24 * 3600 })],
          }),
    },
    {
      matcher: ({ request, url }) => strategyOf(request, url) === 'image',
      handler: new StaleWhileRevalidate({
        cacheName: 'allingo-images',
        plugins: [
          new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 14 * 24 * 3600 }),
          new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
      }),
    },
    {
      matcher: ({ request, url }) => strategyOf(request, url) === 'audio',
      handler: new StaleWhileRevalidate({
        cacheName: 'allingo-audio',
        plugins: [
          new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 7 * 24 * 3600 }),
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new RangeRequestsPlugin(),
        ],
      }),
    },
    // Điều hướng: luôn đi mạng (trang app lấy dữ liệu qua API) – lỗi mạng → trang offline theo locale (đã lưu lúc cài)
    {
      matcher: ({ request, url }) => strategyOf(request, url) === 'page',
      handler: new NetworkOnly({
        plugins: [
          {
            handlerDidError: async ({ request }) => {
              const url = new URL(request.url);
              const target = offlineUrlFor(url.pathname);
              const cache = await caches.open(OFFLINE_CACHE);
              // Chính trang offline → trả bản đã lưu (đúng URL – Next hydrate được)
              if (OFFLINE_PAGES.includes(url.pathname)) return (await cache.match(url.pathname)) ?? undefined;
              // Trang khác → chuyển hướng sang trang offline (HTML của /vi/offline phục vụ ở URL khác thì Next không hydrate),
              // giữ đường dẫn gốc trong #from để "Tải lại" quay về đúng trang khi có mạng
              if (!(await cache.match(target))) return undefined;
              return Response.redirect(
                `${self.location.origin}${target}#from=${encodeURIComponent(url.pathname + url.search)}`,
                302,
              );
            },
          },
        ],
      }),
    },
  ],
});

/** Cài đặt: lưu trang offline (vi/en) + JS/CSS mà trang đó cần để hydrate được khi không có mạng */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(OFFLINE_CACHE);
      const statics = await caches.open(STATIC_CACHE);
      for (const page of OFFLINE_PAGES) {
        const res = await fetch(page, { credentials: 'same-origin', cache: 'reload' });
        if (!res.ok) throw new Error(`offline page ${page}: ${res.status}`);
        await pages.put(page, res.clone());
        const assets = staticAssetsInHtml(await res.text());
        await Promise.all(assets.map((a) => statics.add(a).catch(() => undefined)));
      }
    })(),
  );
});

/** Kích hoạt: xoá trang offline của build cũ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith('allingo-offline-') && name !== OFFLINE_CACHE) await caches.delete(name);
    })(),
  );
});

self.addEventListener('push', (event) => {
  let raw: unknown = null;
  try {
    raw = event.data?.json() ?? null;
  } catch {
    raw = event.data?.text() ?? null;
  }
  const n = notificationFromPayload(raw, PUSH_I18N);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  const target = new URL(data.url ?? '/vi/toeic/dashboard', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if (new URL(existing.url).pathname !== target.pathname)
          await existing.navigate(target.href).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

serwist.addEventListeners();
