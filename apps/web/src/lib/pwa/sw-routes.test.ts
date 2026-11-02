import { describe, expect, it } from 'vitest';
import { classifyRequest, isApiRequest, offlineUrlFor, staticAssetsInHtml, type SwRequestInfo } from './sw-routes';

const ORIGIN = 'https://app.allingo.vn';
const req = (url: string, over: Partial<SwRequestInfo> = {}): SwRequestInfo => ({
  url: new URL(url, ORIGIN),
  method: 'GET',
  destination: '',
  mode: 'cors',
  accept: null,
  origin: ORIGIN,
  apiOrigin: 'https://api.allingo.vn',
  apiPath: '/v1',
  ...over,
});

describe('service worker – KHÔNG cache API', () => {
  const apiUrls = [
    'https://api.allingo.vn/v1/attempts/123/review',
    'https://api.allingo.vn/v1/attempts/123/result',
    'https://api.allingo.vn/v1/ai/threads/abc',
    'https://api.allingo.vn/v1/dictionary/lookup?q=invoice',
    'https://api.allingo.vn/v1/notes?q=by',
    'https://api.allingo.vn/v1/me/entitlements?program=toeic',
    // media ký từ storage của API (bài nói/ghi âm là dữ liệu cá nhân) – cũng không cache
    'https://api.allingo.vn/v1/storage/fs/media/tts/80/x.mp3?exp=1&sig=a',
  ];
  it.each(apiUrls)('%s → api (NetworkOnly)', (u) => {
    expect(classifyRequest(req(u, { destination: u.endsWith('mp3?exp=1&sig=a') ? 'audio' : '' }))).toBe('api');
  });

  it('API cùng origin dưới apiPath, /api/* của Next và luồng SSE → api', () => {
    expect(classifyRequest(req('/v1/attempts/1/review', { apiOrigin: ORIGIN }))).toBe('api');
    expect(isApiRequest(req('/v1/attempts/1', { apiOrigin: '' }))).toBe(true);
    expect(classifyRequest(req('/api/health'))).toBe('api');
    expect(classifyRequest(req('/vi/something', { accept: 'text/event-stream' }))).toBe('api');
  });

  it('không phải GET → không xử lý (POST /ai/threads/{id}/messages, PUT answers)', () => {
    expect(classifyRequest(req('https://api.allingo.vn/v1/ai/threads/1/messages', { method: 'POST' }))).toBe('none');
    expect(classifyRequest(req('/vi/toeic/dashboard', { method: 'POST', mode: 'navigate' }))).toBe('none');
  });
});

describe('service worker – tài nguyên tĩnh, ảnh/audio, điều hướng', () => {
  it('_next/static → static; ảnh/audio → image/audio (SWR); điều hướng → page', () => {
    expect(classifyRequest(req('/_next/static/chunks/app.js', { destination: 'script' }))).toBe('static');
    expect(classifyRequest(req('/icons/icon-192.png', { destination: 'image' }))).toBe('image');
    expect(classifyRequest(req('https://cdn.allingo.vn/q/p1.webp?sig=1', { destination: 'image' }))).toBe('image');
    expect(classifyRequest(req('/demo-audio/p2-01.wav', { destination: 'audio' }))).toBe('audio');
    expect(classifyRequest(req('/vi/toeic/dashboard', { mode: 'navigate', destination: 'document' }))).toBe('page');
  });
  it('RSC/dữ liệu Next, sw.js, trang khác origin → none', () => {
    expect(classifyRequest(req('/vi/toeic/dashboard?_rsc=abc'))).toBe('none');
    expect(classifyRequest(req('/_next/image?url=x'))).toBe('none');
    expect(classifyRequest(req('/sw.js'))).toBe('none');
    expect(classifyRequest(req('https://other.example/page', { mode: 'navigate' }))).toBe('none');
  });
  it('trang offline theo locale', () => {
    expect(offlineUrlFor('/en/toeic/dashboard')).toBe('/en/offline');
    expect(offlineUrlFor('/en')).toBe('/en/offline');
    expect(offlineUrlFor('/vi/notes')).toBe('/vi/offline');
    expect(offlineUrlFor('/english-test')).toBe('/vi/offline');
  });
  it('staticAssetsInHtml lấy JS/CSS/font _next/static (bỏ trùng, giải mã &amp;)', () => {
    const html =
      '<link rel="stylesheet" href="/_next/static/css/a.css"/><script src="/_next/static/chunks/b.js?v=1&amp;x=2" async></script><script src="/_next/static/chunks/b.js?v=1&amp;x=2"></script><img src="/_next/static/media/c.png"/><script src="https://cdn.x/y.js"></script>';
    expect(staticAssetsInHtml(html)).toEqual(['/_next/static/css/a.css', '/_next/static/chunks/b.js?v=1&x=2']);
  });
});
