import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_USERS, seedDemo } from '../seed/index.js';

/** B6/S151: seed demo có superadmin cho dev/E2E (cấp vai trò admin qua API) và luôn bị chặn ở production */
describe('seed demo – superadmin dev & chặn production', () => {
  const prev = process.env.APP_ENV;
  afterEach(() => {
    if (prev === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prev;
  });

  it('có superadmin@allingo.dev với vai trò superadmin (không kèm admin)', () => {
    const su = DEMO_USERS.find((u) => u.email === 'superadmin@allingo.dev');
    expect(su?.roles).toContain('superadmin');
    expect(su?.roles).not.toContain('admin');
  });

  it('APP_ENV=production → seedDemo từ chối trước khi ghi DB', async () => {
    process.env.APP_ENV = 'production';
    await expect(seedDemo({} as never)).rejects.toThrow(/production/);
  });
});
