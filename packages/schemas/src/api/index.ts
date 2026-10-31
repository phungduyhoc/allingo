import { z } from 'zod';
import { isoDateSchema, localeSchema, localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { answerInputSchema } from '../question/answer.js';

export * from './attempt.js';

// ----------------------------------------------------------------------------- Auth / Me
export const registerInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(80),
  /** Token phiên khách để ghép tiến độ */
  guest_token: z.string().max(512).optional(),
  ui_locale: localeSchema.optional(),
  turnstile_token: z.string().max(2048).optional(),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
  guest_token: z.string().max(512).optional(),
  turnstile_token: z.string().max(2048).optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({ refresh_token: z.string().max(1024).optional() });

export const otpRequestInputSchema = z.object({
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  channel: z.enum(['zalo', 'sms']).default('zalo'),
});
export const otpVerifyInputSchema = z.object({
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  otp: z.string().length(6),
  guest_token: z.string().max(512).optional(),
});

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  ui_locale: localeSchema,
  explain_locale: localeSchema,
  timezone: z.string(),
  is_guest: z.boolean(),
  roles: z.array(z.string()),
  active_program: programCodeSchema.nullable(),
  created_at: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const authTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int(),
  user: userSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const guestSessionSchema = z.object({ guest_token: z.string(), expires_at: z.string(), user: userSchema });
export type GuestSession = z.infer<typeof guestSessionSchema>;

export const userUpdateSchema = z.object({
  display_name: z.string().min(1).max(80).optional(),
  avatar_url: z.url().max(1024).optional(),
  ui_locale: localeSchema.optional(),
  explain_locale: localeSchema.optional(),
  timezone: z.string().max(64).optional(),
  active_program: programCodeSchema.optional(),
});
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const sessionSchema = z.object({
  id: uuidSchema,
  device: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
  last_seen_at: z.string().nullable(),
  current: z.boolean(),
});

export const CONSENT_TYPES = ['terms', 'privacy', 'voice_processing', 'marketing', 'minor_guardian'] as const;
export const consentInputSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
  version: z.string().max(32).optional(),
});
export const consentSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  version: z.string(),
  granted_at: z.string(),
  revoked_at: z.string().nullable(),
});

// ----------------------------------------------------------------------------- Enrollment
export const enrollmentInputSchema = z.object({
  program: programCodeSchema,
  target_score: z.number().min(0).max(1000).optional(),
  target_level: z.string().max(16).optional(),
  exam_date: isoDateSchema.optional(),
  daily_minutes: z.number().int().min(10).max(240).optional(),
  self_assessed_level: z.string().max(16).optional(),
});
export type EnrollmentInput = z.infer<typeof enrollmentInputSchema>;

export const enrollmentSchema = z.object({
  id: uuidSchema,
  program: programCodeSchema,
  target_score: z.number().nullable(),
  target_level: z.string().nullable(),
  exam_date: z.string().nullable(),
  daily_minutes: z.number().int(),
  current_level: z.record(z.string(), z.unknown()).nullable(),
  days_to_exam: z.number().int().nullable(),
  diagnostic_attempt_id: uuidSchema.nullable(),
  started_at: z.string(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

// ----------------------------------------------------------------------------- Catalog
export const programSchema = z.object({
  code: programCodeSchema,
  name: localizedTextSchema,
  score_scale: z.record(z.string(), z.unknown()),
  languages: z.array(z.string()),
});
export const sectionSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  skill: z.string(),
  name: localizedTextSchema,
  level: z.string().nullable(),
  duration_sec: z.number().int().nullable(),
  question_count: z.number().int().nullable(),
  rules: z.record(z.string(), z.unknown()),
});
export const testSetSummarySchema = z.object({
  id: uuidSchema,
  code: z.string(),
  title: localizedTextSchema,
  kind: z.enum(['full', 'mini', 'part_drill', 'diagnostic', 'topic_pack']),
  level: z.string().nullable(),
  is_free: z.boolean(),
  locked: z.boolean(),
  duration_sec: z.number().int().nullable(),
  question_count: z.number().int(),
  last_score: z.number().nullable(),
  best_score: z.number().nullable(),
  attempts_count: z.number().int(),
});
export type TestSetSummary = z.infer<typeof testSetSummarySchema>;
export const testSetSchema = testSetSummarySchema.extend({
  sections: z.array(sectionSchema),
  in_progress_attempt_id: uuidSchema.nullable(),
});
export type TestSet = z.infer<typeof testSetSchema>;
export const testSetListQuerySchema = z.object({
  kind: z.enum(['full', 'mini', 'part_drill', 'diagnostic', 'topic_pack']).optional(),
  level: z.string().max(16).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ----------------------------------------------------------------------------- AI
export const explainInputSchema = z.object({
  question_version_id: uuidSchema,
  chosen_option: z.string().max(32).optional(),
  attempt_id: uuidSchema.optional(),
});
export type ExplainInput = z.infer<typeof explainInputSchema>;

export const explanationSchema = z.object({
  correct_option: z.string(),
  why_correct: z.string(),
  why_others_wrong: z.record(z.string(), z.string()),
  how_to_spot: z.string(),
  related_points: z.array(z.object({ type: z.string(), ref_id: z.string().optional(), code: z.string().optional(), label: z.string() })),
  tested_point: z.string().optional(),
  chosen_option_trap: z.string().nullable().optional(),
  key_vocab: z.array(z.object({ term: z.string(), reading: z.string().nullable().optional(), meaning: z.string() })).optional(),
  locale: z.string(),
  cached: z.boolean(),
  ai_task_id: uuidSchema.nullable(),
});
export type Explanation = z.infer<typeof explanationSchema>;

export const threadContextSchema = z.object({
  attempt_id: uuidSchema.optional(),
  submission_id: uuidSchema.optional(),
  lesson_id: uuidSchema.optional(),
  question_version_id: uuidSchema.optional(),
  mode: z.enum(['text', 'voice']).default('text'),
});
export const threadCreateSchema = z.object({ program: programCodeSchema.optional(), context: threadContextSchema.optional() });
export const threadSchema = z.object({
  id: uuidSchema,
  program: z.string().nullable(),
  title: z.string().nullable(),
  context: threadContextSchema.nullable(),
  updated_at: z.string(),
});
export const messageCreateSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  recording_id: uuidSchema.optional(),
  want_audio: z.boolean().default(false),
});
export const messageSchema = z.object({
  id: uuidSchema,
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string(),
  audio_url: z.string().nullable(),
  actions: z.array(z.record(z.string(), z.unknown())),
  ai_task_id: uuidSchema.nullable(),
  created_at: z.string(),
});
export const aiFeedbackInputSchema = z.object({
  ai_task_id: uuidSchema,
  rating: z.enum(['helpful', 'not_helpful', 'wrong']),
  comment: z.string().max(1000).optional(),
});

// ----------------------------------------------------------------------------- Billing / Me
export const entitlementsSchema = z.object({
  program: z.string(),
  is_pro: z.boolean(),
  features: z.array(z.string()),
  quotas: z.array(
    z.object({
      feature: z.string(),
      period: z.string(),
      limit: z.number().int().nullable(),
      used: z.number().int(),
      reset_at: z.string(),
    }),
  ),
  credits: z.number().int(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export const creditBalanceSchema = z.object({
  balance: z.number().int(),
  expiring_soon: z.array(z.object({ amount: z.number().int(), expires_at: z.string() })),
  costs: z.record(z.string(), z.number().int()),
});

export const statsSchema = z.object({
  program: z.string(),
  current_estimate: z.number().nullable(),
  target: z.number().nullable(),
  trend_30d: z.array(z.object({ date: z.string(), score: z.number() })),
  by_skill: z.record(z.string(), z.unknown()),
  by_section: z.record(z.string(), z.unknown()),
  by_question_type: z.record(z.string(), z.unknown()),
  weakest: z.array(z.string()),
  streak: z.object({ current: z.number().int(), longest: z.number().int(), freeze_available: z.boolean() }),
  xp: z.object({ total: z.number().int(), this_week: z.number().int() }),
  minutes_this_week: z.number().int(),
});
export type Stats = z.infer<typeof statsSchema>;

export const planSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  kind: z.enum(['free', 'monthly', 'yearly', 'lifetime', 'combo', 'credit_pack', 'b2b_seat']),
  programs: z.array(z.string()),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  price: z.object({ amount: z.number(), currency: z.string(), compare_at: z.number().nullable() }).nullable(),
  credits_included: z.number().int(),
  credits_period: z.string().nullable(),
  duration_days: z.number().int().nullable(),
  features: z.record(z.string(), z.unknown()),
});

// Re-export để client dùng answerInput cùng chỗ
export { answerInputSchema };
