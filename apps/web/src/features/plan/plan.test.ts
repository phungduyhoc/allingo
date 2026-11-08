import { describe, expect, it } from 'vitest';
import { isSelfReported, launchAction, launchIdempotencyKey } from './launch';
import { applyMove, canMoveTask, canMoveTo, dayMinutes, dayStatus, moveTargets, sortDayTasks, weekOfTask } from './reschedule';
import { addDaysIso, currentWeek, examCountdown, forecastTone, formatDay, formatRange, loadView, pct, todayIn, weekHasFullTest, weekdayOf, xpLevelView } from './progress';
import { task, week } from './plan-fixtures.test-utils';

const W = (over: Partial<Parameters<typeof week>[1]> = {}) =>
  week(
    {
      '2026-11-02': [task({ id: 'a', due_date: '2026-11-02', status: 'done' })],
      '2026-11-03': [task({ id: 'b', due_date: '2026-11-03' }), task({ id: 'c', due_date: '2026-11-03', status: 'skipped' })],
      '2026-11-04': [],
      '2026-11-05': [task({ id: 'd', due_date: '2026-11-05' })],
      '2026-11-06': [],
      '2026-11-07': [],
      '2026-11-08': [task({ id: 'e', due_date: '2026-11-08', task_type: 'checkin', launch: { kind: 'checkin', mode: null, test_set_id: null, section_id: null, lesson_id: null, vocab_list_id: null } })],
    },
    over,
  );

describe('launchAction – mở đúng màn từ task', () => {
  it('attempt theo section → POST /attempts với plan_task_id và mode của launch', () => {
    const t = task({ id: 't1' });
    expect(launchAction(t)).toEqual({ kind: 'attempt', body: { program: 'toeic', mode: 'practice', section_id: 'sec-5', plan_task_id: 't1' } });
  });

  it('attempt theo test set (full test exam) ưu tiên test_set_id', () => {
    const t = task({ id: 't2', task_type: 'full_test', launch: { kind: 'attempt', mode: 'exam', test_set_id: 'ts-1', section_id: 'x', lesson_id: null, vocab_list_id: null } });
    expect(launchAction(t, 'toeic')).toEqual({ kind: 'attempt', body: { program: 'toeic', mode: 'exam', test_set_id: 'ts-1', plan_task_id: 't2' } });
  });

  it('task đã xong → mở lại để ôn, không gắn plan_task_id; mode lạ → practice', () => {
    const t = task({ id: 't3', status: 'done', launch: { kind: 'attempt', mode: 'weird' as never, test_set_id: null, section_id: 's', lesson_id: null, vocab_list_id: null } });
    expect(launchAction(t)).toEqual({ kind: 'attempt', body: { program: 'toeic', mode: 'practice', section_id: 's' } });
  });

  it('bài học / bộ từ → route kèm ?task= khi còn pending', () => {
    const lesson = task({ id: 'l1', task_type: 'grammar', launch: { kind: 'lesson', mode: null, test_set_id: null, section_id: null, lesson_id: 'les-9', vocab_list_id: null } });
    expect(launchAction(lesson)).toEqual({ kind: 'route', href: '/lessons/les-9?task=l1' });
    const vocab = task({ id: 'v1', task_type: 'vocab_review', status: 'done', launch: { kind: 'vocab_list', mode: null, test_set_id: null, section_id: null, lesson_id: null, vocab_list_id: 'vl-1' } });
    expect(launchAction(vocab)).toEqual({ kind: 'route', href: '/vocab/vl-1' });
  });

  it('check-in, review_errors (S10), thiếu nội dung → tự đánh dấu', () => {
    expect(launchAction(task({ task_type: 'checkin', launch: null }))).toEqual({ kind: 'checkin' });
    const re = task({ id: 'r1', task_type: 'review_errors', launch: { kind: 'review_errors', mode: 'timed_drill', test_set_id: null, section_id: null, lesson_id: null, vocab_list_id: null } });
    expect(launchAction(re)).toEqual({ kind: 'errors_drill', program: 'toeic', plan_task_id: 'r1' });
    expect(launchAction(task({ launch: null }))).toEqual({ kind: 'self' });
    expect(launchAction(task({ launch: { kind: 'attempt', mode: 'practice', test_set_id: null, section_id: null, lesson_id: null, vocab_list_id: null } }))).toEqual({ kind: 'self' });
  });

  it('isSelfReported: bài học/bộ từ/không nội dung cần tự bấm Xong; bài làm thì không', () => {
    expect(isSelfReported(task())).toBe(false);
    expect(isSelfReported(task({ launch: null }))).toBe(true);
    expect(isSelfReported(task({ launch: { kind: 'lesson', mode: null, test_set_id: null, section_id: null, lesson_id: 'x', vocab_list_id: null } }))).toBe(true);
  });

  it('Idempotency-Key ổn định cho task pending, mới cho task đã xong', () => {
    expect(launchIdempotencyKey({ id: 'k', status: 'pending' })).toBe('plan-task-k');
    expect(launchIdempotencyKey({ id: 'k', status: 'done' }, () => 'rnd')).toBe('rnd');
  });
});

describe('đổi ngày task trong tuần', () => {
  const ctx = { today: '2026-11-03', examDate: null };

  it('moveTargets: chỉ ngày trong tuần, không quá khứ, không trùng ngày hiện tại', () => {
    const w = W();
    const b = w.days[1]!.tasks[0]!;
    expect(moveTargets(b, w, ctx)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  });

  it('task không pending hoặc tuần khoá → không đổi được', () => {
    const w = W();
    expect(moveTargets(w.days[0]!.tasks[0]!, w, ctx)).toEqual([]);
    expect(moveTargets(w.days[1]!.tasks[1]!, w, ctx)).toEqual([]);
    expect(moveTargets(w.days[1]!.tasks[0]!, W({ locked: true }), ctx)).toEqual([]);
  });

  it('ngày thi chặn ngày ≥ exam_date', () => {
    const w = W();
    expect(moveTargets(w.days[1]!.tasks[0]!, w, { today: '2026-11-03', examDate: '2026-11-06' })).toEqual(['2026-11-04', '2026-11-05']);
    expect(canMoveTo('2026-11-06', w, { today: '2026-11-03', examDate: '2026-11-06' })).toBe(false);
  });

  it('canMoveTask từ chối ngoài tuần / quá khứ / cùng ngày', () => {
    const w = W();
    const b = w.days[1]!.tasks[0]!;
    expect(canMoveTask(b, '2026-11-09', w, ctx)).toBe(false);
    expect(canMoveTask(b, '2026-11-02', w, ctx)).toBe(false);
    expect(canMoveTask(b, '2026-11-03', w, ctx)).toBe(false);
    expect(canMoveTask(b, '2026-11-05', w, ctx)).toBe(true);
  });

  it('applyMove chuyển task sang ngày đích, tính lại trạng thái ngày; ngày cũ chỉ còn skipped → nghỉ', () => {
    const w = applyMove(W(), 'b', '2026-11-04');
    expect(w.days[1]!.tasks.map((t) => t.id)).toEqual(['c']);
    expect(w.days[1]!.status).toBe('rest');
    expect(w.days[2]!.tasks.map((t) => [t.id, t.due_date])).toEqual([['b', '2026-11-04']]);
    expect(w.days[2]!.status).toBe('pending');
  });

  it('applyMove không hợp lệ → giữ nguyên', () => {
    const base = W();
    expect(applyMove(base, 'zzz', '2026-11-04')).toBe(base);
    expect(applyMove(base, 'b', '2026-12-01')).toBe(base);
  });

  it('dayStatus / sortDayTasks / dayMinutes / weekOfTask', () => {
    expect(dayStatus([])).toBe('rest');
    expect(dayStatus([{ status: 'done' }, { status: 'pending' }])).toBe('partial');
    expect(dayStatus([{ status: 'done' }, { status: 'skipped' }])).toBe('done');
    const sorted = sortDayTasks([task({ id: '1', status: 'done' }), task({ id: '2', status: 'skipped' }), task({ id: '3' }), task({ id: '4', status: 'expired' }), task({ id: '5' })]);
    expect(sorted.map((t) => t.id)).toEqual(['3', '5', '1', '2', '4']);
    expect(dayMinutes([task({ est_minutes: 5 }), task({ est_minutes: 7, status: 'skipped' }), task({ est_minutes: 3, status: 'done' })])).toBe(8);
    expect(weekOfTask([W()], 'd')?.id).toBe('w1');
    expect(weekOfTask([W()], 'nope')).toBeNull();
  });
});

describe('định dạng tiến độ / dự báo', () => {
  it('pct làm tròn và chặn 0–100', () => {
    expect(pct(33.35)).toBe(33);
    expect(pct(120)).toBe(100);
    expect(pct(-1)).toBe(0);
    expect(pct(null)).toBe(0);
    expect(pct(Number.NaN)).toBe(0);
  });

  it('forecastTone theo trạng thái dự báo', () => {
    expect(forecastTone('on_track')).toBe('success');
    expect(forecastTone('slightly_behind')).toBe('gold');
    expect(forecastTone('behind')).toBe('destructive');
    expect(forecastTone('not_started')).toBe('muted');
    expect(forecastTone('???')).toBe('muted');
  });

  it('examCountdown: không có ngày thi → null; còn 0 ngày → today', () => {
    expect(examCountdown({ exam_pct: null, days_to_exam: null })).toBeNull();
    expect(examCountdown({ exam_pct: 42.6, days_to_exam: 30 })).toEqual({ pct: 43, daysLeft: 30, when: 'days' });
    expect(examCountdown({ exam_pct: 100, days_to_exam: 0 })).toEqual({ pct: 100, daysLeft: 0, when: 'today' });
  });

  it('loadView: tải/ngân sách và cờ vượt', () => {
    expect(loadView({ load_minutes: 150, budget_minutes: 300 })).toEqual({ load: 150, budget: 300, pct: 50, over: false });
    expect(loadView({ load_minutes: 320, budget_minutes: 300 }).over).toBe(true);
    expect(loadView({ load_minutes: 10, budget_minutes: 0 })).toEqual({ load: 10, budget: 0, pct: 0, over: false });
  });

  it('xpLevelView theo levelForXp (100 → cấp 2, cần 300)', () => {
    expect(xpLevelView(0)).toMatchObject({ level: 1, floor: 0, next: 100, pct: 0, toNext: 100 });
    expect(xpLevelView(150)).toMatchObject({ level: 2, floor: 100, next: 300, pct: 25, toNext: 150 });
    expect(xpLevelView(150, 2, 300)).toMatchObject({ level: 2, next: 300 });
  });

  it('ngày lịch định dạng theo UTC (không lệch múi giờ máy)', () => {
    expect(formatDay('2026-11-02', 'en', { weekday: 'short' })).toBe('Mon');
    expect(formatRange('2026-11-02', '2026-11-08', 'vi')).toBe('02/11 – 08/11');
    expect(weekdayOf('2026-11-02')).toBe('mon');
    expect(weekdayOf('2026-11-08')).toBe('sun');
    expect(addDaysIso('2026-11-30', 1)).toBe('2026-12-01');
    expect(todayIn('Asia/Ho_Chi_Minh', new Date('2026-11-02T18:30:00Z'))).toBe('2026-11-03');
    expect(todayIn('Not/AZone', new Date('2026-11-02T18:30:00Z'))).toBe('2026-11-02');
  });

  it('currentWeek theo week_current, dự phòng theo ngày; weekHasFullTest', () => {
    const w1 = W();
    const w2 = { ...W(), id: 'w2', week_no: 2, start_date: '2026-11-09', end_date: '2026-11-15', days: [{ date: '2026-11-09', status: 'pending' as const, tasks: [task({ task_type: 'full_test' })] }] };
    expect(currentWeek({ weeks: [w1, w2], week_current: 2 }, '2026-11-03')?.id).toBe('w2');
    expect(currentWeek({ weeks: [w1, w2], week_current: null }, '2026-11-10')?.id).toBe('w2');
    expect(weekHasFullTest(w2)).toBe(true);
    expect(weekHasFullTest(w1)).toBe(false);
  });
});
