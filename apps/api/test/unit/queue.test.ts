import { describe, expect, it } from 'vitest';
import { jobIdFor } from '../../src/shared/queue/queue.module.js';
import { PersonalDataRegistry } from '../../src/shared/events/personal-data.registry.js';

describe('jobIdFor', () => {
  it('không chứa dấu hai chấm (BullMQ ≥ 5 từ chối) và ổn định theo id nghiệp vụ', () => {
    const id = jobIdFor('grade.speaking', '7f8c1c1e-0000-4000-8000-000000000001');
    expect(id).toBe('grade.speaking__7f8c1c1e-0000-4000-8000-000000000001');
    expect(id).not.toContain(':');
    expect(jobIdFor('x', 'a:b')).toBe('x__a_b');
    expect(jobIdFor('grade.speaking', 'abc')).toBe(jobIdFor('grade.speaking', 'abc'));
  });
});

describe('PersonalDataRegistry', () => {
  it('chạy mọi purger, trả số bản ghi theo tên; một purger lỗi → ném lỗi', async () => {
    const reg = new PersonalDataRegistry();
    reg.register('a', async () => 2);
    reg.register('b', async () => 0);
    expect(await reg.purgeAll('u1')).toEqual({ a: 2, b: 0 });
    reg.register('c', async () => {
      throw new Error('s3 down');
    });
    await expect(reg.purgeAll('u1')).rejects.toThrow('s3 down');
    expect(reg.names()).toEqual(['a', 'b', 'c']);
  });
});
