import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 6 – PWA: manifest hợp lệ (tên, icon 192/512 + maskable, theme), service worker đăng ký (bản dev bật bằng cờ
 * `allingo.sw.dev`), cache KHÔNG chứa phản hồi API, mất mạng (`context.setOffline(true)`) → trang offline + danh sách đề đã
 * xem (lưu cục bộ), banner cài đặt sau 2 lần truy cập, đăng ký Web Push khi quyền đã cấp (`grantPermissions`) và SW hiển thị
 * thông báo khi nhận `push` (CDP ServiceWorker.deliverPushMessage).
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
const API_ORIGIN = new URL(API).origin;
const PART5 = { mock: 'toeic-p5-mini-01', real: 'toeic-mini-part5-01' };

/** Bản dev: SW chỉ đăng ký khi bật cờ (production luôn đăng ký) */
async function enableDevSw(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('allingo.sw.dev', '1');
    } catch {
      /* ignore */
    }
  });
}

/** Chờ SW kích hoạt + điều khiển trang + precache trang offline xong */
async function waitForSw(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return !!reg?.active && reg.active.state === 'activated';
    },
    undefined,
    { timeout: 60_000 },
  );
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  // Precache của Serwist lưu khoá kèm `__WB_REVISION__` → so khớp bỏ query
  await expect
    .poll(() => page.evaluate(async () => !!(await caches.match('/vi/offline', { ignoreSearch: true }))), {
      timeout: 60_000,
    })
    .toBe(true);
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url);
    return out;
  });
}

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
});

test('manifest hợp lệ: tên, start_url, standalone, theme, icon 192/512 PNG + maskable', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    id?: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  expect(m.name).toContain('Allingo');
  expect(m.short_name).toBe('Allingo');
  expect(m.start_url).toMatch(/^\//);
  expect(m.display).toBe('standalone');
  expect(m.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  expect(m.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png')).toBe(true);
  expect(
    m.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png' && (i.purpose ?? 'any').includes('any')),
  ).toBe(true);
  expect(m.icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBe(true);
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type']).toContain(icon.type.split('+')[0]!);
  }
});

test('SW đăng ký → cache không có API; mất mạng → trang offline + đề đã xem; có mạng lại → tải lại', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await enableDevSw(page);
  await startAsGuest(page);
  await waitForSw(page);
  // Dùng app: làm + nộp một đề mini (ghi "đề đã xem"), xem kết quả + xem lại (gọi nhiều API)
  await startTestSet(page, PART5, 'exam');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await page.getByTestId('review-link').click();
  await expect(page.getByTestId('review-item-1')).toBeVisible();

  // Cache: shell (offline vi/en, manifest, icon) có; KHÔNG có URL nào của API
  const urls = await cachedUrls(page);
  const paths = urls.map((u) => new URL(u).pathname);
  expect(paths).toContain('/vi/offline');
  expect(paths).toContain('/en/offline');
  expect(paths).toContain('/manifest.webmanifest');
  // JS/CSS của trang offline được lưu lúc cài để trang offline hydrate được khi mất mạng
  expect(paths.some((p) => p.startsWith('/_next/static/'))).toBe(true);
  expect(urls.filter((u) => u.startsWith(API_ORIGIN))).toEqual([]);
  expect(urls.filter((u) => /\/(attempts|ai|notes|dictionary|me)\//.test(new URL(u).pathname))).toEqual([]);

  // Mất mạng → điều hướng (mở app) → SW chuyển sang trang offline (#from = trang định mở) + danh sách đề đã xem lưu trên máy
  const devSw = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.includes('dev=1') ?? false);
  await context.setOffline(true);
  await page.goto('/vi/toeic/dashboard');
  await expect(page).toHaveURL(/\/vi\/offline#from=%2Fvi%2Ftoeic%2Fdashboard$/);
  await expect(page.getByTestId('offline-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bạn đang ngoại tuyến' })).toBeVisible();
  if (devSw) {
    // Bản dev (next dev): HTML lưu sẵn mang request id của kênh debug Turbopack (`self.__next_r`) nên không hydrate khi
    // phục vụ lại – danh sách "đề đã xem" (cần JS) chỉ kiểm tra trên bản production (`next build && next start`)
    test
      .info()
      .annotations.push({
        type: 'offline-hydrate',
        description: 'dev server: chỉ kiểm tra HTML trang offline; danh sách đề đã xem kiểm tra ở bản production',
      });
    await context.setOffline(false);
    return;
  }
  const viewed = page.getByTestId('offline-viewed-item');
  await expect(viewed.first()).toBeVisible();
  await expect(page.getByTestId('offline-viewed')).toContainText('Part 5');
  await expect(viewed.filter({ has: page.locator('[href*="/review"]') })).toHaveCount(1);
  // Có mạng lại → "Tải lại" → về đúng trang định mở
  await context.setOffline(false);
  await page.getByTestId('offline-retry').click();
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard$/);
  await expect(page.getByTestId('dashboard-tutor')).toBeVisible();
});

test('Banner cài đặt chỉ hiện từ lần truy cập thứ 2 (beforeinstallprompt) → Cài đặt gọi prompt()', async ({
  context,
  page,
}) => {
  await startAsGuest(page);
  await fireInstallPrompt(page);
  await expect(page.getByTestId('install-banner')).toHaveCount(0);
  // Lần truy cập thứ 2 = phiên mới (thẻ mới)
  const second = await context.newPage();
  await second.goto('/vi/toeic/dashboard');
  await expect(second.getByTestId('dashboard-tutor')).toBeVisible();
  await fireInstallPrompt(second);
  const banner = second.getByTestId('install-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-mode', 'prompt');
  await banner.getByTestId('install-cta').click();
  await expect
    .poll(() => second.evaluate(() => (window as unknown as { __promptCalled?: boolean }).__promptCalled === true))
    .toBe(true);
  await expect(banner).toHaveCount(0);
  // "Để sau"/đã chọn → không hiện lại khi có prompt mới
  await second.reload();
  await expect(second.getByTestId('dashboard-tutor')).toBeVisible();
  await fireInstallPrompt(second);
  await expect(second.getByTestId('install-banner')).toHaveCount(0);
});

/** Phát beforeinstallprompt giả (Chrome thật chỉ phát khi đủ tiêu chí cài đặt + tương tác) */
async function fireInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __promptCalled: boolean }).__promptCalled = true;
    };
    ev.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(ev);
  });
}

test('Web Push: quyền đã cấp → bật thông báo (đăng ký VAPID + POST /me/push-subscriptions) → SW hiện thông báo khi nhận push', async ({
  page,
  context,
  browserName,
}) => {
  test.setTimeout(180_000);
  test.skip(browserName !== 'chromium', 'CDP chỉ có trên Chromium');
  await context.grantPermissions(['notifications']);
  await enableDevSw(page);
  await startAsGuest(page);
  await waitForSw(page);
  await page.goto('/vi/settings/notifications');
  const card = page.getByTestId('push-card');
  await expect(card).toHaveAttribute('data-support', 'supported');
  await expect(card).toHaveAttribute('data-permission', 'granted');

  // 1) Thử pushManager.subscribe thật (Chrome headless có thể không có dịch vụ push → ghi rõ)
  const posts: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/me/push-subscriptions') && r.request().method() === 'POST') posts.push(r.status());
  });
  await card.getByTestId('push-enable').click();
  await expect(card.getByTestId('push-enabled').or(card.getByTestId('push-error'))).toBeVisible({ timeout: 30_000 });
  const realPush = await card.getByTestId('push-enabled').isVisible();
  test
    .info()
    .annotations.push({
      type: 'push-service',
      description: realPush
        ? 'pushManager.subscribe thành công (Chrome có dịch vụ push)'
        : `pushManager.subscribe thất bại trong Chrome headless: ${(await card.getByTestId('push-error').textContent()) ?? ''}`,
    });

  if (!realPush) {
    // 2) Không có dịch vụ push → giả lập PushManager.subscribe (endpoint/khoá đúng định dạng) để kiểm tra luồng đăng ký với API
    await stubPushManager(context);
    await page.reload();
    await card.getByTestId('push-enable').click();
    await expect(card.getByTestId('push-enabled')).toBeVisible({ timeout: 30_000 });
  }
  if (REAL) {
    await expect.poll(() => posts.at(-1)).toBeDefined();
    expect([200, 201]).toContain(posts.at(-1));
  }
  await expect(card.getByTestId('push-device')).toHaveCount(1);
  await expect(card.getByTestId('push-device')).toContainText('Thiết bị này');

  // 3) SW nhận push (payload title/body null → dịch theo template) → showNotification
  const cdp = await context.newCDPSession(page);
  const registrationId = await new Promise<string>((resolve) => {
    cdp.on(
      'ServiceWorker.workerRegistrationUpdated',
      (e: { registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] }) => {
        const reg = e.registrations.find((r) => !r.isDeleted && r.scopeURL.endsWith('/'));
        if (reg) resolve(reg.registrationId);
      },
    );
    void cdp.send('ServiceWorker.enable');
  });
  const origin = new URL(page.url()).origin;
  const payload = {
    v: 1,
    notification_id: '00000000-0000-4000-8000-000000000999',
    template_code: 'study_reminder',
    title: null,
    body: null,
    url: '/toeic/dashboard',
    tag: 'e2e-study',
    locale: 'vi',
    sent_at: new Date().toISOString(),
  };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(payload) });
  await expect
    .poll(
      async () =>
        page.evaluate(async () =>
          (await (await navigator.serviceWorker.getRegistration('/'))!.getNotifications()).map((n) => ({
            title: n.title,
            body: n.body,
            tag: n.tag,
            url: (n.data as { url?: string })?.url,
          })),
        ),
      { timeout: 15_000 },
    )
    .toEqual([
      {
        title: 'Đến giờ học rồi!',
        body: 'Dành 15 phút luyện TOEIC hôm nay để giữ chuỗi ngày học nhé.',
        tag: 'e2e-study',
        url: '/vi/toeic/dashboard',
      },
    ]);

  // 4) Tắt trên thiết bị này → huỷ đăng ký (DELETE)
  await card.getByTestId('push-disable').click();
  await expect(card.getByTestId('push-enable')).toBeVisible();
  await expect(card.getByTestId('push-devices-empty')).toBeVisible();
});

/** PushManager giả: trả đăng ký có endpoint https + khoá p256dh/auth đúng độ dài (Chrome headless không có FCM) */
async function stubPushManager(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const p256dh = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
    const auth = 'tBHItJI5svbpez7KI4CCXg';
    let current: PushSubscription | null = null;
    const make = (key: BufferSource | string | null | undefined): PushSubscription => {
      const sub = {
        endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`,
        expirationTime: null,
        options: {
          userVisibleOnly: true,
          applicationServerKey: key instanceof ArrayBuffer ? key : ArrayBuffer.isView(key) ? key.buffer : null,
        },
        getKey: () => null,
        toJSON: () => ({ endpoint: sub.endpoint, expirationTime: null, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      };
      return sub;
    };
    PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
      current = make(opts?.applicationServerKey);
      return current;
    };
    PushManager.prototype.getSubscription = async function () {
      return current;
    };
  });
}
