import type { MetadataRoute } from 'next';

/**
 * Web App Manifest (PWA – Sprint 6): cài được trên Chrome Android/desktop (tên, start_url, display standalone, icon 192/512 PNG
 * + maskable), `id` cố định để trình duyệt nhận đúng một ứng dụng, shortcuts tới Ghi chú/Đề thi. Màu navy/gold theo thương hiệu.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Allingo – Ngoại ngữ cho tất cả',
    short_name: 'Allingo',
    description: 'Nền tảng luyện thi AI cho TOEIC, IELTS, JLPT và HSK.',
    start_url: '/vi/toeic/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F6F7FB',
    theme_color: '#0B1F4B',
    lang: 'vi',
    dir: 'ltr',
    categories: ['education'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Đề thi',
        short_name: 'Đề thi',
        url: '/vi/toeic/test-sets',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Ghi chú của tôi',
        short_name: 'Ghi chú',
        url: '/vi/notes',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
