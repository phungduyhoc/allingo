import { describe, expect, it } from 'vitest';
import { maskPii, vnDayBound } from './admin-format';

describe('admin vận hành – định dạng (S12)', () => {
  it('che email/SĐT lồng nhau khi xem như người dùng', () => {
    expect(maskPii({ id: 'u1', email: 'minh.nguyen@example.com', phone: '+84901234567', profile: { email: 'ab@x.vn' }, list: [{ phone: '0912345678' }] })).toEqual({
      id: 'u1',
      email: 'mi***@example.com',
      phone: '+•••••••••67',
      profile: { email: 'ab***@x.vn' },
      list: [{ phone: '••••••••78' }],
    });
    expect(maskPii(null)).toBeNull();
    expect(maskPii('x')).toBe('x');
  });
  it('khoảng ngày giờ VN cho bộ lọc audit', () => {
    expect(vnDayBound('2026-11-08', false)).toBe('2026-11-08T00:00:00.000+07:00');
    expect(vnDayBound('2026-11-08', true)).toBe('2026-11-08T23:59:59.999+07:00');
    expect(vnDayBound('08/11/2026', true)).toBeUndefined();
  });
});
