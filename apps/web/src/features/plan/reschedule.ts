import type { PlanTask, PlanWeek } from '@allingo/schemas/api/learning-plan';

/**
 * Đổi ngày task trong tuần (kéo thả / menu "Chuyển sang ngày…") – luật hiển thị bám PATCH /plan-tasks/{id} của API (server vẫn kiểm
 * tra lại và trả 400 nếu sai): chỉ task `pending`, ngày đích trong CÙNG tuần [start_date, end_date], không ở quá khứ (theo ngày của
 * người học), trước ngày thi. Hàm thuần – có test; ngày dạng YYYY-MM-DD so sánh chuỗi.
 */

export interface MoveContext {
  /** Hôm nay theo múi giờ người học (GET /me/plan/today.date hoặc settings.timezone) */
  today: string;
  examDate: string | null;
}

type DayStatus = PlanWeek['days'][number]['status'];

/** Ngày đích hợp lệ cho task trong tuần (không gồm ngày hiện tại của task) */
export function moveTargets(task: Pick<PlanTask, 'status' | 'due_date'>, week: Pick<PlanWeek, 'start_date' | 'end_date' | 'days' | 'locked'>, ctx: MoveContext): string[] {
  if (task.status !== 'pending' || week.locked) return [];
  return week.days.map((d) => d.date).filter((date) => date !== task.due_date && canMoveTo(date, week, ctx));
}

/** Ngày `date` nhận được task của tuần không (không xét task cụ thể) */
export function canMoveTo(date: string, week: Pick<PlanWeek, 'start_date' | 'end_date'>, ctx: MoveContext): boolean {
  if (date < week.start_date || date > week.end_date) return false;
  if (date < ctx.today) return false;
  if (ctx.examDate && date >= ctx.examDate) return false;
  return true;
}

export function canMoveTask(task: Pick<PlanTask, 'status' | 'due_date'>, toDate: string, week: Pick<PlanWeek, 'start_date' | 'end_date' | 'locked'>, ctx: MoveContext): boolean {
  return task.status === 'pending' && !week.locked && toDate !== task.due_date && canMoveTo(toDate, week, ctx);
}

/** Trạng thái ngày như `dayStatuses` của @allingo/planner: bỏ qua task skipped; không còn task → nghỉ */
export function dayStatus(tasks: readonly Pick<PlanTask, 'status'>[]): DayStatus {
  const counted = tasks.filter((t) => t.status !== 'skipped');
  if (!counted.length) return 'rest';
  const done = counted.filter((t) => t.status === 'done').length;
  return done === counted.length ? 'done' : done > 0 ? 'partial' : 'pending';
}

/** Thứ tự hiển thị trong ngày: chưa làm trước (quá hạn/đang chờ), rồi đã xong, cuối cùng bỏ qua/hết hạn; ổn định theo thứ tự gốc */
const STATUS_ORDER: Record<PlanTask['status'], number> = { pending: 0, done: 1, skipped: 2, expired: 3 };
export function sortDayTasks<T extends Pick<PlanTask, 'status'>>(tasks: readonly T[]): T[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => STATUS_ORDER[a.t.status] - STATUS_ORDER[b.t.status] || a.i - b.i)
    .map((x) => x.t);
}

/** Cập nhật lạc quan: chuyển task sang ngày đích (thêm cuối ngày), tính lại trạng thái ngày. Không hợp lệ → trả nguyên tuần */
export function applyMove(week: PlanWeek, taskId: string, toDate: string): PlanWeek {
  const from = week.days.find((d) => d.tasks.some((t) => t.id === taskId));
  const to = week.days.find((d) => d.date === toDate);
  if (!from || !to || from.date === toDate) return week;
  const task = from.tasks.find((t) => t.id === taskId)!;
  return {
    ...week,
    days: week.days.map((d) => {
      if (d.date === from.date) {
        const tasks = d.tasks.filter((t) => t.id !== taskId);
        return { ...d, tasks, status: dayStatus(tasks) };
      }
      if (d.date === toDate) {
        const tasks = [...d.tasks, { ...task, due_date: toDate, overdue: false }];
        return { ...d, tasks, status: dayStatus(tasks) };
      }
      return d;
    }),
  };
}

/** Tuần chứa task (trong danh sách tuần của StudyPlan) */
export function weekOfTask(weeks: readonly PlanWeek[], taskId: string): PlanWeek | null {
  return weeks.find((w) => w.days.some((d) => d.tasks.some((t) => t.id === taskId))) ?? null;
}

/** Tổng phút đang tính tải (bỏ skipped/expired) – hiển thị tải/ngân sách sau khi đổi ngày */
export function dayMinutes(tasks: readonly Pick<PlanTask, 'status' | 'est_minutes'>[]): number {
  return tasks.filter((t) => t.status !== 'skipped' && t.status !== 'expired').reduce((a, t) => a + t.est_minutes, 0);
}
