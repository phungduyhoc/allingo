import type { NextConfig } from 'next';
import { withPayload } from '@payloadcms/next/withPayload';

/**
 * Cấu hình Next.js cho Payload CMS (cổng 3001).
 * `withPayload` bổ sung cấu hình bắt buộc (externals, sass, turbopack) cho admin UI của Payload.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Thư viện Payload + Drizzle chạy ở server, không bundle
  serverExternalPackages: ['@allingo/db', 'pg', 'drizzle-kit'],
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
