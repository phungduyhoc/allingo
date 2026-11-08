import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { messages } from '@allingo/i18n';
import { computeScopes, render } from '../../scripts/i18n-scopes.mjs';
import { APP_LAYOUT_MESSAGES, APP_PAGE_MESSAGES } from './i18n-app-scopes';
import { pickMessages } from './i18n-scope';

describe('thông điệp theo trang khu vực học (S11)', () => {
  it('tệp sinh src/lib/i18n-app-scopes.ts khớp đồ thị import hiện tại (chạy `node scripts/i18n-scopes.mjs` khi đỏ)', () => {
    const current = readFileSync(fileURLToPath(new URL('./i18n-app-scopes.ts', import.meta.url)), 'utf8');
    expect(current).toBe((render as (s: unknown) => string)((computeScopes as () => unknown)()));
  });

  it('mọi nhánh khai báo tồn tại ở vi và en; dashboard nhỏ hơn nhiều so với toàn bộ thông điệp', () => {
    for (const locale of ['vi', 'en'] as const) {
      const all = messages[locale] as never;
      for (const path of [...APP_LAYOUT_MESSAGES, ...Object.values(APP_PAGE_MESSAGES).flat()]) expect(JSON.stringify(pickMessages(all, [path])), `${locale}:${path}`).not.toBe('{}');
      const dashboard = JSON.stringify(pickMessages(all, [...APP_LAYOUT_MESSAGES, ...APP_PAGE_MESSAGES['(shell)/toeic/dashboard']])).length;
      expect(dashboard).toBeLessThan(JSON.stringify(all).length / 2);
    }
  });

  it('mỗi trang (app) đều có mục (trang mới phải bọc <PageIntl>)', () => {
    expect(Object.keys(APP_PAGE_MESSAGES)).toEqual(expect.arrayContaining(['(shell)/toeic/dashboard', '(exam)/attempts/[id]', '(shell)/attempts/[id]/review']));
  });
});
