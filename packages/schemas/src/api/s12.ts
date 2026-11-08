import { z } from 'zod';
import { localeSchema, uuidSchema } from '../common.js';

/**
 * Sprint 12 – beta kín, phản hồi & hỗ trợ, NPS, admin vận hành, MFA admin, chính sách pháp lý (OpenAPI v1.1).
 * Kiểu dùng chung API ↔ web (agent web S12) – không chứa PII trong ví dụ/mặc định.
 */

// ----------------------------------------------------------------------------- Beta gate & mời
/** Mặc định cấu hình beta (ghi đè bằng `billing.feature_flags['ff.growth.beta_gate'].rules.config`) */
export const BETA_DEFAULTS = {
  trial_days: 60,
  credits: 2000,
  /** Số email mời tối đa mỗi ngày (giờ VN) */
  daily_invite_limit: 50,
  /** Hạn dùng mã mời kể từ lúc gửi */
  invite_ttl_days: 14,
  program: 'toeic',
  /** Thời hạn lô credit beta (ngày) */
  credit_valid_days: 90,
} as const;
export const BETA_GATE_FLAG = 'ff.growth.beta_gate';
export const BETA_TESTER_ROLE = 'beta_tester';

export const WAITLIST_PROGRAMS = ['toeic', 'ielts', 'jlpt', 'hsk'] as const;
export const waitlistInputSchema = z.object({
  email: z.email().max(254),
  program: z.enum(WAITLIST_PROGRAMS),
  locale: localeSchema.default('vi'),
  consent_marketing: z.boolean().default(false),
  /** Nguồn (trang landing, chiến dịch) – không PII */
  source: z.string().max(64).regex(/^[A-Za-z0-9_.:/-]*$/).optional(),
});
export type WaitlistInput = z.infer<typeof waitlistInputSchema>;
/** 202 luôn giống nhau dù email đã có (không lộ tồn tại) */
export const waitlistResultSchema = z.object({ status: z.literal('accepted') });

export const betaRedeemInputSchema = z.object({ code: z.string().min(6).max(64) });
export const betaRedeemResultSchema = z.object({
  status: z.enum(['redeemed', 'already_redeemed']),
  invite_id: uuidSchema,
  program: z.string(),
  trial_ends_at: z.string().nullable(),
  /** `already_pro` khi đã có gói Pro còn hạn (chỉ cộng credit) */
  trial_skipped: z.enum(['already_pro']).nullable(),
  credits_granted: z.number().int(),
  balance: z.number().int(),
  survey_pending: z.boolean(),
});
export type BetaRedeemResult = z.infer<typeof betaRedeemResultSchema>;

export const betaStatusSchema = z.object({
  gate_enabled: z.boolean(),
  /** null khi chưa đăng nhập */
  has_access: z.boolean().nullable(),
  reason: z.enum(['gate_off', 'role', 'invite', 'allowlist', 'none', 'anonymous']),
  redeemed_at: z.string().nullable(),
  trial_ends_at: z.string().nullable(),
  survey_completed: z.boolean().nullable(),
});
export type BetaStatus = z.infer<typeof betaStatusSchema>;

export const BETA_INVITE_STATUSES = ['queued', 'sent', 'redeemed', 'revoked', 'expired', 'failed'] as const;
export const adminBetaInviteCreateSchema = z
  .object({
    waitlist_entry_ids: z.array(uuidSchema).max(500).optional(),
    emails: z.array(z.email().max(254)).max(500).optional(),
    program: z.enum(WAITLIST_PROGRAMS).default('toeic'),
    locale: localeSchema.default('vi'),
    batch: z.string().max(64).optional(),
  })
  .refine((v) => (v.waitlist_entry_ids?.length ?? 0) + (v.emails?.length ?? 0) > 0, { message: 'waitlist_entry_ids or emails required' });
export type AdminBetaInviteCreate = z.infer<typeof adminBetaInviteCreateSchema>;
export const adminBetaInviteSchema = z.object({
  id: uuidSchema,
  email_masked: z.string(),
  program: z.string(),
  status: z.enum(BETA_INVITE_STATUSES),
  batch: z.string().nullable(),
  sent_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  redeemed_at: z.string().nullable(),
  redeemed_by: uuidSchema.nullable(),
  send_attempts: z.number().int(),
  last_error: z.string().nullable(),
  created_at: z.string(),
});

// ----------------------------------------------------------------------------- Khảo sát onboarding + NPS
export const BETA_GOALS = ['job', 'graduation', 'study_abroad', 'promotion', 'self_improvement', 'other'] as const;
export const BETA_DEVICES = ['android', 'ios', 'desktop', 'laptop', 'tablet'] as const;
export const betaSurveyInputSchema = z.object({
  goal: z.enum(BETA_GOALS),
  goal_note: z.string().max(200).optional(),
  /** Ngày thi dự kiến (YYYY-MM-DD) hoặc null = chưa có */
  exam_date: z.iso.date().nullable(),
  /** Điểm TOEIC L&R hiện tại (10–990) hoặc null = chưa biết */
  current_score: z.number().int().min(10).max(990).nullable(),
  devices: z.array(z.enum(BETA_DEVICES)).min(1).max(5),
  /** Phút học dự kiến mỗi ngày */
  study_minutes_per_day: z.number().int().min(5).max(600),
});
export type BetaSurveyInput = z.infer<typeof betaSurveyInputSchema>;
export const SURVEY_KINDS = ['beta_onboarding', 'nps_d7', 'nps_d14'] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];
export const surveyResponseSchema = z.object({ kind: z.enum(SURVEY_KINDS), submitted_at: z.string(), score: z.number().int().nullable() });
export const pendingSurveysSchema = z.object({
  data: z.array(z.object({ kind: z.enum(SURVEY_KINDS), due_at: z.string(), expires_at: z.string().nullable() })),
});
export const npsInputSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().max(2000).optional(),
  /** Mặc định: khảo sát NPS đang chờ (ngày 7 hoặc 14) */
  survey: z.enum(['nps_d7', 'nps_d14']).optional(),
});
/** Mốc NPS (ngày kể từ lúc đổi mã beta – hoặc ngày đăng ký nếu không qua beta) và hạn hiển thị */
export const NPS_SCHEDULE = { nps_d7: { day: 7, until_day: 14 }, nps_d14: { day: 14, until_day: 28 } } as const;

// ----------------------------------------------------------------------------- Góp ý, báo lỗi câu, hỗ trợ
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'content_error', 'ux', 'performance', 'other'] as const;
export const feedbackInputSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(3).max(4000),
  page_url: z.string().max(1000).optional(),
  /** trace_id của request gần nhất (header X-Trace-Id) – server tự gắn trace của chính request này nếu thiếu */
  trace_id: z.string().regex(/^[A-Za-z0-9._-]{8,64}$/).optional(),
  /** id từ POST /uploads/presign kind=image (bucket riêng tư) */
  screenshot_upload_id: uuidSchema.optional(),
  app_version: z.string().max(40).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export const feedbackCreatedSchema = z.object({ id: uuidSchema, status: z.literal('new'), trace_id: z.string(), created_at: z.string() });
export const FEEDBACK_STATUSES = ['new', 'triaged', 'done', 'wontfix'] as const;

export const CONTENT_REPORT_REASONS = ['wrong_answer', 'typo', 'unclear', 'audio_issue', 'image_issue', 'translation', 'explanation_wrong', 'other'] as const;
export const CONTENT_REPORT_STATUSES = ['open', 'confirmed', 'rejected', 'fixed'] as const;
/** Vòng sửa nội dung: phản hồi/xử lý báo lỗi câu trong 48 giờ */
export const CONTENT_REPORT_SLA_HOURS = 48;
export const contentReportInputSchema = z.object({
  question_version_id: uuidSchema,
  reason: z.enum(CONTENT_REPORT_REASONS),
  message: z.string().trim().max(2000).optional(),
});
export const contentReportCreatedSchema = z.object({ id: uuidSchema, status: z.enum(CONTENT_REPORT_STATUSES), sla_due_at: z.string(), duplicate: z.boolean(), created_at: z.string() });
export const contentReportStatusInputSchema = z.object({
  status: z.enum(CONTENT_REPORT_STATUSES),
  resolution_note: z.string().max(2000).optional(),
  /** CMS gửi email biên tập viên (vai trò bên API) */
  resolved_by_email: z.email().optional(),
});
export const contentReportItemSchema = z.object({
  id: uuidSchema,
  question_id: uuidSchema.nullable(),
  question_version_id: uuidSchema,
  version_no: z.number().int().nullable(),
  external_ref: z.string().nullable(),
  section_code: z.string().nullable(),
  stem_preview: z.string().nullable(),
  reason: z.string(),
  message: z.string().nullable(),
  status: z.enum(CONTENT_REPORT_STATUSES),
  resolution_note: z.string().nullable(),
  sla_due_at: z.string().nullable(),
  overdue: z.boolean(),
  reports_for_question: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
});
export type ContentReportItem = z.infer<typeof contentReportItemSchema>;

export const SUPPORT_CATEGORIES = ['account', 'billing', 'exam', 'content', 'technical', 'other'] as const;
export const SUPPORT_STATUSES = ['open', 'waiting_user', 'resolved', 'closed'] as const;
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
/** SLA phản hồi đầu tiên của đội hỗ trợ */
export const SUPPORT_FIRST_RESPONSE_SLA_HOURS = 24;
export const supportTicketInputSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(3).max(8000),
  category: z.enum(SUPPORT_CATEGORIES).default('other'),
  trace_id: z.string().regex(/^[A-Za-z0-9._-]{8,64}$/).optional(),
  attempt_id: uuidSchema.optional(),
  page_url: z.string().max(1000).optional(),
});
export type SupportTicketInput = z.infer<typeof supportTicketInputSchema>;
export const supportMessageInputSchema = z.object({ message: z.string().trim().min(1).max(8000) });
export const supportMessageSchema = z.object({ id: uuidSchema, author: z.enum(['user', 'agent', 'system']), body: z.string(), created_at: z.string() });
export const supportTicketSchema = z.object({
  id: uuidSchema,
  subject: z.string(),
  category: z.enum(SUPPORT_CATEGORIES),
  status: z.enum(SUPPORT_STATUSES),
  priority: z.enum(SUPPORT_PRIORITIES),
  first_response_due_at: z.string().nullable(),
  first_responded_at: z.string().nullable(),
  last_message_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(supportMessageSchema).optional(),
});
export type SupportTicket = z.infer<typeof supportTicketSchema>;
export const adminSupportReplySchema = z.object({
  message: z.string().trim().min(1).max(8000),
  channels: z.array(z.enum(['inapp', 'email'])).min(1).default(['inapp', 'email']),
  status: z.enum(SUPPORT_STATUSES).default('waiting_user'),
  /** Cấp credit bù (ledger admin_adjust + audit user.grant_credits) */
  credit: z.object({ delta: z.number().int().min(1).max(100_000), note: z.string().min(3).max(500) }).optional(),
});
export const adminSupportPatchSchema = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  assigned_to: uuidSchema.nullable().optional(),
});

// ----------------------------------------------------------------------------- Admin người dùng
export const adminUserLockInputSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const adminImpersonateInputSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const IMPERSONATION_TTL_SECONDS = 600;
export const adminImpersonationSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  scope: z.literal('read_only'),
  impersonation_id: uuidSchema,
  user_id: uuidSchema,
});

// ----------------------------------------------------------------------------- MFA (TOTP RFC 6238)
export const MFA_TOTP = { digits: 6, period: 30, algorithm: 'SHA1', window: 1, recovery_codes: 10 } as const;
export const mfaStatusSchema = z.object({
  required: z.boolean(),
  enrolled: z.boolean(),
  pending_enrollment: z.boolean(),
  session_verified: z.boolean(),
  recovery_codes_remaining: z.number().int(),
});
export const mfaEnrollResultSchema = z.object({ secret: z.string(), otpauth_url: z.string(), digits: z.number().int(), period: z.number().int(), algorithm: z.literal('SHA1') });
export const mfaCodeInputSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const mfaVerifyInputSchema = z
  .object({ code: z.string().regex(/^\d{6}$/).optional(), recovery_code: z.string().min(8).max(32).optional() })
  .refine((v) => !!v.code !== !!v.recovery_code, { message: 'exactly one of code or recovery_code' });

// ----------------------------------------------------------------------------- Pháp lý (placeholder – cần luật sư duyệt)
export const POLICY_DOCUMENTS = ['terms', 'privacy', 'refund_policy', 'voice_consent'] as const;
export type PolicyDocument = (typeof POLICY_DOCUMENTS)[number];
export const policySchema = z.object({
  type: z.enum(POLICY_DOCUMENTS),
  version: z.string(),
  effective_date: z.string(),
  /** Loại đồng ý ghi iam.consents (voice_consent ↔ voice_processing) – null = không cần đồng ý riêng */
  consent_type: z.string().nullable(),
  requires_consent: z.boolean(),
  status: z.enum(['draft_pending_legal_review', 'approved']),
  title: z.object({ vi: z.string(), en: z.string() }),
  web_path: z.string(),
  note: z.string().nullable(),
});
export const policiesSchema = z.object({ data: z.array(policySchema) });
