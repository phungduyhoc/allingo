import { describe, expect, it } from 'vitest';
import { periodKey, periodResetAt, previousPeriodKey } from '../../src/modules/billing/quota.service.js';

/** Quota Free reset 00:00 giờ Asia/Ho_Chi_Minh (= 17:00 UTC hôm trước) – đồng hồ giả (S5) */
describe('kỳ quota theo giờ Việt Nam', () => {
  it('23:59:59 VN vẫn là ngày cũ; 00:00:00 VN sang ngày mới', () => {
    const before = Date.parse('2026-11-01T16:59:59.999Z'); // 23:59:59.999 01/11 VN
    const after = Date.parse('2026-11-01T17:00:00.000Z'); // 00:00 02/11 VN
    expect(periodKey('day', before)).toBe('2026-11-01');
    expect(periodKey('day', after)).toBe('2026-11-02');
    expect(periodResetAt('day', before).toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(periodResetAt('day', after).toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('tháng: 30/11 23:59 VN → reset 00:00 01/12 VN; tháng 12 sang năm mới', () => {
    expect(periodKey('month', Date.parse('2026-11-30T16:59:00Z'))).toBe('2026-11');
    expect(periodKey('month', Date.parse('2026-11-30T17:00:00Z'))).toBe('2026-12');
    expect(periodResetAt('month', Date.parse('2026-11-15T03:00:00Z')).toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(periodResetAt('month', Date.parse('2026-12-15T03:00:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('kỳ trước cho chốt đêm (00:05 VN chốt ngày hôm qua)', () => {
    const t = Date.parse('2026-11-01T17:05:00Z'); // 00:05 02/11 VN
    expect(previousPeriodKey('day', t)).toBe('2026-11-01');
    expect(previousPeriodKey('month', Date.parse('2027-01-01T03:00:00Z'))).toBe('2026-12');
    expect(previousPeriodKey('lifetime', t)).toBe('all');
  });
});
