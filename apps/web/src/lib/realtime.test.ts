import { describe, expect, it } from 'vitest';
import { parseSocketFrame, reconnectDelay, socketUrl } from './realtime';
import { parseReferralParams } from './referral';
import { pickBanner } from '@/features/billing/banner';
import type { Subscription } from '@allingo/schemas/api/billing';

describe('giao thức Socket.IO tối giản', () => {
  it('khung Engine.IO: open/ping/close', () => {
    expect(parseSocketFrame('0{"sid":"x","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}')).toEqual({ kind: 'open', pingInterval: 25000, pingTimeout: 20000 });
    expect(parseSocketFrame('2')).toEqual({ kind: 'ping' });
    expect(parseSocketFrame('1')).toEqual({ kind: 'close' });
    expect(parseSocketFrame('6')).toEqual({ kind: 'other' });
  });
  it('packet Socket.IO theo namespace /ws: connect, event, disconnect, connect_error', () => {
    expect(parseSocketFrame('40/ws,{"sid":"abc"}')).toEqual({ kind: 'connect', nsp: '/ws' });
    expect(parseSocketFrame('42/ws,["order.updated",{"order_id":"o1","status":"paid","paid_at":null}]')).toEqual({ kind: 'event', nsp: '/ws', event: 'order.updated', data: { order_id: 'o1', status: 'paid', paid_at: null } });
    expect(parseSocketFrame('42/ws,13["credits.changed",{"balance":5300}]')).toMatchObject({ kind: 'event', event: 'credits.changed', data: { balance: 5300 } });
    expect(parseSocketFrame('42["entitlements.changed",{}]')).toEqual({ kind: 'event', nsp: '/', event: 'entitlements.changed', data: {} });
    expect(parseSocketFrame('41/ws,')).toEqual({ kind: 'disconnect', nsp: '/ws' });
    expect(parseSocketFrame('44/ws,{"message":"Not authorized"}')).toEqual({ kind: 'connect_error', nsp: '/ws', message: 'Not authorized' });
    expect(parseSocketFrame('42/ws,not-json')).toEqual({ kind: 'other' });
  });
  it('URL WebSocket từ base API (bỏ /v1, ws/wss)', () => {
    expect(socketUrl('http://localhost:4000/v1')).toBe('ws://localhost:4000/socket.io/?EIO=4&transport=websocket');
    expect(socketUrl('https://api.allingo.vn/v1')).toBe('wss://api.allingo.vn/socket.io/?EIO=4&transport=websocket');
  });
  it('kết nối lại lũy thừa 2, tối đa 30 s', () => {
    expect(reconnectDelay(0, () => 0.5)).toBe(1000);
    expect(reconnectDelay(3, () => 0.5)).toBe(8000);
    expect(reconnectDelay(10, () => 0.5)).toBe(30_000);
    expect(reconnectDelay(10, () => 1)).toBe(36_000);
  });
});

describe('mã giới thiệu từ link', () => {
  it('đọc ref (in hoa) + UTM, bỏ tham số khác', () => {
    expect(parseReferralParams('?ref=tjrsmewh&utm_source=referral&utm_medium=share&x=1', new Date('2026-11-02T00:00:00Z'))).toEqual({ code: 'TJRSMEWH', utm: { utm_source: 'referral', utm_medium: 'share' }, captured_at: '2026-11-02T00:00:00.000Z' });
  });
  it('mã sai định dạng → null', () => {
    expect(parseReferralParams('?ref=<script>')).toBeNull();
    expect(parseReferralParams('?ref=ab')).toBeNull();
    expect(parseReferralParams('')).toBeNull();
  });
});

describe('banner gói trong AppShell', () => {
  const NOW = Date.parse('2026-11-10T00:00:00Z');
  const sub = (over: Partial<Subscription>): Subscription => ({
    id: 's1',
    plan: { id: 'p', code: 'toeic_pro_monthly', kind: 'monthly', programs: ['toeic'], name: { vi: 'TOEIC Pro', en: 'TOEIC Pro' }, credits_included: 5000, credits_period: 'monthly', duration_days: 30 },
    program: 'toeic',
    status: 'active',
    current_period_start: '2026-10-15T00:00:00Z',
    current_period_end: '2026-11-14T00:00:00Z',
    cancel_at_period_end: false,
    is_current: true,
    upcoming: false,
    days_left: 4,
    source_order_id: 'o1',
    ...over,
  });
  it('dùng thử → trialing; còn ≤ 7 ngày → expiring; còn nhiều ngày / trọn đời → không', () => {
    expect(pickBanner([sub({ status: 'trialing', source_order_id: null })], NOW)?.kind).toBe('trialing');
    expect(pickBanner([sub({})], NOW)?.kind).toBe('expiring');
    expect(pickBanner([sub({ days_left: 20, current_period_end: '2026-11-30T00:00:00Z' })], NOW)).toBeNull();
    expect(pickBanner([sub({}), sub({ id: 's2', status: 'lifetime', current_period_end: null, days_left: null })], NOW)).toBeNull();
  });
  it('đã mua kỳ nối tiếp → không nhắc gia hạn', () => {
    expect(pickBanner([sub({}), sub({ id: 's2', is_current: false, upcoming: true, current_period_start: '2026-11-14T00:00:00Z', current_period_end: '2026-12-14T00:00:00Z', days_left: 34 })], NOW)).toBeNull();
  });
  it('vừa hết hạn (≤ 3 ngày): không có đơn nguồn → hết dùng thử; có đơn → hết hạn; lâu rồi → không', () => {
    const ended = { is_current: false, status: 'expired' as const, current_period_end: '2026-11-08T00:00:00Z', days_left: 0 };
    expect(pickBanner([sub({ ...ended, source_order_id: null })], NOW)?.kind).toBe('trial_ended');
    expect(pickBanner([sub(ended)], NOW)?.kind).toBe('expired');
    expect(pickBanner([sub({ ...ended, current_period_end: '2026-11-01T00:00:00Z' })], NOW)).toBeNull();
  });
});
