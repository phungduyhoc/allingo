import { describe, expect, it } from 'vitest';
import { diffSummary, effectiveStatus, proposalDiff } from './proposal-diff';
import { task } from './plan-fixtures.test-utils';

describe('proposalDiff', () => {
  const b1 = task({ id: 'x1', due_date: '2026-11-09', est_minutes: 8 });
  const b2 = task({ id: 'x2', due_date: '2026-11-10', est_minutes: 12 });
  const b3 = task({ id: 'x3', due_date: '2026-11-11', est_minutes: 10 });
  const b4 = task({ id: 'x4', due_date: '2026-11-12', est_minutes: 5 });

  it('bỏ (skipped), dời ngày, giảm phút, thêm; task không đổi bị bỏ qua; sắp theo ngày', () => {
    const items = proposalDiff({
      before: [b1, b2, b3, b4],
      after: [{ ...b1, status: 'skipped' }, { ...b2, due_date: '2026-11-13' }, { ...b3, est_minutes: 5 }, b4, task({ id: 'n1', due_date: '2026-11-08', est_minutes: 6 })],
      changes: [{ task_id: 'x1', op: 'skip', field: 'status', from: 'pending', to: 'skipped' }],
    });
    expect(items.map((i) => [i.task_id, i.kinds])).toEqual([
      ['n1', ['added']],
      ['x1', ['removed']],
      ['x2', ['moved']],
      ['x3', ['reduced']],
    ]);
    const x2 = items.find((i) => i.task_id === 'x2')!;
    expect([x2.date_before, x2.date_after]).toEqual(['2026-11-10', '2026-11-13']);
    expect(items.find((i) => i.task_id === 'x1')!.date_after).toBeNull();
    expect(diffSummary(items)).toEqual({ removed: 1, moved: 1, reduced: 1, increased: 0, added: 1, restored: 0 });
  });

  it('dời + giảm cùng lúc; khôi phục task đã bỏ', () => {
    const items = proposalDiff({
      before: [b1, { ...b2, status: 'skipped' }],
      after: [{ ...b1, due_date: '2026-11-14', est_minutes: 4 }, { ...b2, status: 'pending' }],
      changes: [],
    });
    expect(items.map((i) => [i.task_id, i.kinds])).toEqual([
      ['x1', ['moved', 'reduced']],
      ['x2', ['restored']],
    ]);
  });
});

describe('effectiveStatus', () => {
  it('ready quá hạn → expired; trạng thái cuối giữ nguyên', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    expect(effectiveStatus({ status: 'ready', expires_at: '2026-11-04T23:00:00Z' }, now)).toBe('expired');
    expect(effectiveStatus({ status: 'ready', expires_at: '2026-11-06T00:00:00Z' }, now)).toBe('ready');
    expect(effectiveStatus({ status: 'applied', expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('applied');
  });
});
