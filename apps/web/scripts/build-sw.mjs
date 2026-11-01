#!/usr/bin/env node
/**
 * Đóng gói service worker src/app/sw.ts → public/sw.js bằng esbuild CLI (có sẵn trong node_modules/.bin qua vitest/vite).
 * Lý do không dùng @serwist/next: plugin webpack không chạy với Turbopack (mặc định của Next 16) – xem next.config.ts.
 * Dùng: `pnpm sw:build` (tự chạy ở `prebuild`).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/app/sw.ts');
const out = resolve(root, 'public/sw.js');
const buildId = process.env.SW_BUILD_ID ?? randomUUID().slice(0, 8);
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
const apiOrigin = new URL(apiUrl).origin;

mkdirSync(dirname(out), { recursive: true });
const bin = resolve(root, 'node_modules/.bin/esbuild');
if (!existsSync(bin)) {
  console.error('[sw:build] esbuild binary not found at node_modules/.bin/esbuild – skip service worker build.');
  process.exit(0);
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
    `--define:__API_ORIGIN="${apiOrigin}"`,
  ],
  { stdio: 'inherit', cwd: root },
);
console.log(`[sw:build] public/sw.js built (build ${buildId}, api origin ${apiOrigin})`);
