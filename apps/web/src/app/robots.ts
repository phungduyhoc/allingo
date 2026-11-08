import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo/site';

/** /robots.txt – cho phép marketing/blog; chặn khu vực học (cần đăng nhập), API route, cổng thanh toán giả lập, trang quản lý */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const app = ['toeic/dashboard', 'toeic/today', 'toeic/plan', 'toeic/test-sets', 'toeic/practice', 'toeic/diagnostic', 'toeic/vocab', 'toeic/errors', 'toeic/stats', 'attempts', 'account', 'admin', 'checkout', 'settings', 'notes', 'notifications', 'onboarding', 'badges', 'referral', 'lessons', 'vocab', 'mock-gateway', 'offline', 'support', 'beta'];
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', ...['vi', 'en'].flatMap((l) => app.map((p) => `/${l}/${p}`))] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
