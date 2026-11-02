/**
 * Kiểu dữ liệu của PlanGenerator (thuần, không phụ thuộc DB/AI). Ngày luôn là chuỗi ISO `YYYY-MM-DD` theo LỊCH CỦA NGƯỜI HỌC
 * (API quy đổi múi giờ trước khi gọi). Tiêu đề task là dữ liệu đa ngôn ngữ `{vi, en}` (CLAUDE.md §5.11 – web fallback en → vi).
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** learn.plan_task_type */
export const PLAN_TASK_TYPES = ['full_test', 'part_drill', 'timed_drill', 'lesson', 'grammar', 'vocab_review', 'shadowing', 'dictation', 'writing', 'speaking', 'impromptu', 'checkin', 'review_errors'] as const;
export type PlanTaskType = (typeof PLAN_TASK_TYPES)[number];

export const PLAN_PHASES = ['foundation', 'practice', 'simulation'] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

/** learn.plan_tasks.ref_type do generator sinh (null = checkin – tự tham chiếu tuần) */
export type PlanRefType = 'test_set' | 'section' | 'lesson' | 'vocab_list';

export interface LocalizedTitle {
  vi: string;
  en: string;
}

// ----------------------------------------------------------------------------- nội dung có thật (catalog)
export interface InventorySection {
  id: string;
  code: string;
  skill: string;
  name: LocalizedTitle;
  /** Số câu đã phát hành – 0 thì không giao luyện */
  question_count: number;
  /** Phút ước tính cho một lượt luyện 10 câu (POST /attempts {section_id}) */
  drill_minutes: number;
}

export interface InventoryTestSet {
  id: string;
  code: string;
  kind: 'full' | 'mini' | 'part_drill';
  title: LocalizedTitle;
  minutes: number;
  question_count: number;
  sections: string[];
}

export interface InventoryLesson {
  id: string;
  section_code: string | null;
  kind: 'lesson' | 'grammar' | 'pronunciation' | 'strategy';
  title: LocalizedTitle;
  minutes: number;
}

export interface InventoryVocabList {
  id: string;
  title: LocalizedTitle;
}

export interface ContentInventory {
  sections: InventorySection[];
  testSets: InventoryTestSet[];
  lessons: InventoryLesson[];
  vocabLists: InventoryVocabList[];
}

export interface MasteryRow {
  subskill: string;
  skill: string;
  /** Section (Part) nơi subskill được đo */
  sections: string[];
  /** 0–1 */
  mastery: number;
}

// ----------------------------------------------------------------------------- đầu vào / đầu ra
export interface PlanInput {
  program: string;
  /** Ngày bắt đầu (hôm nay theo giờ người học) */
  startDate: string;
  /** Ngày thi (không giao việc từ ngày này) – null → `defaultWeeks` tuần */
  examDate: string | null;
  /** Ngân sách phút cho một tuần đầy đủ */
  weeklyMinutes: number;
  /** Ngày học trong tuần (≥ 1) */
  studyDays: Weekday[];
  /** Pro: full test mỗi 2 tuần; Free: mỗi 4 tuần (1/tháng) */
  isPro: boolean;
  mastery: MasteryRow[];
  inventory: ContentInventory;
  /** Mặc định 8 */
  defaultWeeks?: number;
  /** Mặc định 26 */
  maxWeeks?: number;
  /** S10: task ôn sổ lỗi hằng tuần (mặc định true) */
  reviewErrors?: boolean;
}

export interface TaskEvidence {
  /** Mã lý do (web dịch `plan.evidence.<code>`) */
  code: 'daily_vocab' | 'weekly_checkin' | 'cadence_full_test' | 'final_simulation' | 'weak_section' | 'focus_section' | 'foundation_lesson' | 'simulation_mini' | 'plan_adjust' | 'review_errors';
  params: Record<string, string | number>;
}

export interface PlannedTask {
  due_date: string;
  task_type: PlanTaskType;
  ref_type: PlanRefType | null;
  ref_id: string | null;
  title: LocalizedTitle;
  est_minutes: number;
  evidence: TaskEvidence;
}

export interface PlannedWeek {
  week_no: number;
  start_date: string;
  /** Ngày cuối (bao gồm) */
  end_date: string;
  phase: PlanPhase;
  focus_section: string | null;
  focus_skill: string | null;
  /** Ngân sách phút của tuần (tỉ lệ theo số ngày học trong tuần – tuần đầu/cuối có thể thiếu ngày) */
  budget_minutes: number;
  /** Tổng phút đã giao */
  load_minutes: number;
  study_dates: string[];
  has_full_test: boolean;
  tasks: PlannedTask[];
}

export interface PlanStrategy {
  generator: 'rule-v1';
  weeks: number;
  cycle: readonly PlanPhase[];
  phases: PlanPhase[];
  full_test_every_weeks: number;
  focus_rotation: string[];
  minutes_per_skill: Record<string, number>;
  section_weights: Record<string, number>;
  anchored_to_exam: boolean;
}

export interface GeneratedPlan {
  weeks: PlannedWeek[];
  strategy: PlanStrategy;
}

export interface PlanViolation {
  code:
    | 'over_budget'
    | 'unknown_ref'
    | 'not_study_day'
    | 'outside_week'
    | 'after_exam'
    | 'before_start'
    | 'last_week_not_simulation'
    | 'missing_final_full_test'
    | 'multiple_full_tests'
    | 'missing_daily_vocab'
    | 'missing_checkin'
    | 'invalid_minutes';
  week_no?: number;
  task_index?: number;
  detail?: string;
}
