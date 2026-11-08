import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '@allingo/schemas/api/billing';
import { EMPTY_FEED, badgeText, feedReducer, type NotificationFeed } from './feed';

const item = (id: string, at: string, read = false, channel = 'inapp'): NotificationItem => ({
  id,
  channel,
  template_code: 'billing.order_paid',
  payload: {},
  status: 'sent',
  scheduled_at: at,
  sent_at: at,
  read_at: read ? at : null,
  category: 'billing',
  title: null,
  body: null,
  url: null,
});

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const loaded = (): NotificationFeed =>
  feedReducer(EMPTY_FEED, { type: 'loaded', page: { data: [item(ID(2), '2026-11-02T02:00:00Z'), item(ID(1), '2026-11-01T02:00:00Z', true)], next_cursor: 'c1', unread_count: 1 } });

describe('feedReducer – hộp thông báo in-app', () => {
  it('loaded: lấy trang đầu + số chưa đọc của server, bỏ hàng kênh khác', () => {
    const s = feedReducer(EMPTY_FEED, { type: 'loaded', page: { data: [item(ID(1), '2026-11-01T00:00:00Z'), item(ID(2), '2026-11-01T00:00:00Z', false, 'email')], next_cursor: null, unread_count: 1 } });
    expect(s.items.map((n) => n.id)).toEqual([ID(1)]);
    expect(s.unread).toBe(1);
  });
  it('received (Socket.IO notification.new): thêm lên đầu, tăng chưa đọc; trùng id → không đếm lại', () => {
    const s1 = feedReducer(loaded(), { type: 'received', item: item(ID(3), '2026-11-02T05:00:00Z') });
    expect(s1.items[0]!.id).toBe(ID(3));
    expect(s1.unread).toBe(2);
    const s2 = feedReducer(s1, { type: 'received', item: item(ID(3), '2026-11-02T05:00:00Z') });
    expect(s2.items).toHaveLength(3);
    expect(s2.unread).toBe(2);
  });
  it('received: sự kiện đến muộn (cũ hơn) vẫn sắp đúng thứ tự mới → cũ', () => {
    const s = feedReducer(loaded(), { type: 'received', item: item(ID(4), '2026-11-01T12:00:00Z') });
    expect(s.items.map((n) => n.id)).toEqual([ID(2), ID(4), ID(1)]);
  });
  it('read: đánh dấu một thông báo (idempotent), giảm chưa đọc không âm', () => {
    const s1 = feedReducer(loaded(), { type: 'read', id: ID(2), at: '2026-11-02T06:00:00Z' });
    expect(s1.unread).toBe(0);
    expect(s1.items[0]!.read_at).toBe('2026-11-02T06:00:00Z');
    const s2 = feedReducer(s1, { type: 'read', id: ID(2), at: '2026-11-02T07:00:00Z' });
    expect(s2).toBe(s1);
    expect(feedReducer(s1, { type: 'read', id: ID(1), at: 'x' })).toBe(s1);
  });
  it('readAll: mọi thông báo đã đọc, số chưa đọc theo server', () => {
    const s = feedReducer(feedReducer(loaded(), { type: 'received', item: item(ID(3), '2026-11-02T05:00:00Z') }), { type: 'readAll', at: '2026-11-02T08:00:00Z', unread_count: 0 });
    expect(s.unread).toBe(0);
    expect(s.items.every((n) => n.read_at)).toBe(true);
  });
  it('appended: nối trang sau theo cursor, bỏ trùng', () => {
    const s = feedReducer(loaded(), { type: 'appended', page: { data: [item(ID(1), '2026-11-01T02:00:00Z', true), item(ID(5), '2026-10-30T00:00:00Z')], next_cursor: null } });
    expect(s.items.map((n) => n.id)).toEqual([ID(2), ID(1), ID(5)]);
    expect(s.next_cursor).toBeNull();
    expect(s.unread).toBe(1);
  });
  it('badgeText: ẩn khi 0, 99+ khi nhiều', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(120)).toBe('99+');
  });
});
