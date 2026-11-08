import { describe, expect, it } from 'vitest';
import { isMissingAppRoute } from './app-routes';

const ID = '3f2b8c1e-1d2a-4b3c-8d4e-123456789abc';

describe('B6/S152 – route (app) sai dạng → 404 thật ở proxy', () => {
  it('mục admin / tab billing không có → thiếu; mục hợp lệ → không', () => {
    expect(isMissingAppRoute('/admin/khong-co')).toBe(true);
    expect(isMissingAppRoute('/admin/beta')).toBe(false);
    expect(isMissingAppRoute('/admin/system/')).toBe(false);
    expect(isMissingAppRoute('/admin/billing')).toBe(false);
    expect(isMissingAppRoute('/admin/billing/orders')).toBe(false);
    expect(isMissingAppRoute('/admin/billing/khong-co')).toBe(true);
    expect(isMissingAppRoute('/admin/billing/orders/them')).toBe(true);
    expect(isMissingAppRoute('/admin')).toBe(false);
  });

  it('id không phải UUID ở attempts / ticket / đơn hàng → thiếu', () => {
    for (const p of [`/attempts/${ID}`, `/attempts/${ID}/result`, `/attempts/${ID}/review`, `/support/tickets/${ID}`, `/account/orders/${ID}`]) expect(isMissingAppRoute(p), p).toBe(false);
    for (const p of ['/attempts/abc', '/attempts/abc/review', '/support/tickets/1', '/account/orders/x-y']) expect(isMissingAppRoute(p), p).toBe(true);
  });

  it('đường dẫn khác không đụng tới (route tĩnh, marketing, catch-all tự xử lý)', () => {
    for (const p of ['/', '/toeic/dashboard', '/support', '/support/tickets', '/lessons/les-9', '/toeic/vocab/review', '/blog/abc', '/khong-ton-tai']) expect(isMissingAppRoute(p), p).toBe(false);
  });
});
