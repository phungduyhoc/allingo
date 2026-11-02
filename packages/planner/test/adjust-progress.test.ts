import { describe, expect, it } from 'vitest';
import { applyAdjustOps, dayStatuses, examProgress, forecastStatus, quickSuggestion, weekLoad, weekProgress, type AdjustTask, type AdjustWeek } from '../src/index.js';

const task = (id: string, due: string, type: AdjustTask['task_type'], minutes: number, status: AdjustTask['status'] = 'pending'): AdjustTask => ({ id, week_id: 'w2', due_date: due, task_type: type, est_minutes: minutes, status, ref_type: type === 'checkin' ? null : 'section', ref_id: type === 'checkin' ? null : `ref-${id}` });

/** Tuần tới (9–15/11) ngân sách 300′, 5 ngày học */
function nextWeek(overrides: Partial<AdjustWeek> = {}): AdjustWeek {
  return {
    id: 'w2',
    start_date: '2026-11-09',
    end_date: '2026-11-15',
    budget_minutes: 300,
    max_minutes: null,
    study_dates: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14'],
    is_final: false,
    tasks: [
      task('v1', '2026-11-09', 'vocab_review', 5),
      task('d1', '2026-11-09', 'part_drill', 40),
      task('v2', '2026-11-10', 'vocab_review', 5),
      task('d2', '2026-11-10', 'part_drill', 30),
      task('l1', '2026-11-10', 'grammar', 15),
      task('v3', '2026-11-11', 'vocab_review', 5),
      task('t1', '2026-11-11', 'timed_drill', 35),
      task('v4', '2026-11-12', 'vocab_review', 5),
      task('f1', '2026-11-12', 'full_test', 120),
      task('v5', '2026-11-14', 'vocab_review', 5),
      task('d3', '2026-11-14', 'part_drill', 30),
      task('c1', '2026-11-14', 'checkin', 5),
    ],
    ...overrides,
  };
}
const ctx = (w: AdjustWeek = nextWeek()) => ({ today: '2026-11-07', examDate: '2026-12-28', weeks: [w] });

describe('applyAdjustOps – ràng buộc plan_adjust', () => {
  it('"tuần này bận, chỉ 2 giờ": reduce_load_week 120 → tuần ≤ 120′, giữ điểm danh, bỏ luyện/bài học trước', () => {
    const w = nextWeek({ max_minutes: 120 });
    expect(weekLoad(w)).toBe(300);
    const r = applyAdjustOps(ctx(w), [{ op: 'reduce_load_week', from_date: '2026-11-09', minutes: 120 }]);
    expect(r.violations).toEqual([]);
    const after = r.weeks[0]!;
    expect(weekLoad(after)).toBeLessThanOrEqual(120);
    expect(after.tasks.find((t) => t.id === 'c1')!.status).toBe('pending');
    expect(after.tasks.find((t) => t.id === 'l1')!.status).toBe('skipped');
    expect(r.changes.every((c) => c.op === 'reduce_load_week' && c.field === 'status' && c.to === 'skipped')).toBe(true);
  });

  it('tuần cuối không bỏ full test khi giảm tải; không đủ → cannot_reduce', () => {
    const r = applyAdjustOps(ctx(nextWeek({ is_final: true })), [{ op: 'reduce_load_week', minutes: 100 }]);
    expect(r.weeks[0]!.tasks.find((t) => t.id === 'f1')!.status).toBe('pending');
    expect(r.violations.map((v) => v.code)).toContain('cannot_reduce');
  });

  it('move trong tuần hợp lệ; ra ngoài tuần / quá khứ / sau ngày thi → vi phạm', () => {
    expect(applyAdjustOps(ctx(), [{ op: 'move', task_id: 'd1', to_date: '2026-11-13' }]).violations).toEqual([]);
    expect(applyAdjustOps(ctx(), [{ op: 'move', task_id: 'd1', to_date: '2026-11-17' }]).violations[0]!.code).toBe('outside_week');
    expect(applyAdjustOps(ctx(), [{ op: 'move', task_id: 'd1', to_date: '2026-11-05' }]).violations[0]!.code).toBe('past_date');
    const nearExam = { today: '2026-11-07', examDate: '2026-11-12', weeks: [nextWeek()] };
    expect(applyAdjustOps(nearExam, [{ op: 'move', task_id: 'd1', to_date: '2026-11-13' }]).violations[0]!.code).toBe('after_exam');
  });

  it('không sửa task đã xong / task quá khứ / task không tồn tại; op lạ bị từ chối', () => {
    const w = nextWeek();
    w.tasks[1]!.status = 'done';
    expect(applyAdjustOps(ctx(w), [{ op: 'skip', task_id: 'd1' }]).violations[0]!.code).toBe('task_not_editable');
    const past = { ...ctx(), today: '2026-11-10' };
    expect(applyAdjustOps(past, [{ op: 'skip', task_id: 'v1' }]).violations[0]!.code).toBe('task_not_editable');
    expect(applyAdjustOps(ctx(), [{ op: 'skip', task_id: 'nope' }]).violations[0]!.code).toBe('unknown_task');
    expect(applyAdjustOps(ctx(), [{ op: 'delete_everything' }]).violations[0]!.code).toBe('invalid_op');
  });

  it('reduce tối đa 50 %; swap hai ngày; reschedule_rest dồn việc sang ngày học khác trong tuần', () => {
    expect(applyAdjustOps(ctx(), [{ op: 'reduce', task_id: 'd1', minutes: 10 }]).violations[0]!.code).toBe('reduce_too_much');
    const ok = applyAdjustOps(ctx(), [{ op: 'reduce', task_id: 'd1', minutes: 20 }]);
    expect(ok.weeks[0]!.tasks.find((t) => t.id === 'd1')!.est_minutes).toBe(20);
    const sw = applyAdjustOps(ctx(), [{ op: 'swap', from_date: '2026-11-10', to_date: '2026-11-11' }]);
    expect(sw.weeks[0]!.tasks.find((t) => t.id === 't1')!.due_date).toBe('2026-11-10');
    expect(sw.weeks[0]!.tasks.find((t) => t.id === 'd2')!.due_date).toBe('2026-11-11');
    const rest = applyAdjustOps(ctx(), [{ op: 'reschedule_rest', from_date: '2026-11-12' }]);
    expect(rest.violations).toEqual([]);
    expect(rest.weeks[0]!.tasks.filter((t) => t.due_date === '2026-11-12')).toHaveLength(0);
    expect(weekLoad(rest.weeks[0]!)).toBe(300);
  });

  it('"none" khi người học khai báo chỉ có 120′ → over_availability (đề xuất sai bị từ chối); set_daily_window → giờ nhắc', () => {
    expect(applyAdjustOps(ctx(nextWeek({ max_minutes: 120 })), [{ op: 'none' }]).violations.map((v) => v.code)).toEqual(['over_availability']);
    const win = applyAdjustOps(ctx(), [{ op: 'set_daily_window', window: { start: '19:30', end: '20:30' } }]);
    expect(win.settings_patch).toEqual({ reminder_time: '19:30' });
  });

  it('không đổi dữ liệu đầu vào', () => {
    const w = nextWeek();
    const copy = structuredClone(w);
    applyAdjustOps(ctx(w), [{ op: 'reduce_load_week', minutes: 50 }]);
    expect(w).toEqual(copy);
  });
});

describe('tiến độ', () => {
  const tasks = [
    { id: 'a', due_date: '2026-11-02', task_type: 'vocab_review' as const, est_minutes: 5, status: 'done' as const },
    { id: 'b', due_date: '2026-11-02', task_type: 'part_drill' as const, est_minutes: 30, status: 'pending' as const },
    { id: 'c', due_date: '2026-11-03', task_type: 'part_drill' as const, est_minutes: 30, status: 'done' as const },
    { id: 'd', due_date: '2026-11-04', task_type: 'timed_drill' as const, est_minutes: 20, status: 'pending' as const },
    { id: 'e', due_date: '2026-11-04', task_type: 'vocab_review' as const, est_minutes: 5, status: 'pending' as const },
    { id: 'f', due_date: '2026-11-05', task_type: 'full_test' as const, est_minutes: 120, status: 'skipped' as const },
  ];

  it('trạng thái ngày & % tuần (bỏ skipped)', () => {
    const days = dayStatuses('2026-11-02', '2026-11-08', tasks);
    expect(days.map((d) => d.status)).toEqual(['partial', 'done', 'pending', 'rest', 'rest', 'rest', 'rest']);
    expect(weekProgress(tasks)).toEqual({ total_minutes: 90, done_minutes: 35, pct: 38.9 });
  });

  it('dự báo: chưa có gì đến hạn → not_started; ≥ 80 % đúng hướng; < 50 % chậm', () => {
    expect(forecastStatus(tasks, '2026-11-01').status).toBe('not_started');
    expect(forecastStatus(tasks, '2026-11-04')).toMatchObject({ status: 'slightly_behind', due_minutes: 65, done_minutes: 35 });
    expect(forecastStatus(tasks.map((t) => ({ ...t, status: 'done' as const })), '2026-11-06').status).toBe('on_track');
    expect(forecastStatus(tasks.map((t) => (t.id === 'c' ? { ...t, status: 'pending' as const } : t)), '2026-11-05').status).toBe('behind');
  });

  it('tiến độ tới ngày thi', () => {
    expect(examProgress('2026-11-02', '2026-12-28', '2026-11-30')).toEqual({ pct: 50, days_left: 28, days_total: 56 });
    expect(examProgress('2026-11-02', null, '2026-11-30').pct).toBeNull();
  });

  it('"nếu chỉ có 15 phút": ôn từ vựng + rút gọn một lượt luyện, không gợi ý full test', () => {
    const q = quickSuggestion(tasks.filter((t) => t.status === 'pending'));
    expect(q.minutes).toBe(15);
    expect(q.items[0]!.task.task_type).toBe('vocab_review');
    expect(q.items[1]).toMatchObject({ shortened: true, est_minutes: 10 });
    const short = quickSuggestion([{ id: 'x', due_date: '2026-11-04', task_type: 'part_drill', est_minutes: 8, status: 'pending' }, { id: 'y', due_date: '2026-11-04', task_type: 'vocab_review', est_minutes: 5, status: 'pending' }]);
    expect(short.items.map((i) => i.task.id)).toEqual(['y', 'x']);
    expect(short.items.every((i) => !i.shortened)).toBe(true);
  });
});

describe('múi giờ', async () => {
  const { localDate, localTime, zonedDayStart, tzOffsetMinutes, isValidTimeZone } = await import('../src/index.js');
  it('ngày/giờ theo múi giờ người học, đầu ngày UTC, múi giờ không hợp lệ', () => {
    const at = Date.parse('2026-11-02T17:30:00Z');
    expect(localDate(at, 'Asia/Ho_Chi_Minh')).toBe('2026-11-03');
    expect(localDate(at, 'America/New_York')).toBe('2026-11-02');
    expect(localTime(Date.parse('2026-11-02T12:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('19:00');
    expect(localTime(Date.parse('2026-11-02T10:00:00Z'), 'Asia/Tokyo')).toBe('19:00');
    expect(tzOffsetMinutes(at, 'Asia/Ho_Chi_Minh')).toBe(420);
    expect(zonedDayStart('2026-11-03', 'Asia/Ho_Chi_Minh').toISOString()).toBe('2026-11-02T17:00:00.000Z');
    expect(zonedDayStart('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(isValidTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
