import type { PlanTask, PlanWeek } from '@allingo/schemas';

/** Dữ liệu dựng nhanh cho test thuần của lộ trình (không phải mock API) */
let seq = 0;
export function task(partial: Partial<PlanTask> = {}): PlanTask {
  seq += 1;
  return {
    id: partial.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    plan_week_id: 'w1',
    due_date: '2026-11-03',
    task_type: 'part_drill',
    title: { vi: 'Luyện Part 5', en: 'Practice Part 5' },
    ref: { type: 'section', id: 'sec-5' },
    est_minutes: 7,
    status: 'pending',
    evidence: null,
    evidence_code: null,
    evidence_params: {},
    result_ref: null,
    completed_at: null,
    launch: { kind: 'attempt', mode: 'practice', test_set_id: null, section_id: 'sec-5', lesson_id: null, vocab_list_id: null },
    overdue: false,
    ...partial,
  };
}

export function week(days: Record<string, PlanTask[]>, partial: Partial<PlanWeek> = {}): PlanWeek {
  const dates = Object.keys(days).sort();
  return {
    id: 'w1',
    week_no: 1,
    start_date: dates[0] ?? '2026-11-02',
    end_date: dates[dates.length - 1] ?? '2026-11-08',
    phase: 'foundation',
    focus: 'part5',
    focus_skill: 'reading',
    load_minutes: 0,
    budget_minutes: 300,
    checkin_done: false,
    adjustment: null,
    locked: false,
    progress_pct: 0,
    days: dates.map((date) => ({ date, status: days[date]!.length ? 'pending' : 'rest', tasks: days[date]! })),
    ...partial,
  };
}
