import { describe, expect, it } from 'vitest';
import { clockTone, computeClockOffset, crossedAnnouncement, formatClock, remainingMs } from './clock';

describe('clock', () => {
  it('hiệu chỉnh lệch giờ client/server', () => {
    const serverTime = '2026-11-01T10:00:00.000Z';
    const clientNow = Date.parse('2026-11-01T09:58:00.000Z'); // client chậm 2 phút
    const offset = computeClockOffset(serverTime, clientNow);
    expect(offset).toBe(120_000);
    // Hết hạn lúc 10:10 server → còn 10 phút dù client nghĩ là 9:58
    expect(remainingMs('2026-11-01T10:10:00.000Z', offset, clientNow)).toBe(10 * 60_000);
    // Sau 10 phút client → 0, không âm
    expect(remainingMs('2026-11-01T10:10:00.000Z', offset, clientNow + 11 * 60_000)).toBe(0);
  });

  it('không giới hạn giờ → null; server_time hỏng → offset 0', () => {
    expect(remainingMs(null, 0)).toBeNull();
    expect(computeClockOffset('not-a-date', 1000)).toBe(0);
  });

  it('định dạng mm:ss và h:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59_999)).toBe('00:59');
    expect(formatClock(10 * 60_000)).toBe('10:00');
    expect(formatClock(2 * 3_600_000 + 5 * 60_000 + 3_000)).toBe('2:05:03');
  });

  it('tông màu và mốc thông báo', () => {
    expect(clockTone(null)).toBe('normal');
    expect(clockTone(6 * 60_000)).toBe('normal');
    expect(clockTone(4 * 60_000)).toBe('warning');
    expect(clockTone(30_000)).toBe('danger');
    expect(crossedAnnouncement(5 * 60_000 + 500, 5 * 60_000 - 500)).toBe(5);
    expect(crossedAnnouncement(5 * 60_000 - 500, 5 * 60_000 - 1500)).toBeNull();
    expect(crossedAnnouncement(null, 1000)).toBeNull();
  });
});
