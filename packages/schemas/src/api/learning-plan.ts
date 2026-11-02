import { z } from 'zod';
import { isoDateSchema, localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { answerInputSchema } from '../question/answer.js';

/**
 * Hợp đồng Sprint 9 (v1.1): bài chẩn đoán thích ứng, lộ trình tuần (PlanGenerator), việc hôm nay, check-in & đề xuất
 * điều chỉnh (plan_adjust), huy hiệu. Bám docs/spec/allingo-openapi.yaml (StudyPlan, PlanWeek, PlanTask, PlanAdjustProposal,
 * DiagnosticStep, Badge…). Văn bản hiển thị trong dữ liệu là JSONB {vi, en}; web dịch mã (`evidence_code`, `status`) qua next-intl.
 */

export const WEEKDAY_CODES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const weekdaySchema = z.enum(WEEKDAY_CODES);
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const PLAN_TASK_TYPE_CODES = ['full_test', 'part_drill', 'timed_drill', 'lesson', 'grammar', 'vocab_review', 'shadowing', 'dictation', 'writing', 'speaking', 'impromptu', 'checkin', 'review_errors'] as const;
export const planTaskTypeSchema = z.enum(PLAN_TASK_TYPE_CODES);
export const planTaskStatusSchema = z.enum(['pending', 'done', 'skipped', 'expired']);
export const planPhaseSchema = z.enum(['foundation', 'practice', 'simulation']);

/** Cách mở nội dung của task (web gọi POST /attempts {mode, test_set_id | section_id, plan_task_id} hoặc mở bài học/bộ từ) */
export const planTaskLaunchSchema = z.object({
  kind: z.enum(['attempt', 'lesson', 'vocab_list', 'checkin']),
  mode: z.enum(['exam', 'practice', 'drill', 'timed_drill']).nullable(),
  test_set_id: uuidSchema.nullable(),
  section_id: uuidSchema.nullable(),
  lesson_id: uuidSchema.nullable(),
  vocab_list_id: uuidSchema.nullable(),
});

export const planTaskSchema = z.object({
  id: uuidSchema,
  plan_week_id: uuidSchema,
  due_date: isoDateSchema,
  task_type: planTaskTypeSchema,
  title: localizedTextSchema,
  ref: z.object({ type: z.string(), id: uuidSchema }).nullable(),
  est_minutes: z.number().int(),
  status: planTaskStatusSchema,
  /** Lý do giao bài theo ngôn ngữ người học (spec: string) */
  evidence: z.string().nullable(),
  /** v1.1: mã lý do + tham số để web tự dịch (`plan.evidence.<code>`) */
  evidence_code: z.string().nullable(),
  evidence_params: z.record(z.string(), z.union([z.string(), z.number()])),
  result_ref: z.record(z.string(), z.unknown()).nullable(),
  completed_at: z.string().nullable(),
  launch: planTaskLaunchSchema.nullable(),
  /** Quá hạn (ngày < hôm nay, còn pending) – tự `expired` sau 3 ngày */
  overdue: z.boolean(),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

export const planDaySchema = z.object({ date: isoDateSchema, status: z.enum(['done', 'partial', 'pending', 'rest']), tasks: z.array(planTaskSchema) });

export const planWeekSchema = z.object({
  id: uuidSchema,
  week_no: z.number().int(),
  start_date: isoDateSchema,
  end_date: isoDateSchema,
  phase: planPhaseSchema,
  /** Part trọng tâm (spec: string) */
  focus: z.string().nullable(),
  focus_skill: z.string().nullable(),
  load_minutes: z.number().int(),
  budget_minutes: z.number().int(),
  checkin_done: z.boolean(),
  adjustment: z.record(z.string(), z.unknown()).nullable(),
  /** Free: tuần sau tuần hiện tại bị khoá (không trả task) */
  locked: z.boolean(),
  progress_pct: z.number(),
  days: z.array(planDaySchema),
});
export type PlanWeek = z.infer<typeof planWeekSchema>;

export const planSettingsSchema = z.object({
  weekly_minutes: z.number().int(),
  study_days: z.array(weekdaySchema),
  reminder_time: hhmmSchema.nullable(),
  timezone: z.string(),
  start_date: isoDateSchema,
  exam_date: isoDateSchema.nullable(),
  target_score: z.number().nullable(),
});
export type PlanSettings = z.infer<typeof planSettingsSchema>;

export const PLAN_FORECAST_STATUSES = ['not_started', 'on_track', 'slightly_behind', 'behind'] as const;

export const studyPlanSchema = z.object({
  id: uuidSchema,
  program: programCodeSchema,
  version_no: z.number().int(),
  generated_by: z.string(),
  generated_at: z.string(),
  target: z.object({ score: z.number().nullable(), exam_date: isoDateSchema.nullable(), suggested: z.number().nullable(), feasible: z.boolean().nullable() }),
  /** Điểm ước tính hiện tại (chẩn đoán/bài gần nhất) */
  predicted_now: z.number().nullable(),
  baseline: z.object({ score: z.number().nullable(), low: z.number().nullable(), high: z.number().nullable(), source: z.string() }).nullable(),
  weeks_total: z.number().int(),
  week_current: z.number().int().nullable(),
  progress_pct: z.number(),
  minutes_per_skill: z.record(z.string(), z.number()),
  mastery_path: z.record(z.string(), z.unknown()).nullable(),
  weeks: z.array(planWeekSchema),
  locked_weeks_from: z.number().int().nullable(),
  settings: planSettingsSchema,
  progress: z.object({
    week_pct: z.number(),
    plan_pct: z.number(),
    exam_pct: z.number().nullable(),
    days_to_exam: z.number().int().nullable(),
    forecast: z.enum(PLAN_FORECAST_STATUSES),
    forecast_ratio: z.number().nullable(),
  }),
  is_pro: z.boolean(),
  full_test_every_weeks: z.number().int(),
});
export type StudyPlan = z.infer<typeof studyPlanSchema>;

export const planQuerySchema = z.object({ program: programCodeSchema.default('toeic') });

/** POST /me/plan – tạo lộ trình từ onboarding (v1.1) */
export const planCreateInputSchema = z
  .object({
    program: programCodeSchema,
    target_score: z.number().min(0).max(1000).optional(),
    exam_date: isoDateSchema.optional(),
    /** Phút học mỗi tuần (1–35 giờ) */
    weekly_minutes: z.number().int().min(60).max(2100),
    study_days: z.array(weekdaySchema).min(1).max(7),
    /** Giờ nhắc học ưa thích theo giờ người học; null/không gửi = không nhắc */
    reminder_time: hhmmSchema.nullable().optional(),
    /** IANA (vd Asia/Ho_Chi_Minh) – cập nhật iam.users.timezone */
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine((v) => new Set(v.study_days).size === v.study_days.length, { message: 'study_days must be unique', path: ['study_days'] });
export type PlanCreateInput = z.infer<typeof planCreateInputSchema>;

export const planRegenerateInputSchema = z.object({ program: programCodeSchema });
export const planRegenerateResultSchema = z.object({ job_id: z.string(), status: z.enum(['queued', 'running', 'completed', 'failed']), plan_id: uuidSchema.nullable() });

export const planTodaySchema = z.object({
  date: isoDateSchema,
  timezone: z.string(),
  plan_id: uuidSchema.nullable(),
  focus: z.string().nullable(),
  tasks: z.array(planTaskSchema),
  overdue: z.array(planTaskSchema),
  /** Khởi động từ vựng (spec `warmup`) */
  warmup: planTaskSchema.nullable(),
  /** "Nếu chỉ có 15 phút" */
  quick: z.object({ minutes: z.number().int(), items: z.array(z.object({ task_id: uuidSchema, est_minutes: z.number().int(), shortened: z.boolean() })) }),
  week: z.object({ id: uuidSchema, week_no: z.number().int(), progress_pct: z.number(), checkin_due: z.boolean(), checkin_done: z.boolean() }).nullable(),
  studied_today: z.boolean(),
  streak: z.object({ current: z.number().int(), at_risk: z.boolean(), freeze_available: z.boolean() }),
});
export type PlanToday = z.infer<typeof planTodaySchema>;

/** PATCH /plan-tasks/{taskId} – đổi trạng thái / gắn kết quả / đổi ngày trong cùng tuần (v1.1) */
export const planTaskPatchSchema = z
  .object({
    status: z.enum(['pending', 'done', 'skipped']).optional(),
    result_ref: z.object({ attempt_id: uuidSchema.optional(), lesson_id: uuidSchema.optional() }).optional(),
    due_date: isoDateSchema.optional(),
  })
  .refine((v) => v.status !== undefined || v.result_ref !== undefined || v.due_date !== undefined, { message: 'nothing to update' });
export type PlanTaskPatch = z.infer<typeof planTaskPatchSchema>;

export const CHECKIN_FEELINGS = ['great', 'good', 'ok', 'tired', 'struggling'] as const;
export const CHECKIN_TEXT_MAX = 500;

/** POST /me/plan/checkin (spec: program + availability_next_week; v1.1 thêm cảm nhận, giờ thực tế, khó khăn) */
export const planCheckinInputSchema = z.object({
  program: programCodeSchema,
  feeling: z.enum(CHECKIN_FEELINGS).optional(),
  actual_minutes: z.number().int().min(0).max(3000).optional(),
  /** Văn bản tự do – qua guard, che PII, bọc <user_input> trong prompt */
  difficulties: z.string().trim().max(CHECKIN_TEXT_MAX).optional(),
  availability_next_week: z.object({ minutes: z.number().int().min(0).max(2100).optional(), days: z.array(weekdaySchema).max(7).optional(), note: z.string().trim().max(200).optional() }).optional(),
});
export type PlanCheckinInput = z.infer<typeof planCheckinInputSchema>;

export const PLAN_ADJUST_STATUSES = ['pending', 'ready', 'rejected', 'needs_clarification', 'applied', 'expired', 'failed', 'superseded'] as const;
export const planAdjustStatusSchema = z.enum(PLAN_ADJUST_STATUSES);

export const planAdjustProposalSchema = z.object({
  proposal_id: uuidSchema,
  status: planAdjustStatusSchema,
  source: z.enum(['checkin', 'instruction']),
  summary: z.string().nullable(),
  clarifying_question: z.string().nullable(),
  operations: z.array(z.record(z.string(), z.unknown())),
  before: z.array(planTaskSchema),
  after: z.array(planTaskSchema),
  changes: z.array(z.object({ task_id: uuidSchema, op: z.string(), field: z.string(), from: z.union([z.string(), z.number()]), to: z.union([z.string(), z.number()]) })),
  violations: z.array(z.object({ code: z.string(), op_index: z.number().int().optional(), task_id: z.string().optional(), week_id: z.string().optional(), detail: z.string().optional() })),
  week: z.object({ id: uuidSchema, week_no: z.number().int(), start_date: isoDateSchema, end_date: isoDateSchema }).nullable(),
  minutes_before: z.number().int(),
  minutes_after: z.number().int(),
  budget_minutes: z.number().int(),
  max_minutes: z.number().int().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  applied_at: z.string().nullable(),
});
export type PlanAdjustProposal = z.infer<typeof planAdjustProposalSchema>;

export const planCheckinResultSchema = planWeekSchema.extend({
  adjust: z.object({ proposal_id: uuidSchema, status: planAdjustStatusSchema }).nullable(),
  xp_earned: z.number().int(),
  /** Văn bản khó khăn bị guard chặn → không gửi AI (vẫn lưu check-in) */
  difficulties_used: z.boolean(),
});

export const planAdjustInstructionSchema = z.object({ program: programCodeSchema, instruction: z.string().trim().min(2).max(CHECKIN_TEXT_MAX) });
export const planAdjustListQuerySchema = z.object({ program: programCodeSchema.default('toeic'), limit: z.coerce.number().int().min(1).max(50).default(10) });
export const planAdjustListSchema = z.object({ data: z.array(planAdjustProposalSchema) });
export const planAdjustApplyResultSchema = z.object({ proposal: planAdjustProposalSchema, week: planWeekSchema });

// ----------------------------------------------------------------------------- Diagnostic thích ứng
/** Trạng thái thích ứng lưu ở learn.attempts.draft_state.adaptive (packages/scoring DiagnosticState) */
export const diagnosticStateSchema = z.object({
  v: z.literal(1),
  levels: z.record(z.string(), z.union([z.literal(1), z.literal(2)])),
  run: z.record(z.string(), z.object({ correct: z.number().int(), wrong: z.number().int() })),
  served: z.array(
    z.object({
      question_id: z.string(),
      section_code: z.string(),
      skill: z.string(),
      level: z.union([z.literal(1), z.literal(2)]),
      group_key: z.string().nullable(),
      subskills: z.array(z.string()),
      correct: z.boolean().nullable(),
    }),
  ),
  current: z.string().nullable(),
  queue: z.array(z.string()),
  units: z.record(z.string(), z.number().int()),
  done: z.boolean(),
  planned: z.number().int(),
});

export const diagnosticStartInputSchema = z.object({ program: programCodeSchema.default('toeic') });
/** POST /me/diagnostic/{attemptId}/next – AttemptAnswerInput (bỏ trống body = lấy lại câu đang chờ) */
export const diagnosticAnswerInputSchema = z.object({ question_id: uuidSchema, answer: answerInputSchema, time_spent_ms: z.number().int().min(0).max(3_600_000).optional() });

const rangeSchema = z.object({ score: z.number(), low: z.number(), high: z.number() });
export const diagnosticEstimateSchema = z.object({
  /** Tổng (spec `estimate.score`) */
  score: z.number().nullable(),
  /** Sai số chuẩn (điểm) – spec `estimate.se` */
  se: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  listening: rangeSchema.nullable(),
  reading: rangeSchema.nullable(),
  answered: z.number().int(),
  estimated: z.literal(true),
});

export const diagnosticResultSchema = z.object({
  attempt_id: uuidSchema,
  estimate: diagnosticEstimateSchema,
  mastery: z.array(z.object({ subskill: z.string(), skill: z.string(), mastery: z.number(), confidence: z.number(), n_obs: z.number().int() })),
  target: z.object({
    current: z.number(),
    suggested: z.number(),
    desired: z.number().nullable(),
    feasible: z.boolean().nullable(),
    weeks_left: z.number().int(),
    weekly_minutes: z.number().int(),
    required_weekly_minutes: z.number().int().nullable(),
    reason: z.enum(['feasible', 'stretch', 'unreachable', 'no_exam_date', 'no_target']),
  }),
});
export type DiagnosticResult = z.infer<typeof diagnosticResultSchema>;

export const diagnosticStepSchema = z.object({
  attempt_id: uuidSchema,
  done: z.boolean(),
  /** QuestionPublic (không đáp án) */
  next_question: z.record(z.string(), z.unknown()).nullable(),
  progress: z.object({ answered: z.number().int(), served: z.number().int(), planned: z.number().int(), section_code: z.string().nullable(), level: z.number().int().nullable(), group_remaining: z.number().int() }),
  /** Ước tính tạm (sau mỗi câu); bài xong = kết quả cuối */
  estimate: diagnosticEstimateSchema.nullable(),
  last_correct: z.boolean().nullable(),
  result: diagnosticResultSchema.nullable(),
});
export type DiagnosticStep = z.infer<typeof diagnosticStepSchema>;

// ----------------------------------------------------------------------------- Huy hiệu
export const badgeSchema = z.object({
  code: z.string(),
  name: localizedTextSchema,
  rule: z.record(z.string(), z.unknown()),
  earned: z.boolean(),
  earned_at: z.string().nullable(),
  progress: z.object({ current: z.number().int(), target: z.number().int() }).nullable(),
});
export type Badge = z.infer<typeof badgeSchema>;
export const badgeListSchema = z.object({ data: z.array(badgeSchema), earned_count: z.number().int() });
