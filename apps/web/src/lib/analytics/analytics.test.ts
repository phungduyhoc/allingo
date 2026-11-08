import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attributionField, attributionFromLocation, captureAttribution, cleanUtm, readAttribution } from './attribution';
import { ANON_ID_KEY, anonymousId, CONSENT_KEY, hasAnalyticsConsent, parseConsent, readConsent, writeConsent, type KeyValueStore } from './consent';
import { resetTrackedForTest, trackFunnel } from './track';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('đồng ý cookie (consent gate)', () => {
  it('mặc định chưa đồng ý; lưu/đọc lựa chọn; phiên bản cũ hoặc hỏng → hỏi lại', () => {
    const s = memory();
    expect(readConsent(s)).toBeNull();
    expect(hasAnalyticsConsent(s)).toBe(false);
    writeConsent(true, s, new Date('2026-11-08T00:00:00Z'));
    expect(readConsent(s)).toEqual({ analytics: true, at: '2026-11-08T00:00:00.000Z', v: 1 });
    expect(hasAnalyticsConsent(s)).toBe(true);
    expect(parseConsent('{"analytics":true,"at":"x","v":0}')).toBeNull();
    expect(parseConsent('not json')).toBeNull();
  });

  it('id ẩn danh chỉ tạo khi đã đồng ý; rút lại đồng ý → xoá id', () => {
    const s = memory();
    expect(anonymousId(s, () => 'abcdefgh1234')).toBeNull();
    writeConsent(true, s);
    expect(anonymousId(s, () => 'abcdefgh1234')).toBe('abcdefgh1234');
    expect(anonymousId(s, () => 'zzzzzzzz9999')).toBe('abcdefgh1234');
    writeConsent(false, s);
    expect(s.data.has(ANON_ID_KEY)).toBe(false);
    expect(hasAnalyticsConsent(s)).toBe(false);
  });
});

describe('sự kiện phễu client', () => {
  beforeEach(() => resetTrackedForTest());

  it('chưa đồng ý → KHÔNG gửi gì (không có cả request consent=false)', async () => {
    const s = memory();
    const send = vi.fn(() => Promise.resolve());
    expect(await trackFunnel('landing_view', undefined, { store: s, send, path: '/vi' })).toBe('no_consent');
    writeConsent(false, s);
    expect(await trackFunnel('landing_view', undefined, { store: s, send, path: '/vi' })).toBe('no_consent');
    expect(send).not.toHaveBeenCalled();
  });

  it('đã đồng ý → gửi consent=true + id ẩn danh + đường dẫn; một lần mỗi trang; lỗi mạng cho thử lại', async () => {
    const s = memory();
    writeConsent(true, s);
    const send = vi.fn(() => Promise.resolve());
    expect(await trackFunnel('checkout_start', { plan_kind: 'monthly' }, { store: s, send, path: '/vi/checkout' })).toBe('sent');
    expect(send).toHaveBeenCalledWith({ event: 'checkout_start', anonymous_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/), consent: true, path: '/vi/checkout', properties: { plan_kind: 'monthly' } });
    expect(await trackFunnel('checkout_start', undefined, { store: s, send, path: '/vi/checkout' })).toBe('duplicate');
    const fail = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await trackFunnel('signup_start', undefined, { store: s, send: fail, path: '/vi/signup' })).toBe('failed');
    expect(await trackFunnel('signup_start', undefined, { store: s, send, path: '/vi/signup' })).toBe('sent');
    expect(s.data.get(CONSENT_KEY)).toContain('"analytics":true');
  });
});

describe('attribution lần chạm đầu', () => {
  const now = new Date('2026-11-08T01:02:03Z');
  it('UTM + referrer ngoài site (chỉ origin) + trang đích không query', () => {
    expect(attributionFromLocation('https://allingo.vn/vi/toeic?utm_source=facebook&utm_medium=cpc&utm_campaign=s10&x=1#top', 'https://www.facebook.com/some/path?fbclid=1', now)).toEqual({
      landing_path: '/vi/toeic',
      first_seen_at: '2026-11-08T01:02:03.000Z',
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 's10',
      referrer: 'https://www.facebook.com',
    });
  });

  it('referrer nội bộ / không phải URL bị bỏ; UTM giống email/số điện thoại bị bỏ; cắt độ dài', () => {
    const a = attributionFromLocation('https://allingo.vn/vi?utm_source=a@b.com&utm_term=0912 345 678&utm_content=' + 'x'.repeat(300), 'https://allingo.vn/vi/blog', now);
    expect(a.referrer).toBeUndefined();
    expect(a.utm_source).toBeUndefined();
    expect(a.utm_term).toBeUndefined();
    expect(a.utm_content).toHaveLength(150);
    expect(attributionFromLocation('https://allingo.vn/vi', 'not a url', now).referrer).toBeUndefined();
    expect(cleanUtm('  zalo  ', 100)).toBe('zalo');
  });

  it('chỉ ghi lần đầu (không ghi đè) và gửi kèm khi đăng ký', () => {
    const s = memory();
    expect(attributionField(s)).toEqual({});
    captureAttribution('https://allingo.vn/vi?utm_source=zalo', '', s, now);
    captureAttribution('https://allingo.vn/en/blog?utm_source=google', 'https://google.com/', s, new Date('2026-11-09T00:00:00Z'));
    expect(readAttribution(s)).toMatchObject({ utm_source: 'zalo', landing_path: '/vi' });
    expect(attributionField(s).attribution?.utm_source).toBe('zalo');
  });
});
