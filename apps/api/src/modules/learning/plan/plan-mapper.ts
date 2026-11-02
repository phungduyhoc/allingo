import { type schema } from '@allingo/db';
import type { ContentInventory, PlanPhase, PlanStrategy } from '@allingo/planner';
import { dayStatuses, weekProgress } from '@allingo/planner';
import type { LocalizedText, PlanSettings, PlanTask, PlanWeek } from '@allingo/schemas';

export type PlanRow = typeof schema.learnStudyPlans.$inferSelect;
export type WeekRow = typeof schema.learnPlanWeeks.$inferSelect;
export type TaskRow = typeof schema.learnPlanTasks.$inferSelect;
export type AdjustmentRow = typeof schema.learnPlanAdjustments.$inferSelect;

/** Phút ước tính cho một lượt luyện 10 câu theo Part TOEIC (POST /attempts {section_id} – SECTION_DRILL_COUNT = 10) */
export const SECTION_DRILL_MINUTES: Record<string, number> = { part1: 6, part2: 5, part3: 8, part4: 8, part5: 7, part6: 10, part7: 12 };
/** Task pending quá hạn từ 3 ngày (giờ người học) → expired */
export const TASK_EXPIRE_AFTER_DAYS = 3;
/** Đề xuất điều chỉnh hết hạn sau (giờ) nếu chưa áp dụng */
export const PROPOSAL_TTL_HOURS = 72;

/** strategy JSONB của learn.study_plans (DDL: {weeks, focus_rotation, minutes_per_skill, mastery_path} + S9: settings, weeks_meta…) */
export interface StoredStrategy extends PlanStrategy {
  settings: PlanSettings;
  weeks_meta: Array<{ week_no: number; end_date: string; budget_minutes: number; phase: PlanPhase; study_dates: string[] }>;
  baseline: { score: number | null; low: number | null; high: number | null; source: string } | null;
  target_suggestion: { suggested: number; feasible: boolean | null } | null;
  mastery_path: null;
  is_pro: boolean;
}

export type CatalogPlanContent = {
  sections: Array<{ id: string; code: string; skill: string; skill_id: string; name: LocalizedText; sort_order: number; published_questions: number }>;
  testSets: Array<{ id: string; code: string; kind: 'full' | 'mini' | 'part_drill'; title: LocalizedText; duration_sec: number | null; is_free: boolean; question_count: number; sections: string[] }>;
  lessons: Array<{ id: string; section_code: string | null; kind: 'lesson' | 'grammar' | 'pronunciation' | 'strategy'; title: LocalizedText; est_minutes: number | null }>;
  vocabLists: Array<{ id: string; title: LocalizedText }>;
};

const titleOf = (t: LocalizedText | null | undefined, fallback: string) => ({ vi: t?.vi ?? t?.en ?? fallback, en: t?.en ?? t?.vi ?? fallback });

/** Catalog → ContentInventory của @allingo/planner (chỉ nội dung có thật đã phát hành) */
export function toInventory(c: CatalogPlanContent): ContentInventory {
  return {
    sections: c.sections.map((s) => ({ id: s.id, code: s.code, skill: s.skill, name: titleOf(s.name, s.code), question_count: s.published_questions, drill_minutes: SECTION_DRILL_MINUTES[s.code] ?? 10 })),
    testSets: c.testSets.map((t) => ({ id: t.id, code: t.code, kind: t.kind, title: titleOf(t.title, t.code), minutes: t.duration_sec ? Math.ceil(t.duration_sec / 60) : Math.max(5, Math.ceil(t.question_count * 0.75)), question_count: t.question_count, sections: t.sections })),
    lessons: c.lessons.map((l) => ({ id: l.id, section_code: l.section_code, kind: l.kind, title: titleOf(l.title, 'Lesson'), minutes: l.est_minutes ?? 15 })),
    vocabLists: c.vocabLists.map((v) => ({ id: v.id, title: titleOf(v.title, 'Vocabulary') })),
  };
}

const sectionLabel = (code: string | number | undefined) => {
  const s = String(code ?? '');
  const m = /^part(\d+)$/.exec(s);
  return m ? `Part ${m[1]}` : s;
};

/** Lý do giao bài (dữ liệu server, i18n theo locale người học – web có thể tự dịch `evidence_code`) */
const EVIDENCE: Record<string, { vi: string; en: string }> = {
  daily_vocab: { vi: 'Ôn từ vựng mỗi ngày giúp nhớ lâu.', en: 'Daily review keeps new words fresh.' },
  weekly_checkin: { vi: 'Điểm danh cuối tuần để điều chỉnh kế hoạch tuần tới.', en: 'Weekly check-in to adjust next week.' },
  cadence_full_test: { vi: 'Thi thử định kỳ mỗi {every_weeks} tuần để đo tiến bộ.', en: 'Mock test every {every_weeks} weeks to measure progress.' },
  final_simulation: { vi: 'Tuần cuối: thi thử như thật trước ngày thi.', en: 'Final week: full mock test before the exam.' },
  weak_section: { vi: '{section} còn yếu (thành thạo ~{mastery_pct}%) nên được luyện nhiều hơn.', en: '{section} needs work (mastery ~{mastery_pct}%), so it gets more practice.' },
  focus_section: { vi: 'Trọng tâm tuần này: {section} (thành thạo ~{mastery_pct}%).', en: "This week's focus: {section} (mastery ~{mastery_pct}%)." },
  foundation_lesson: { vi: 'Tuần nền: củng cố kiến thức {section}.', en: 'Foundation week: strengthen {section} basics.' },
  simulation_mini: { vi: 'Tuần mô phỏng: làm đề mini tính giờ.', en: 'Simulation week: timed mini test.' },
  plan_adjust: { vi: 'Đã điều chỉnh theo check-in của bạn.', en: 'Adjusted after your check-in.' },
  review_errors: { vi: 'Ôn lại {count} lỗi chưa hiểu cũ nhất trong sổ lỗi.', en: 'Review your {count} oldest open mistakes.' },
};

export function evidenceParams(raw: unknown): { code: string | null; params: Record<string, string | number> } {
  const e = (raw ?? {}) as { code?: string; params?: Record<string, string | number> };
  const params: Record<string, string | number> = { ...(e.params ?? {}) };
  if (typeof params.weight === 'number' && params.mastery_pct === undefined) params.mastery_pct = Math.max(0, Math.min(100, Math.round((1.15 - params.weight) * 100)));
  return { code: e.code ?? null, params };
}

export function evidenceText(code: string | null, params: Record<string, string | number>, locale: string): string | null {
  if (!code || !EVIDENCE[code]) return null;
  const tpl = locale === 'vi' ? EVIDENCE[code].vi : EVIDENCE[code].en;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k === 'section' ? sectionLabel(params.section) : String(params[k] ?? '')));
}

export function launchOf(t: Pick<TaskRow, 'taskType' | 'refType' | 'refId'>): PlanTask['launch'] {
  const base = { mode: null, test_set_id: null, section_id: null, lesson_id: null, vocab_list_id: null };
  if (t.taskType === 'checkin') return { ...base, kind: 'checkin' };
  if (t.taskType === 'review_errors') return { ...base, kind: 'review_errors', mode: 'timed_drill' };
  if (!t.refType || !t.refId) return null;
  if (t.refType === 'lesson') return { ...base, kind: 'lesson', lesson_id: t.refId };
  if (t.refType === 'vocab_list') return { ...base, kind: 'vocab_list', vocab_list_id: t.refId };
  if (t.refType === 'test_set') return { ...base, kind: 'attempt', mode: t.taskType === 'full_test' || t.taskType === 'timed_drill' ? 'exam' : 'practice', test_set_id: t.refId };
  if (t.refType === 'section') return { ...base, kind: 'attempt', mode: t.taskType === 'timed_drill' ? 'timed_drill' : 'practice', section_id: t.refId };
  return null;
}

export function taskDto(t: TaskRow, today: string, locale: string): PlanTask {
  const ev = evidenceParams(t.evidence);
  return {
    id: t.id,
    plan_week_id: t.planWeekId,
    due_date: t.dueDate,
    task_type: t.taskType,
    title: (t.title as LocalizedText | null) ?? { vi: t.taskType, en: t.taskType },
    ref: t.refType && t.refId ? { type: t.refType, id: t.refId } : null,
    est_minutes: t.estMinutes ?? 0,
    status: t.status,
    evidence: evidenceText(ev.code, ev.params, locale),
    evidence_code: ev.code,
    evidence_params: ev.params,
    result_ref: (t.resultRef as Record<string, unknown> | null) ?? null,
    completed_at: t.completedAt ? t.completedAt.toISOString() : null,
    launch: launchOf(t),
    overdue: t.status === 'pending' && t.dueDate < today,
  };
}

const progressTask = (t: TaskRow) => ({ id: t.id, due_date: t.dueDate, task_type: t.taskType, est_minutes: t.estMinutes ?? 0, status: t.status });

export function weekDto(w: WeekRow, tasks: TaskRow[], meta: StoredStrategy['weeks_meta'][number] | undefined, opts: { today: string; locale: string; locked: boolean; focusSection: string | null; focusSkill: string | null }): PlanWeek {
  const end = meta?.end_date ?? w.startDate;
  const items = [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => ({ ...progressTask(t), dto: taskDto(t, opts.today, opts.locale) }));
  const days = opts.locked ? [] : dayStatuses(w.startDate, end, items).map((d) => ({ date: d.date, status: d.status, tasks: d.tasks.map((x) => x.dto) }));
  return {
    id: w.id,
    week_no: w.weekNo,
    start_date: w.startDate,
    end_date: end,
    phase: meta?.phase ?? 'practice',
    focus: opts.focusSection,
    focus_skill: opts.focusSkill,
    load_minutes: w.loadMinutes ?? 0,
    budget_minutes: meta?.budget_minutes ?? w.loadMinutes ?? 0,
    checkin_done: !!w.checkinDoneAt,
    adjustment: (w.adjustment as Record<string, unknown> | null) ?? null,
    locked: opts.locked,
    progress_pct: weekProgress(tasks.map(progressTask)).pct,
    days,
  };
}

export const toProgressTasks = (tasks: TaskRow[]) => tasks.map(progressTask);
