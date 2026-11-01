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

  it('mốc cảnh báo 10′/5′/1′: đúng một lần mỗi mốc, nhảy cóc báo mốc nhỏ nhất, hết giờ không báo', () => {
    const marks: number[] = [];
    // Mô phỏng đồng hồ chạy từng giây từ 10:03 → 0
    let prev = 10 * 60_000 + 3_000;
    for (let ms = prev - 1000; ms >= 0; ms -= 1000) {
      const m = crossedAnnouncement(prev, ms);
      if (m !== null) marks.push(m);
      prev = ms;
    }
    expect(marks).toEqual([10, 5, 1]);
    // Tab ẩn từ 11′ tới 4′ → chỉ báo 5′ (không báo 10′ đã cũ)
    expect(crossedAnnouncement(11 * 60_000, 4 * 60_000)).toBe(5);
    // Ngủ máy qua cả 3 mốc nhưng chưa hết giờ → 1′
    expect(crossedAnnouncement(12 * 60_000, 30_000)).toBe(1);
    // Về 0 → không phải mốc cảnh báo (luồng tự nộp lo)
    expect(crossedAnnouncement(61_000, 0)).toBeNull();
    // Mốc tuỳ chỉnh
    expect(crossedAnnouncement(3 * 60_000, 119_000, [2])).toBe(2);
  });
});
