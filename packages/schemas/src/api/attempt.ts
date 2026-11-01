import { z } from 'zod';
import { localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { answerInputSchema } from '../question/answer.js';
import { questionTypeCodeSchema } from '../question/content.js';

export const ATTEMPT_MODES = ['exam', 'practice', 'diagnostic', 'drill', 'timed_drill'] as const;
export const attemptModeSchema = z.enum(ATTEMPT_MODES);
export type AttemptMode = z.infer<typeof attemptModeSchema>;
export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'graded', 'abandoned'] as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);

export const attemptCreateSchema = z.object({
  program: programCodeSchema,
  mode: attemptModeSchema,
  test_set_id: uuidSchema.optional(),
  section_id: uuidSchema.optional(),
  plan_task_id: uuidSchema.optional(),
  device: z.record(z.string(), z.unknown()).optional(),
});
export type AttemptCreate = z.infer<typeof attemptCreateSchema>;

export const attemptAnswerInputSchema = z.object({
  question_id: uuidSchema,
  answer: answerInputSchema,
  time_spent_ms: z.number().int().min(0).max(7_200_000).optional(),
  flagged: z.boolean().optional(),
});
export type AttemptAnswerInput = z.infer<typeof attemptAnswerInputSchema>;

export const attemptAnswersPutSchema = z.object({
  answers: z.array(attemptAnswerInputSchema).max(100),
  /** Thời gian đã dùng theo section (giây) để khôi phục đồng hồ */
  section_elapsed_sec: z.record(z.string(), z.number().int().min(0)).optional(),
  /** Trạng thái UI để khôi phục: câu hiện tại, phần hiện tại */
  ui_state: z.object({ current_question_id: uuidSchema.optional(), current_section_code: z.string().optional() }).optional(),
});
export type AttemptAnswersPut = z.infer<typeof attemptAnswersPutSchema>;

export const attemptEventSchema = z.object({
  /** tab_hidden = visibilitychange (v1.1, Sprint 3); tab_leave giữ để tương thích client Sprint 0 */
  type: z.enum(['tab_leave', 'tab_hidden', 'section_timeout', 'audio_played', 'focus_lost', 'resume', 'part_switch', 'audio_started', 'audio_ended', 'audio_stalled']),
  at: z.iso.datetime({ offset: true }).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type AttemptEvent = z.infer<typeof attemptEventSchema>;

/** Trạng thái nháp lưu trong learn.attempts.draft_state */
export const attemptDraftStateSchema = z.object({
  /** Thứ tự question_version_id đã chốt khi tạo attempt (snapshot) */
  question_order: z.array(z.object({ question_id: uuidSchema, question_version_id: uuidSchema, section_code: z.string(), group_key: z.string().nullable(), order_no: z.number().int() })),
  time_limit_sec: z.number().int().nullable(),
  expires_at: z.string().nullable(),
  section_elapsed_sec: z.record(z.string(), z.number().int()).default({}),
  ui_state: z.object({ current_question_id: uuidSchema.optional(), current_section_code: z.string().optional() }).default({}),
  events: z.array(attemptEventSchema.extend({ at: z.string() })).max(500).default([]),
  answered_count: z.number().int().default(0),
  last_saved_at: z.string().nullable().default(null),
});
export type AttemptDraftState = z.infer<typeof attemptDraftStateSchema>;

export const questionPublicSchema = z.object({
  question_id: uuidSchema,
  question_version_id: uuidSchema,
  question_type: questionTypeCodeSchema,
  section_code: z.string(),
  group_key: z.string().nullable(),
  order_no: z.number().int(),
  /** PublicQuestionContent (không answer_key) */
  content: z.record(z.string(), z.unknown()),
  media: z.array(z.object({ id: uuidSchema, kind: z.string(), url: z.string(), duration_ms: z.number().int().nullable() })),
  passage: z.object({ id: uuidSchema, kind: z.string(), title: z.string().nullable(), body: z.string().nullable(), media_url: z.string().nullable() }).nullable(),
});
export type QuestionPublic = z.infer<typeof questionPublicSchema>;

export const attemptSchema = z.object({
  id: uuidSchema,
  program: programCodeSchema,
  mode: attemptModeSchema,
  status: attemptStatusSchema,
  test_set: z.record(z.string(), z.unknown()).nullable(),
  sections: z.array(z.object({ section_code: z.string(), duration_sec: z.number().int().nullable(), elapsed_sec: z.number().int(), locked: z.boolean() })),
  questions: z.array(questionPublicSchema),
  draft_answers: z.array(attemptAnswerInputSchema),
  started_at: z.string(),
  expires_at: z.string().nullable(),
  server_time: z.string(),
  ui_state: z.record(z.string(), z.unknown()).optional(),
  /** Chỉ chế độ practice/drill: đáp án + đúng/sai của câu ĐÃ trả lời (hiện đáp án ngay – Sprint 3). Không bao giờ có ở exam/timed. */
  feedback: z.record(z.string(), z.object({ is_correct: z.boolean().nullable(), correct_answer: z.unknown(), explanation: z.record(z.string(), z.string()).nullable() })).optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;

/** learn.attempts.score_breakdown */
export const scoreBreakdownSchema = z.object({
  by_section: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int(), avg_time_ms: z.number().int().nullable(), score: z.number().nullable() })),
  by_question_type: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int() })),
  by_subskill: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int() })),
  by_topic: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int() })).default({}),
  unanswered: z.number().int(),
  scale: z.record(z.string(), z.unknown()),
  timeout_wrong: z.number().int().default(0),
  /** Chẩn đoán theo quy tắc (packages/scoring diagnoseAttempt) – Sprint 3 */
  diagnosis: z.record(z.string(), z.unknown()).nullable().optional(),
  auto_submitted: z.boolean().optional(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const attemptResultSchema = z.object({
  attempt_id: uuidSchema,
  raw_score: z.number(),
  scaled_score: z.number().nullable(),
  scale: z.record(z.string(), z.unknown()),
  by_section: scoreBreakdownSchema.shape.by_section,
  by_question_type: scoreBreakdownSchema.shape.by_question_type,
  by_subskill: scoreBreakdownSchema.shape.by_subskill,
  compared_to_previous: z.object({ scaled_delta: z.number().nullable(), previous_attempt_id: uuidSchema }).nullable(),
  diagnosis: z.record(z.string(), z.unknown()).nullable(),
  xp_earned: z.number().int(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

export const reviewItemSchema = z.object({
  question: questionPublicSchema,
  your_answer: z.unknown(),
  correct_answer: z.unknown(),
  is_correct: z.boolean().nullable(),
  /** 0–1; null khi câu không chấm tự động (essay/speaking/handwriting) */
  score: z.number().nullable(),
  time_spent_ms: z.number().int().nullable(),
  flagged: z.boolean(),
  details: z.record(z.string(), z.boolean()).nullable(),
  explanation: z.record(z.string(), z.unknown()).nullable(),
  transcript_highlight: z.record(z.string(), z.unknown()).nullable(),
  error_entry_id: uuidSchema.nullable(),
  /** % người làm đúng câu này (cộng đồng) */
  community_correct_rate: z.number().nullable(),
});
export const attemptReviewSchema = z.object({ attempt_id: uuidSchema, items: z.array(reviewItemSchema) });
export type AttemptReview = z.infer<typeof attemptReviewSchema>;

export const attemptSummarySchema = z.object({
  id: uuidSchema,
  program: z.string(),
  mode: attemptModeSchema,
  status: attemptStatusSchema,
  test_set_title: localizedTextSchema.nullable(),
  raw_score: z.number().nullable(),
  scaled_score: z.number().nullable(),
  started_at: z.string(),
  submitted_at: z.string().nullable(),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

export const myAttemptsQuerySchema = z.object({
  mode: attemptModeSchema.optional(),
  program: programCodeSchema.optional(),
  /** Khoảng ngày bắt đầu (YYYY-MM-DD, theo UTC) – v1.1 */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: attemptStatusSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /attempts/{id}/review – lọc (v1.1): sai / đánh dấu / theo Part */
export const attemptReviewQuerySchema = z.object({
  only_wrong: z.stringbool().default(false),
  flagged: z.stringbool().default(false),
  section: z.string().max(32).optional(),
});
export type AttemptReviewQuery = z.infer<typeof attemptReviewQuerySchema>;

export const practiceQuestionsQuerySchema = z.object({
  program: programCodeSchema.default('toeic'),
  section: z.string().max(32).optional(),
  question_type: questionTypeCodeSchema.optional(),
  topic: z.string().max(64).optional(),
  subskill: z.string().max(64).optional(),
  count: z.coerce.number().int().min(1).max(50).default(10),
  /** Query string: 'false'/'0' phải là false (z.coerce.boolean coi mọi chuỗi khác rỗng là true) */
  timed: z.stringbool().default(false),
  /** Từ khoá – tìm qua SearchProvider (Meilisearch/PG), chỉ câu đã phát hành (v1.1) */
  q: z.string().trim().min(2).max(100).optional(),
});
