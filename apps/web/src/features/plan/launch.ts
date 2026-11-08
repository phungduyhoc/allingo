import type { AttemptMode } from '@allingo/schemas/api/attempt';
import type { PlanTask } from '@allingo/schemas/api/learning-plan';
import type { ProgramCode } from '@allingo/schemas/common';

/**
 * Ánh xạ `PlanTask.launch` → hành động mở nội dung (thuần, có test). Server quyết định `launch`; web chỉ chọn màn:
 *  - `attempt`  → POST /attempts {program, mode, test_set_id | section_id, plan_task_id} rồi mở /attempts/{id} (task tự done khi
 *                 bài được chấm – outbox `attempt.graded`);
 *  - `lesson`   → /lessons/{id}?task=… (đánh dấu xong tại trang, server cộng XP tự báo);
 *  - `vocab_list` (S10) → phiên ôn `/toeic/vocab/review?list={id}&task=…` (task tự xong khi hết thẻ đến hạn / khi xong phiên);
 *                 task đã xong → trang bộ từ `/toeic/vocab/{id}`;
 *  - `checkin`  → hộp thoại điểm danh tuần;
 *  - `review_errors` (S10) → POST /me/errors/drill {plan_task_id};
 *  - không có nội dung → tự đánh dấu xong (`self`).
 * Task không còn `pending` (done/skipped/expired) vẫn mở lại được nội dung (ôn lại) nhưng không gắn `plan_task_id`.
 */

export type LaunchAction =
  | { kind: 'attempt'; body: { program: ProgramCode; mode: AttemptMode; test_set_id?: string; section_id?: string; plan_task_id?: string } }
  | { kind: 'errors_drill'; program: ProgramCode; plan_task_id: string }
  | { kind: 'route'; href: string }
  | { kind: 'checkin' }
  | { kind: 'self' };

const ATTEMPT_MODES: ReadonlySet<string> = new Set(['exam', 'practice', 'drill', 'timed_drill']);

export function launchAction(task: Pick<PlanTask, 'id' | 'status' | 'task_type' | 'launch'>, program: ProgramCode = 'toeic'): LaunchAction {
  const l = task.launch;
  const pending = task.status === 'pending';
  const taskQuery = pending ? `?task=${encodeURIComponent(task.id)}` : '';
  if (!l) return task.task_type === 'checkin' ? { kind: 'checkin' } : { kind: 'self' };
  switch (l.kind) {
    case 'checkin':
      return { kind: 'checkin' };
    case 'lesson':
      return l.lesson_id ? { kind: 'route', href: `/lessons/${encodeURIComponent(l.lesson_id)}${taskQuery}` } : { kind: 'self' };
    case 'vocab_list': {
      if (!l.vocab_list_id) return { kind: 'self' };
      const list = encodeURIComponent(l.vocab_list_id);
      return { kind: 'route', href: pending ? `/toeic/vocab/review?list=${list}&task=${encodeURIComponent(task.id)}` : `/toeic/vocab/${list}` };
    }
    case 'review_errors':
      return pending ? { kind: 'errors_drill', program, plan_task_id: task.id } : { kind: 'self' };
    case 'attempt': {
      const mode = (l.mode && ATTEMPT_MODES.has(l.mode) ? l.mode : 'practice') as AttemptMode;
      const ref = l.test_set_id ? { test_set_id: l.test_set_id } : l.section_id ? { section_id: l.section_id } : null;
      if (!ref) return { kind: 'self' };
      return { kind: 'attempt', body: { program, mode, ...ref, ...(pending ? { plan_task_id: task.id } : {}) } };
    }
    default:
      return { kind: 'self' };
  }
}

/** Task cần người học tự bấm "Xong" (không có bài làm kiểm chứng để server tự hoàn thành) */
export function isSelfReported(task: Pick<PlanTask, 'id' | 'status' | 'task_type' | 'launch'>): boolean {
  const a = launchAction({ ...task, status: 'pending' });
  return a.kind === 'self' || a.kind === 'route';
}

/**
 * Idempotency-Key: task còn `pending` → ổn định theo task (bấm đúp / mở lại khi chưa nộp → cùng lượt làm; API giữ kết quả 24 giờ);
 * task đã xong/bỏ qua (ôn lại) → khoá mới mỗi lần để không phát lại lượt cũ đã chấm.
 */
export function launchIdempotencyKey(task: Pick<PlanTask, 'id' | 'status'>, random: () => string = () => crypto.randomUUID()): string {
  return task.status === 'pending' ? `plan-task-${task.id}` : random();
}
