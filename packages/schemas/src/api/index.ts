import { z } from 'zod';
import { isoDateSchema, localeSchema, localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { answerInputSchema } from '../question/answer.js';
import { planPriceSchema } from './billing.js';

export * from './attempt.js';
export * from './media.js';
export * from './learning-tools.js';
export * from './billing.js';
export * from './growth.js';
export * from './learning-plan.js';
export * from './learning-s10.js';
export * from './s12.js';
import { attributionInputSchema, statsS10Schema } from './learning-s10.js';

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
  /** v1.1 – S10: UTM/referrer lần chạm đầu (lưu iam.users.attribution khi tạo tài khoản) */
  attribution: attributionInputSchema.optional(),
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
    /** v1.1 – S10: chỉ lưu khi OTP tạo tài khoản mới */
    attribution: attributionInputSchema.optional(),
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
    /** v1.1 – S10: chỉ lưu khi OAuth tạo tài khoản mới */
    attribution: attributionInputSchema.optional(),
  })
  .refine((v) => !!v.id_token || !!v.code, { message: 'id_token or code is required', path: ['id_token'] });
export type OAuthInput = z.infer<typeof oauthInputSchema>;

export const deletionRequestResultSchema = z.object({ status: z.literal('scheduled'), due_at: z.string(), request_id: uuidSchema });

export const roleGrantInputSchema = z.object({
  role_code: z.enum(['learner', 'teacher', 'editor', 'admin', 'org_admin', 'service', 'beta_tester']),
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

/** v1.1 – S12: `refund_policy` (chính sách hoàn tiền có phiên bản); tài liệu `voice_consent` ghi đồng ý loại `voice_processing` */
export const CONSENT_TYPES = ['terms', 'privacy', 'voice_processing', 'marketing', 'minor_guardian', 'refund_policy'] as const;
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

/** Độ dài tối đa một tin nhắn gia sư (ký tự) – S6 */
export const TUTOR_MESSAGE_MAX_CHARS = 2000;
/** Loại ngữ cảnh hội thoại (v1.1 – S6): suy ra từ attempt_id / question_version_id; không có → free */
export const THREAD_CONTEXT_KINDS = ['attempt', 'question', 'free'] as const;
export type ThreadContextKind = (typeof THREAD_CONTEXT_KINDS)[number];

export const threadContextSchema = z.object({
  attempt_id: uuidSchema.optional(),
  submission_id: uuidSchema.optional(),
  lesson_id: uuidSchema.optional(),
  question_version_id: uuidSchema.optional(),
  mode: z.enum(['text', 'voice']).default('text'),
  /** v1.1 – S6: server trả loại ngữ cảnh; client có thể gửi `free` để tạo hội thoại tự do (bỏ qua id khác) */
  kind: z.enum(THREAD_CONTEXT_KINDS).optional(),
});
export type ThreadContext = z.infer<typeof threadContextSchema>;
export const threadCreateSchema = z.object({ program: programCodeSchema.optional(), context: threadContextSchema.optional(), title: z.string().trim().min(1).max(120).optional() });
export const threadSchema = z.object({
  id: uuidSchema,
  program: z.string().nullable(),
  title: z.string().nullable(),
  context: threadContextSchema.nullable(),
  updated_at: z.string(),
  /** v1.1 – S6 */
  created_at: z.string().optional(),
  /** Lượt người học đã gửi / giới hạn lượt của thread theo gói (billing.quotas `ai_tutor_thread_turns`; null = không giới hạn) – v1.1 S6 */
  turns: z.object({ used: z.number().int(), limit: z.number().int().nullable(), remaining: z.number().int().nullable() }).optional(),
});
export type Thread = z.infer<typeof threadSchema>;
export const messageCreateSchema = z.object({
  text: z.string().min(1).max(TUTOR_MESSAGE_MAX_CHARS).optional(),
  recording_id: uuidSchema.optional(),
  want_audio: z.boolean().default(false),
});
/** Mã từ chối của guard (v1.1 – S6) – web dịch theo i18n `tutor.refusal.<code>` */
export const REFUSAL_CODES = ['injection', 'off_topic', 'answer_leak', 'unsafe'] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
/** Trích dẫn trong câu trả lời gia sư (v1.1 – S6): câu hỏi đang xem để UI hiển thị khối trích */
export const tutorCitationSchema = z.object({
  type: z.literal('question'),
  question_version_id: uuidSchema,
  section_code: z.string().nullable(),
  /** Trích đề ≤ 160 ký tự (không đáp án) */
  excerpt: z.string(),
});
export type TutorCitation = z.infer<typeof tutorCitationSchema>;
export const tutorActionSchema = z.object({ type: z.enum(['open_page', 'start_task', 'show_question']), target: z.string(), label: z.string() });
export const messageSchema = z.object({
  id: uuidSchema,
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string(),
  audio_url: z.string().nullable(),
  actions: z.array(z.record(z.string(), z.unknown())),
  ai_task_id: uuidSchema.nullable(),
  created_at: z.string(),
  /** v1.1 – S6: tin trả lời bị guard từ chối (text rỗng – web hiển thị theo refusal_code) */
  refused: z.boolean().optional(),
  refusal_code: z.enum(REFUSAL_CODES).nullable().optional(),
  suggested_followups: z.array(z.string()).optional(),
  citations: z.array(tutorCitationSchema).optional(),
});
export type Message = z.infer<typeof messageSchema>;
/** GET /ai/threads/{id} (v1.1 – S6): thread + tin nhắn mới nhất (cũ → mới), `next_cursor` để tải tin cũ hơn */
export const threadDetailSchema = threadSchema.extend({ messages: z.array(messageSchema), next_cursor: z.string().nullable() });
export type ThreadDetail = z.infer<typeof threadDetailSchema>;
/**
 * `data` của sự kiện SSE `result` khi gửi tin nhắn (v1.1 – S6). `delta.text` là các mảnh của `reply_markdown` (văn bản thuần,
 * không phải JSON) – khi có `result`, web thay toàn bộ văn bản stream bằng `reply_markdown` (repair/fallback có thể khác bản stream).
 */
export const tutorReplySchema = z.object({
  message_id: uuidSchema,
  user_message_id: uuidSchema,
  reply_markdown: z.string(),
  actions: z.array(tutorActionSchema),
  suggested_followups: z.array(z.string()),
  grounded_on: z.array(z.string()),
  citations: z.array(tutorCitationSchema),
  refused: z.boolean(),
  refusal_code: z.enum(REFUSAL_CODES).nullable(),
  turns: z.object({ used: z.number().int(), limit: z.number().int().nullable(), remaining: z.number().int().nullable() }),
});
export type TutorReply = z.infer<typeof tutorReplySchema>;
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
  /** v1.1 – S9: chuỗi theo múi giờ người học (`current` = 0 nếu đã đứt), `at_risk` = chưa học hôm nay, đóng băng Pro */
  streak: z.object({
    current: z.number().int(),
    longest: z.number().int(),
    freeze_available: z.boolean(),
    at_risk: z.boolean().optional(),
    last_active_date: z.string().nullable().optional(),
    freezes_used: z.number().int().optional(),
  }),
  xp: z.object({ total: z.number().int(), this_week: z.number().int(), today: z.number().int().optional(), level: z.number().int().optional(), next_level_at: z.number().int().optional() }),
  minutes_this_week: z.number().int(),
  /** v1.1 – S9 */
  badges: z.object({ earned: z.number().int(), total: z.number().int(), latest: z.array(z.object({ code: z.string(), earned_at: z.string() })) }).optional(),
  plan: z.object({ plan_id: z.string(), week_pct: z.number(), forecast: z.string(), days_to_exam: z.number().int().nullable() }).nullable().optional(),
  /** v1.1 – S10: dashboard đầy đủ (analytics, cache 1 giờ) */
  ...statsS10Schema.partial().shape,
});
export type Stats = z.infer<typeof statsSchema>;

export const planSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  kind: z.enum(['free', 'monthly', 'yearly', 'lifetime', 'combo', 'credit_pack', 'b2b_seat']),
  programs: z.array(z.string()),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  /** Giá hiện hành (VND); `id` = price_id cho POST /orders (v1.1 – S7) */
  price: planPriceSchema.nullable(),
  credits_included: z.number().int(),
  credits_period: z.string().nullable(),
  duration_days: z.number().int().nullable(),
  features: z.record(z.string(), z.unknown()),
});

// Re-export để client dùng answerInput cùng chỗ
export { answerInputSchema };
