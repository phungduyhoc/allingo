import { describe, expect, it } from 'vitest';
import { messages } from '@allingo/i18n';
import { MARKETING_MESSAGES, pickMessages, ROOT_MESSAGES } from './i18n-scope';

describe('thông điệp next-intl theo nhóm route', () => {
  it('chọn nhánh và khoá lồng (ns.sub.key), bỏ đường dẫn không có', () => {
    const all = { a: { x: 1, y: { z: 'z' } }, b: 'b', c: { d: 'd' } } as never;
    expect(pickMessages(all, ['a.y.z', 'b', 'missing', 'c.none'])).toEqual({ a: { y: { z: 'z' } }, b: 'b' });
    expect(pickMessages(all, ['a.x', 'a.y'])).toEqual({ a: { x: 1, y: { z: 'z' } } });
  });

  it('mọi nhánh khai báo cho gốc/marketing tồn tại ở vi và en; marketing nhỏ hơn nhiều so với toàn bộ', () => {
    for (const locale of ['vi', 'en'] as const) {
      const all = messages[locale] as never;
      for (const path of [...ROOT_MESSAGES, ...MARKETING_MESSAGES]) expect(JSON.stringify(pickMessages(all, [path])), `${locale}:${path}`).not.toBe('{}');
      expect(JSON.stringify(pickMessages(all, MARKETING_MESSAGES)).length).toBeLessThan(JSON.stringify(all).length / 4);
    }
  });
});
