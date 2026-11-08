#!/usr/bin/env node
/**
 * Đóng gói service worker src/app/sw.ts → public/sw.js bằng esbuild CLI (devDependency trực tiếp của apps/web).
 * Lý do không dùng @serwist/next: plugin webpack không chạy với Turbopack (mặc định của Next 16) – xem next.config.ts.
 * Dùng: `pnpm sw:build` (tự chạy ở `prebuild`).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/app/sw.ts');
const out = resolve(root, 'public/sw.js');
const buildId = process.env.SW_BUILD_ID ?? randomUUID().slice(0, 8);
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
const apiOrigin = new URL(apiUrl).origin;
// Chuỗi thông báo đẩy (push.<template>.title|body) nhúng vào SW – SW không dùng được next-intl
const messagesDir = resolve(root, '../../packages/i18n/src/messages');
const pushI18n = Object.fromEntries(
  ['vi', 'en'].map((locale) => {
    try {
      const messages = JSON.parse(readFileSync(resolve(messagesDir, `${locale}.json`), 'utf8'));
      return [locale, messages.push ?? {}];
    } catch {
      return [locale, {}];
    }
  }),
);

mkdirSync(dirname(out), { recursive: true });
const bin = resolve(root, 'node_modules/.bin/esbuild');
// esbuild là devDependency trực tiếp của apps/web → thiếu binary nghĩa là cài đặt hỏng; dừng hẳn thay vì bỏ qua
// (trước đây bỏ qua im lặng khiến CI/Docker build ra bản không có service worker – PWA offline/push không chạy)
if (!existsSync(bin)) {
  console.error('[sw:build] esbuild binary not found at node_modules/.bin/esbuild – run `pnpm install` (esbuild là devDependency của @allingo/web).');
  process.exit(1);
}

execFileSync(
  bin,
  [
    entry,
    '--bundle',
    '--minify',
    '--format=iife',
    '--target=es2020',
    `--outfile=${out}`,
    '--define:process.env.NODE_ENV="production"',
    `--define:__SW_BUILD_ID="${buildId}"`,
    `--define:__API_URL=${JSON.stringify(new URL(apiUrl).href)}`,
    `--define:__PUSH_I18N=${JSON.stringify(pushI18n)}`,
  ],
  { stdio: 'inherit', cwd: root },
);
console.log(`[sw:build] public/sw.js built (build ${buildId}, api origin ${apiOrigin})`);
