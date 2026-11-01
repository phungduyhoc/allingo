import { describe, expect, it } from 'vitest';
import { RECORDING_RETENTION_DAYS, UploadsService } from '../../src/modules/grading/index.js';
import type { EntitlementService } from '../../src/modules/billing/index.js';
import type { AuthUser } from '../../src/shared/auth/auth.guard.js';

type Ctor = ConstructorParameters<typeof UploadsService>;

/** UploadsService với entitlement giả (chỉ kiểm tra chính sách vòng đời ghi âm) */
function service(proPrograms: string[], fail = false) {
  const calls: string[] = [];
  const entitlements = {
    getContext: (_userId: string, program: string) => {
      calls.push(program);
      if (fail) return Promise.reject(new Error('db down'));
      return Promise.resolve({ userId: 'u', program, isPro: proPrograms.includes(program), planKind: 'free', features: new Set<string>() });
    },
  } as unknown as EntitlementService;
  const svc = new UploadsService({} as Ctor[0], {} as Ctor[1], entitlements, {} as Ctor[3]);
  return { svc, calls };
}

const user = (isGuest = false): AuthUser => ({ id: '00000000-0000-4000-8000-000000000001', sessionId: 's', roles: [], isGuest });

describe('vòng đời ghi âm theo gói (CLAUDE.md §9)', () => {
  it('Free 90 ngày; Pro ở bất kỳ chương trình → 365; khách không tra entitlement; lỗi tra cứu → mặc định Free', async () => {
    expect(RECORDING_RETENTION_DAYS).toEqual({ free: 90, pro: 365 });
    expect(await service([]).svc.retentionDays(user())).toBe(90);
    const pro = service(['ielts']);
    expect(await pro.svc.retentionDays(user())).toBe(365);
    expect(pro.calls).toEqual(['toeic', 'ielts']);
    const guest = service(['toeic']);
    expect(await guest.svc.retentionDays(user(true))).toBe(90);
    expect(guest.calls).toHaveLength(0);
    expect(await service(['toeic'], true).svc.retentionDays(user())).toBe(90);
  });
});
