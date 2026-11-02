import { weekdayOf } from './dates.js';
import { mandatoryMinutes } from './generator.js';
import type { ContentInventory, GeneratedPlan, PlanInput, PlannedTask, PlanRefType, PlanViolation } from './types.js';

/** Tập id nội dung có thật theo loại tham chiếu */
export function inventoryIndex(inv: ContentInventory): Record<PlanRefType, Set<string>> {
  return {
    test_set: new Set(inv.testSets.map((x) => x.id)),
    section: new Set(inv.sections.filter((s) => s.question_count > 0).map((x) => x.id)),
    lesson: new Set(inv.lessons.map((x) => x.id)),
    vocab_list: new Set(inv.vocabLists.map((x) => x.id)),
  };
}

/** Task trỏ nội dung có thật (checkin không có ref) */
export function taskRefIsReal(task: Pick<PlannedTask, 'task_type' | 'ref_type' | 'ref_id'>, index: Record<PlanRefType, Set<string>>): boolean {
  if (task.task_type === 'checkin') return task.ref_type === null && task.ref_id === null;
  if (!task.ref_type || !task.ref_id) return false;
  return index[task.ref_type]?.has(task.ref_id) ?? false;
}

/**
 * Kiểm tra ràng buộc của một lộ trình sinh ra (dùng trong property test và API trước khi lưu):
 * tổng phút ≤ ngân sách mỗi tuần; task trỏ nội dung có thật; đúng ngày học, trong tuần, trước ngày thi, không trước ngày bắt đầu;
 * ≤ 1 full test/tuần; tuần cuối là mô phỏng và (≥ 2 tuần) có full test khi ngân sách đủ; ôn từ vựng mỗi ngày học + điểm danh khi đủ ngân sách.
 */
export function validatePlan(plan: GeneratedPlan, input: PlanInput): PlanViolation[] {
  const out: PlanViolation[] = [];
  const index = inventoryIndex(input.inventory);
  const hasVocab = input.inventory.vocabLists.length > 0;
  const studyDays = new Set(input.studyDays);
  for (const w of plan.weeks) {
    const sum = w.tasks.reduce((a, x) => a + x.est_minutes, 0);
    if (sum > w.budget_minutes) out.push({ code: 'over_budget', week_no: w.week_no, detail: `${sum} > ${w.budget_minutes}` });
    if (sum !== w.load_minutes) out.push({ code: 'invalid_minutes', week_no: w.week_no, detail: `load ${w.load_minutes} ≠ ${sum}` });
    w.tasks.forEach((task, i) => {
      if (!Number.isInteger(task.est_minutes) || task.est_minutes <= 0) out.push({ code: 'invalid_minutes', week_no: w.week_no, task_index: i });
      if (task.due_date < w.start_date || task.due_date > w.end_date) out.push({ code: 'outside_week', week_no: w.week_no, task_index: i });
      if (input.examDate && task.due_date >= input.examDate) out.push({ code: 'after_exam', week_no: w.week_no, task_index: i });
      if (task.due_date < input.startDate) out.push({ code: 'before_start', week_no: w.week_no, task_index: i });
      if (!studyDays.has(weekdayOf(task.due_date))) out.push({ code: 'not_study_day', week_no: w.week_no, task_index: i, detail: task.due_date });
      if (!taskRefIsReal(task, index)) out.push({ code: 'unknown_ref', week_no: w.week_no, task_index: i, detail: `${task.ref_type}:${task.ref_id}` });
    });
    if (w.tasks.filter((x) => x.task_type === 'full_test').length > 1) out.push({ code: 'multiple_full_tests', week_no: w.week_no });
    const mandatory = mandatoryMinutes(w.study_dates.length, hasVocab);
    if (w.study_dates.length && w.budget_minutes >= mandatory) {
      if (!w.tasks.some((x) => x.task_type === 'checkin')) out.push({ code: 'missing_checkin', week_no: w.week_no });
      if (hasVocab) for (const d of w.study_dates) if (!w.tasks.some((x) => x.task_type === 'vocab_review' && x.due_date === d)) out.push({ code: 'missing_daily_vocab', week_no: w.week_no, detail: d });
    }
  }
  const last = plan.weeks[plan.weeks.length - 1];
  if (last) {
    if (last.phase !== 'simulation') out.push({ code: 'last_week_not_simulation', week_no: last.week_no });
    if (plan.weeks.length >= 2) {
      const room = last.budget_minutes - mandatoryMinutes(last.study_dates.length, hasVocab);
      const fits = input.inventory.testSets.some((x) => x.kind === 'full' && x.minutes > 0 && x.minutes <= room);
      if (fits && !last.tasks.some((x) => x.task_type === 'full_test')) out.push({ code: 'missing_final_full_test', week_no: last.week_no });
    }
  }
  return out;
}
