import { readFileSync } from 'node:fs';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * S10: biến SERVER-ONLY của web (webhook revalidate CMS, URL CMS) đọc từ `.env` gốc repo khi chưa có trong môi trường (Next chỉ tự
 * nạp `.env` của apps/web). Không nạp NEXT_PUBLIC_* ở đây (giữ nguyên cách inline lúc build). Biến đã đặt sẵn luôn thắng.
 */
const ROOT_ENV_KEYS = ['WEB_REVALIDATE_SECRET', 'CMS_URL', 'CMS_PUBLIC_URL'];
function loadRootEnv(): void {
  let text = '';
  try {
    text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || !ROOT_ENV_KEYS.includes(m[1]!) || process.env[m[1]!] !== undefined) continue;
    const value = m[2]!.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value) process.env[m[1]!] = value;
  }
}
loadRootEnv();

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Ghi chú PWA: `@serwist/next` (chế độ withSerwist) chỉ hoạt động với webpack, trong khi Next 16 build bằng Turbopack
 * mặc định và dừng build khi thấy cấu hình webpack. Service worker vì vậy được đóng gói riêng bằng esbuild
 * (`pnpm sw:build`, chạy tự động ở `prebuild`) từ `src/app/sw.ts` dùng thư viện runtime `serwist`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Đóng gói container (apps/web/Dockerfile): server.js + node_modules tối thiểu trong .next/standalone
  output: 'standalone',
  // Không sinh AGENTS.md tự động trong apps/web (quy tắc repo nằm ở CLAUDE.md gốc)
  agentRules: false,
  transpilePackages: ['@allingo/ui', '@allingo/i18n'],
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  turbopack: {},
  headers: async () => [
    {
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    },
  ],
};

export default withNextIntl(nextConfig);
