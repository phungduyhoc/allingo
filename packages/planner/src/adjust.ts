import { isIsoDate } from './dates.js';
import type { PlanTaskType } from './types.js';

/**
 * Áp dụng đề xuất `plan_adjust` (ops do AI sinh – docs/spec/allingo-prompts.yaml) lên các tuần ĐƯỢC PHÉP SỬA, trả bản sau + danh sách
 * thay đổi + vi phạm. Thuần: API gọi khi tạo đề xuất (xem trước/sau) và gọi lại lúc Áp dụng (trên dữ liệu mới nhất).
 *
 * Ràng buộc (vi phạm → đề xuất bị từ chối): chỉ sửa task `pending` có ngày ≥ hôm nay trong tuần được phép (check-in: chỉ tuần tới –
 * không sửa quá khứ); đổi ngày trong CÙNG tuần, trước ngày thi; giảm phút ≤ 50 %; sau khi áp dụng mỗi tuần không vượt ngân sách
 * phút/tuần (và thời gian rảnh người học khai báo nếu có), ≤ 1 full test/tuần. Không op nào tạo nội dung mới (task giữ nguyên ref).
 */

export const ADJUST_OPS = ['move', 'swap', 'skip', 'reduce', 'reschedule_rest', 'set_daily_window', 'reduce_load_week', 'none'] as const;
export type AdjustOpCode = (typeof ADJUST_OPS)[number];

export interface AdjustOp {
  op: string;
  task_id?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  minutes?: number | null;
  window?: Record<string, unknown> | null;
  note?: string | null;
}

export type AdjustTaskStatus = 'pending' | 'done' | 'skipped' | 'expired';

export interface AdjustTask {
  id: string;
  week_id: string;
  due_date: string;
  task_type: PlanTaskType;
  est_minutes: number;
  status: AdjustTaskStatus;
  ref_type: string | null;
  ref_id: string | null;
}

export interface AdjustWeek {
  id: string;
  start_date: string;
  end_date: string;
  budget_minutes: number;
  /** Giới hạn người học khai báo (vd "tuần tới chỉ 2 giờ") – null = chỉ ngân sách */
  max_minutes: number | null;
  study_dates: string[];
  /** Tuần cuối trước ngày thi: không bỏ full test khi giảm tải */
  is_final: boolean;
  tasks: AdjustTask[];
}

export interface AdjustChange {
  task_id: string;
  op: AdjustOpCode;
  field: 'due_date' | 'est_minutes' | 'status';
  from: string | number;
  to: string | number;
}

export interface AdjustViolation {
  code: 'invalid_op' | 'unknown_task' | 'task_not_editable' | 'past_date' | 'outside_week' | 'after_exam' | 'reduce_too_much' | 'invalid_minutes' | 'no_target_date' | 'cannot_reduce' | 'over_budget' | 'over_availability' | 'multiple_full_tests';
  op_index?: number;
  task_id?: string;
  week_id?: string;
  detail?: string;
}

export interface AdjustContext {
  today: string;
  examDate: string | null;
  /** Tuần được phép sửa (đã nạp đủ task, kể cả done/skipped để tính tổng) */
  weeks: AdjustWeek[];
}

export interface AdjustResult {
  weeks: AdjustWeek[];
  changes: AdjustChange[];
  violations: AdjustViolation[];
  settings_patch: { reminder_time?: string } | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Tổng phút tính tải tuần: mọi task trừ skipped/expired */
export function weekLoad(w: Pick<AdjustWeek, 'tasks'>): number {
  return w.tasks.filter((x) => x.status !== 'skipped' && x.status !== 'expired').reduce((a, x) => a + x.est_minutes, 0);
}

/** Thứ tự bỏ khi giảm tải: bài học → luyện Part → luyện tính giờ → full test (không phải tuần cuối) → ôn từ vựng (ngày muộn trước) */
const DROP_GROUPS: ReadonlyArray<readonly PlanTaskType[]> = [['lesson', 'grammar'], ['part_drill', 'review_errors', 'dictation', 'shadowing', 'writing', 'speaking', 'impromptu'], ['timed_drill'], ['full_test'], ['vocab_review']];

export function applyAdjustOps(ctx: AdjustContext, ops: readonly AdjustOp[]): AdjustResult {
  const weeks: AdjustWeek[] = structuredClone(ctx.weeks);
  const changes: AdjustChange[] = [];
  const violations: AdjustViolation[] = [];
  let settings: AdjustResult['settings_patch'] = null;
  const taskById = new Map<string, { task: AdjustTask; week: AdjustWeek }>();
  for (const w of weeks) for (const task of w.tasks) taskById.set(task.id, { task, week: w });
  const weekOfDate = (d: string) => weeks.find((w) => d >= w.start_date && d <= w.end_date) ?? null;
  const editable = (task: AdjustTask) => task.status === 'pending' && task.due_date >= ctx.today;
  const dateOk = (d: string | null | undefined, i: number, week: AdjustWeek | null): d is string => {
    if (!d || !isIsoDate(d)) {
      violations.push({ code: 'invalid_op', op_index: i, detail: 'date' });
      return false;
    }
    if (d < ctx.today) {
      violations.push({ code: 'past_date', op_index: i, detail: d });
      return false;
    }
    if (ctx.examDate && d >= ctx.examDate) {
      violations.push({ code: 'after_exam', op_index: i, detail: d });
      return false;
    }
    if (week && (d < week.start_date || d > week.end_date)) {
      violations.push({ code: 'outside_week', op_index: i, week_id: week.id, detail: d });
      return false;
    }
    if (!week && !weekOfDate(d)) {
      violations.push({ code: 'outside_week', op_index: i, detail: d });
      return false;
    }
    return true;
  };
  const setField = (task: AdjustTask, op: AdjustOpCode, field: AdjustChange['field'], to: string | number) => {
    const from = task[field === 'due_date' ? 'due_date' : field === 'est_minutes' ? 'est_minutes' : 'status'];
    if (from === to) return;
    changes.push({ task_id: task.id, op, field, from, to });
    if (field === 'due_date') task.due_date = String(to);
    else if (field === 'est_minutes') task.est_minutes = Number(to);
    else task.status = to as AdjustTaskStatus;
  };
  const requireTask = (id: string | null | undefined, i: number): AdjustTask | null => {
    const hit = id ? taskById.get(id) : undefined;
    if (!hit) {
      violations.push({ code: 'unknown_task', op_index: i, ...(id ? { task_id: id } : {}) });
      return null;
    }
    if (!editable(hit.task)) {
      violations.push({ code: 'task_not_editable', op_index: i, task_id: hit.task.id, detail: hit.task.status });
      return null;
    }
    return hit.task;
  };

  ops.forEach((o, i) => {
    switch (o.op as AdjustOpCode) {
      case 'none':
        return;
      case 'move': {
        const task = requireTask(o.task_id, i);
        if (!task) return;
        const week = taskById.get(task.id)!.week;
        if (dateOk(o.to_date, i, week)) setField(task, 'move', 'due_date', o.to_date);
        return;
      }
      case 'swap': {
        if (!o.from_date || !o.to_date || !isIsoDate(o.from_date) || !isIsoDate(o.to_date)) return void violations.push({ code: 'invalid_op', op_index: i, detail: 'swap dates' });
        const week = weekOfDate(o.from_date);
        if (!week) return void violations.push({ code: 'outside_week', op_index: i, detail: o.from_date });
        if (!dateOk(o.from_date, i, week) || !dateOk(o.to_date, i, week)) return;
        const a = week.tasks.filter((x) => x.due_date === o.from_date && editable(x));
        const b = week.tasks.filter((x) => x.due_date === o.to_date && editable(x));
        for (const x of a) setField(x, 'swap', 'due_date', o.to_date);
        for (const x of b) setField(x, 'swap', 'due_date', o.from_date);
        return;
      }
      case 'skip': {
        const task = requireTask(o.task_id, i);
        if (task) setField(task, 'skip', 'status', 'skipped');
        return;
      }
      case 'reduce': {
        const task = requireTask(o.task_id, i);
        if (!task) return;
        const m = o.minutes;
        if (typeof m !== 'number' || !Number.isInteger(m) || m <= 0) return void violations.push({ code: 'invalid_minutes', op_index: i, task_id: task.id });
        if (m >= task.est_minutes) return;
        if (m < Math.ceil(task.est_minutes / 2)) return void violations.push({ code: 'reduce_too_much', op_index: i, task_id: task.id, detail: `${task.est_minutes}→${m}` });
        setField(task, 'reduce', 'est_minutes', m);
        return;
      }
      case 'reschedule_rest': {
        const d = o.from_date ?? o.to_date;
        const week = d && isIsoDate(d) ? weekOfDate(d) : null;
        if (!d || !week) return void violations.push({ code: 'outside_week', op_index: i, ...(d ? { detail: d } : {}) });
        if (!dateOk(d, i, week)) return;
        const moving = week.tasks.filter((x) => x.due_date === d && editable(x));
        const targets = week.study_dates.filter((x) => x !== d && x >= ctx.today && (!ctx.examDate || x < ctx.examDate));
        if (moving.length && !targets.length) return void violations.push({ code: 'no_target_date', op_index: i, week_id: week.id, detail: d });
        for (const x of moving) {
          const load = (date: string) => week.tasks.filter((y) => y.due_date === date && y.status !== 'skipped' && y.status !== 'expired').reduce((a, y) => a + y.est_minutes, 0);
          const target = [...targets].sort((p, q) => load(p) - load(q) || p.localeCompare(q))[0]!;
          setField(x, 'reschedule_rest', 'due_date', target);
        }
        return;
      }
      case 'set_daily_window': {
        const start = o.window && typeof o.window.start === 'string' ? o.window.start : null;
        if (start && HHMM.test(start)) settings = { reminder_time: start };
        return;
      }
      case 'reduce_load_week': {
        const m = o.minutes;
        if (typeof m !== 'number' || !Number.isInteger(m) || m <= 0) return void violations.push({ code: 'invalid_minutes', op_index: i });
        const week = o.from_date && isIsoDate(o.from_date) ? weekOfDate(o.from_date) : weeks[weeks.length - 1];
        if (!week) return void violations.push({ code: 'outside_week', op_index: i, ...(o.from_date ? { detail: o.from_date } : {}) });
        let total = weekLoad(week);
        for (const group of DROP_GROUPS) {
          if (total <= m) break;
          if (group.includes('full_test') && week.is_final) continue;
          const pool = week.tasks.filter((x) => group.includes(x.task_type) && editable(x)).sort((a, b) => b.est_minutes - a.est_minutes || b.due_date.localeCompare(a.due_date));
          while (total > m && pool.length) {
            const over = total - m;
            // Bỏ task nhỏ nhất đủ bù phần vượt; không có thì bỏ task lớn nhất rồi tiếp tục
            const exact = [...pool].reverse().find((x) => x.est_minutes >= over);
            const pickIdx = exact ? pool.indexOf(exact) : 0;
            const [x] = pool.splice(pickIdx, 1);
            setField(x!, 'reduce_load_week', 'status', 'skipped');
            total -= x!.est_minutes;
          }
        }
        if (total > m) violations.push({ code: 'cannot_reduce', op_index: i, week_id: week.id, detail: `${total} > ${m}` });
        return;
      }
      default:
        violations.push({ code: 'invalid_op', op_index: i, detail: String(o.op) });
    }
  });

  for (const w of weeks) {
    const total = weekLoad(w);
    if (total > w.budget_minutes) violations.push({ code: 'over_budget', week_id: w.id, detail: `${total} > ${w.budget_minutes}` });
    if (w.max_minutes !== null && total > w.max_minutes) violations.push({ code: 'over_availability', week_id: w.id, detail: `${total} > ${w.max_minutes}` });
    if (w.tasks.filter((x) => x.task_type === 'full_test' && x.status !== 'skipped' && x.status !== 'expired').length > 1) violations.push({ code: 'multiple_full_tests', week_id: w.id });
  }
  return { weeks, changes, violations, settings_patch: settings };
}
