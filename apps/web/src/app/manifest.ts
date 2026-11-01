import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
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
    categories: ['education'],
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
