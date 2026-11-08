import { defineConfig, devices } from '@playwright/test';

/**
 * E2E web. Mặc định chạy với API giả lập (NEXT_PUBLIC_API_MOCK=1) để không cần API/DB;
 * đặt E2E_REAL_API=1 để chạy với API thật ở NEXT_PUBLIC_API_URL (cần seed demo).
 */
const useMock = process.env.E2E_REAL_API !== '1';
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// Tham số Chrome thêm (vd. `--disable-web-security` khi chạy bản production ở cổng khác 3000 mà API chỉ cho CORS :3000)
const chromeArgs = process.env.E2E_CHROME_ARGS?.split(' ').filter(Boolean) ?? [];
const launchOptions = chromeArgs.length ? { args: chromeArgs } : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'vi-VN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // E2E_CHROME_CHANNEL=chrome để dùng Google Chrome cài sẵn trên máy khi chưa tải được Chromium của Playwright
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_CHROME_CHANNEL, launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.E2E_CHROME_CHANNEL, launchOptions } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // public/sw.js bị gitignore và chỉ dựng ở `prebuild` → CI (máy sạch, `next dev`) không có SW → test PWA đỏ: dựng SW trước
        command: 'node scripts/build-sw.mjs && pnpm exec next dev -p 3000',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_API_MOCK: useMock ? '1' : '0',
          NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1',
          NEXT_PUBLIC_APP_URL: baseURL,
        },
      },
});
