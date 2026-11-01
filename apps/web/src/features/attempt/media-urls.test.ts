import { describe, expect, it } from 'vitest';
import { collectMediaUrls, isStale, mergeMediaMaps, mergeMediaUrls, MIN_REFRESH_DELAY_MS, nextRefreshAt, refreshDelay, REFRESH_BEFORE_MS, resolveMediaUrl } from './media-urls';

const T0 = Date.parse('2026-11-01T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const questions = [
  {
    media: [
      { id: 'a1', kind: 'audio', url: '/a1?sig=0', duration_ms: 1000, expires_at: iso(T0 + 10 * MIN) },
      { id: 'i1', kind: 'image', url: '/i1?sig=0', duration_ms: null, expires_at: null },
    ],
    passage: null,
  },
  { media: [{ id: 'a2', kind: 'audio', url: '/a2?sig=0', duration_ms: 1000, expires_at: iso(T0 + 8 * MIN) }], passage: { id: 'p', kind: 'audio_script', title: null, body: null, media_url: '/g?sig=0', media_asset_id: 'g', media_expires_at: iso(T0 + 9 * MIN) } },
  { media: [], passage: { id: 'p', kind: 'audio_script', title: null, body: null, media_url: '/g?sig=old', media_asset_id: 'g', media_expires_at: iso(T0 + 5 * MIN) } },
];

describe('media-urls', () => {
  it('gom URL theo asset (media câu + passage), asset trùng giữ URL hạn xa nhất', () => {
    const map = collectMediaUrls(questions);
    expect([...map.keys()].sort()).toEqual(['a1', 'a2', 'g', 'i1']);
    expect(map.get('g')).toEqual({ url: '/g?sig=0', expiresAt: T0 + 9 * MIN });
    expect(map.get('i1')?.expiresAt).toBeNull();
  });

  it('hẹn gia hạn khi URL sớm nhất còn ≤ 2 phút', () => {
    const map = collectMediaUrls(questions);
    expect(nextRefreshAt(map)).toBe(T0 + 8 * MIN - REFRESH_BEFORE_MS);
    expect(refreshDelay(map, T0, null)).toBe(6 * MIN);
    expect(refreshDelay(map, T0 + 7 * MIN, null)).toBe(0);
    // Vừa gia hạn mà vẫn sắp hết hạn (server trả URL cũ) → không gọi dồn
    expect(refreshDelay(map, T0 + 7 * MIN, T0 + 7 * MIN - 1000)).toBe(MIN_REFRESH_DELAY_MS - 1000);
    expect(refreshDelay(collectMediaUrls([{ media: [{ id: 'x', kind: 'image', url: '/x', duration_ms: null, expires_at: null }], passage: null }]), T0, null)).toBeNull();
    expect(isStale(map.get('a2'), T0 + 6 * MIN)).toBe(true);
    expect(isStale(map.get('a1'), T0 + 6 * MIN)).toBe(false);
    expect(isStale(map.get('i1'), T0 + 999 * MIN)).toBe(false);
  });

  it('gộp kết quả GET /attempts/{id}/media: thay URL theo id, giữ asset không có trong danh sách', () => {
    const map = collectMediaUrls(questions);
    const next = mergeMediaUrls(map, [
      { id: 'a2', url: '/a2?sig=1', expires_at: iso(T0 + 18 * MIN) },
      { id: 'g', url: '/g?sig=1', expires_at: iso(T0 + 18 * MIN) },
      { id: 'a1', url: '/a1?sig=stale', expires_at: iso(T0 + 1 * MIN) },
    ]);
    expect(resolveMediaUrl(next, 'a2', '/fallback')).toBe('/a2?sig=1');
    expect(resolveMediaUrl(next, 'g', '/fallback')).toBe('/g?sig=1');
    // Không thay bằng URL hạn sớm hơn
    expect(resolveMediaUrl(next, 'a1', '/fallback')).toBe('/a1?sig=0');
    expect(resolveMediaUrl(next, 'unknown', '/fallback')).toBe('/fallback');
    expect(resolveMediaUrl(next, null, '/fallback')).toBe('/fallback');
    expect(nextRefreshAt(next)).toBe(T0 + 10 * MIN - REFRESH_BEFORE_MS);
  });

  it('attempt tải lại: chỉ thêm asset mới hoặc thay khi URL mới hạn xa hơn ≥ 5′ (không đổi src liên tục)', () => {
    const map = collectMediaUrls(questions);
    const same = mergeMediaMaps(map, collectMediaUrls([{ media: [{ id: 'a1', kind: 'audio', url: '/a1?sig=r', duration_ms: 1, expires_at: iso(T0 + 11 * MIN) }], passage: null }]));
    expect(same).toBe(map);
    const replaced = mergeMediaMaps(map, collectMediaUrls([{ media: [{ id: 'a1', kind: 'audio', url: '/a1?sig=r2', duration_ms: 1, expires_at: iso(T0 + 16 * MIN) }, { id: 'new', kind: 'audio', url: '/n', duration_ms: 1, expires_at: null }], passage: null }]));
    expect(resolveMediaUrl(replaced, 'a1', '')).toBe('/a1?sig=r2');
    expect(resolveMediaUrl(replaced, 'new', '')).toBe('/n');
  });
});
