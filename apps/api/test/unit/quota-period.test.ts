import { describe, expect, it } from 'vitest';
import { periodKey, periodResetAt } from '../../src/modules/billing/quota.service.js';

describe('quota period (Asia/Ho_Chi_Minh)', () => {
  it('ngày đổi lúc 17:00 UTC', () => {
    expect(periodKey('day', new Date('2026-11-01T16:59:00Z'))).toBe('2026-11-01');
    expect(periodKey('day', new Date('2026-11-01T17:00:00Z'))).toBe('2026-11-02');
    expect(periodKey('month', new Date('2026-11-30T17:30:00Z'))).toBe('2026-12');
    expect(periodKey('lifetime')).toBe('all');
  });
  it('reset_at là 00:00 giờ VN kế tiếp', () => {
    const r = periodResetAt('day', new Date('2026-11-01T10:00:00Z'));
    expect(r.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    const m = periodResetAt('month', new Date('2026-12-15T10:00:00Z'));
    expect(m.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});
