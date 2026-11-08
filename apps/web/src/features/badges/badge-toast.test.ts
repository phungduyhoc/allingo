import { describe, expect, it } from 'vitest';
import { badgeNameOf } from './badge-toast';

describe('badgeNameOf', () => {
  it('tên huy hiệu theo locale từ payload.data, dự phòng payload và chuỗi', () => {
    expect(badgeNameOf({ payload: { data: { badge_code: 'streak_7', badge_name: { vi: '7 ngày liên tiếp', en: '7-day streak' } } } }, 'en')).toBe('7-day streak');
    expect(badgeNameOf({ payload: { badge_name: { vi: 'Bài đầu tiên', en: 'First attempt' } } }, 'vi')).toBe('Bài đầu tiên');
    expect(badgeNameOf({ payload: { data: { badge_name: ' Tăng 50 điểm ' } } }, 'vi')).toBe('Tăng 50 điểm');
    expect(badgeNameOf({ payload: {} }, 'vi')).toBeNull();
    expect(badgeNameOf({ payload: null as never }, 'vi')).toBeNull();
  });
});
