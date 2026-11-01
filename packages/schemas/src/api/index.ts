import { z } from 'zod';
import { isoDateSchema, localeSchema, localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { answerInputSchema } from '../question/answer.js';

export * from './attempt.js';
export * from './media.js';

// ----------------------------------------------------------------------------- Auth / Me
export const registerInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(80),
  /** Token phiên khách để ghép tiến độ */
  guest_token: z.string().max(512).optional(),
  referral_code: z.string().max(32).optional(),
  ui_locale: localeSchema.optional(),
  turnstile_token: z.string().max(2048).optional(),
  /** Đồng ý điều khoản + chính sách (bắt buộc theo PDPL); false → 400. Thiếu = client cũ, coi như đã hiển thị văn bản đồng ý khi đăng ký */
  accept_terms: z.boolean().optional(),
  marketing_opt_in: z.boolean().optional(),
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

export const PHONE_REGEX = /^\+?[0-9]{9,15}$/;
export const OTP_CHANNELS = ['zalo', 'sms', 'email'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

/** Hợp đồng gốc chỉ có phone (zalo/sms); mở rộng tương thích thêm email (SPEC-ISSUES S11). Phải có đúng một trong phone | email. */
export const otpRequestInputSchema = z
  .object({
    phone: z.string().regex(PHONE_REGEX).optional(),
    email: z.email().max(254).optional(),
    channel: z.enum(OTP_CHANNELS).optional(),
    turnstile_token: z.string().max(2048).optional(),
  })
  .refine((v) => !!v.phone !== !!v.email, { message: 'Provide exactly one of phone or email', path: ['phone'] })
  .transform((v) => ({ ...v, channel: v.channel ?? (v.email ? ('email' as const) : ('zalo' as const)) }))
  .refine((v) => (v.channel === 'email') === !!v.email, { message: 'channel must match identifier type', path: ['channel'] });
export type OtpRequestInput = z.infer<typeof otpRequestInputSchema>;

export const otpVerifyInputSchema = z
  .object({
    phone: z.string().regex(PHONE_REGEX).optional(),
    email: z.email().max(254).optional(),
    otp: z.string().length(6),
    guest_token: z.string().max(512).optional(),
    display_name: z.string().min(1).max(80).optional(),
    ui_locale: localeSchema.optional(),
    referral_code: z.string().max(32).optional(),
  })
  .refine((v) => !!v.phone !== !!v.email, { message: 'Provide exactly one of phone or email', path: ['phone'] });
export type OtpVerifyInput = z.infer<typeof otpVerifyInputSchema>;

export const otpRequestResultSchema = z.object({ status: z.literal('sent'), channel: z.enum(OTP_CHANNELS), retry_after: z.number().int(), expires_in: z.number().int() });

export const OAUTH_PROVIDERS = ['google', 'apple', 'facebook'] as const;
export type OAuthProviderCode = (typeof OAUTH_PROVIDERS)[number];
export const oauthInputSchema = z
  .object({
    id_token: z.string().max(8192).optional(),
    code: z.string().max(2048).optional(),
    redirect_uri: z.string().max(2048).optional(),
    nonce: z.string().max(256).optional(),
    guest_token: z.string().max(512).optional(),
    referral_code: z.string().max(32).optional(),
    ui_locale: localeSchema.optional(),
    /** Khi email đã có tài khoản mật khẩu: gửi lại kèm mật khẩu để xác nhận liên kết (không auto-merge) */
    link_password: z.string().max(128).optional(),
    link_confirm: z.boolean().optional(),
    /** Apple chỉ gửi tên ở lần đăng nhập đầu, client chuyển tiếp */
    display_name: z.string().min(1).max(80).optional(),
  })
  .refine((v) => !!v.id_token || !!v.code, { message: 'id_token or code is required', path: ['id_token'] });
export type OAuthInput = z.infer<typeof oauthInputSchema>;

export const deletionRequestResultSchema = z.object({ status: z.literal('scheduled'), due_at: z.string(), request_id: uuidSchema });

export const roleGrantInputSchema = z.object({
  role_code: z.enum(['learner', 'teacher', 'editor', 'admin', 'org_admin', 'service']),
  program_code: programCodeSchema.optional(),
  action: z.enum(['grant', 'revoke']).default('grant'),
});
export type RoleGrantInput = z.infer<typeof roleGrantInputSchema>;

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
  /** Phiên bản prompt đã sinh giải thích (v1.1 – Sprint 5; khoá cache = question_version × chosen_option × locale × prompt_version) */
  prompt_version_id: uuidSchema.nullable().optional(),
});
export type Explanation = z.infer<typeof explanationSchema>;

/**
 * Chẩn đoán AI sau bài R/L (`diagnose_rl`, v1.1 – Sprint 5): kết quả lưu trong `learn.attempts.score_breakdown.ai_diagnosis`
 * để màn kết quả đọc lại bằng GET /attempts/{id}/diagnosis.
 */
export const attemptAiDiagnosisSchema = z.object({
  attempt_id: uuidSchema,
  top_error_type: z.string(),
  evidence: z.array(z.string()),
  why: z.string(),
  steps: z.array(z.string()),
  check_question: z.object({ stem: z.string(), options: z.array(z.string()), answer: z.string(), explanation: z.string() }),
  encouragement: z.string(),
  locale: z.string(),
  ai_task_id: uuidSchema.nullable(),
  prompt_version_id: uuidSchema.nullable(),
  created_at: z.string(),
  cached: z.boolean(),
});
export type AttemptAiDiagnosis = z.infer<typeof attemptAiDiagnosisSchema>;

/** Phản hồi chi tiết khi vượt hạn mức (error.details.quota – 429 quota_exceeded, v1.1 – Sprint 5) */
export const quotaExceededDetailsSchema = z.object({
  feature: z.string(),
  period: z.enum(['day', 'month', 'lifetime']),
  limit: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
  /** Thời điểm reset (00:00 giờ Asia/Ho_Chi_Minh của kỳ sau), ISO UTC */
  resets_at: z.string(),
  /** Bí danh cũ của `resets_at` (giữ tương thích Sprint 0–4) */
  reset_at: z.string(),
});
export type QuotaExceededDetails = z.infer<typeof quotaExceededDetailsSchema>;

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
      /** Còn lại trong kỳ (limit − used, không âm; null = không giới hạn) – v1.1 Sprint 5 */
      remaining: z.number().int().nullable().optional(),
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
