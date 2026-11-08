import { z } from 'zod';
import { pageSchema, uuidSchema } from '../common.js';
import { attemptSummarySchema } from './attempt.js';
import { orderSchema, subscriptionSchema } from './billing.js';
import { adminBetaInviteSchema, FEEDBACK_STATUSES, supportTicketSchema } from './s12.js';

/**
 * B7/S145 – Zod phản hồi của các endpoint admin Sprint 12 (thay `z.record(...)` "anyObj" ở controller; khớp `required` trong
 * docs/spec/allingo-openapi.yaml). Tách khỏi s12.ts để trang người học (beta, góp ý, hỗ trợ) không nạp schema admin
 * (S141 – web chỉ nạp schema cần dùng). Không chứa PII: email/SĐT luôn ở dạng đã che (`*_masked`).
 */

const counts = z.record(z.string(), z.number().int());
const record = z.record(z.string(), z.unknown());

// ----------------------------------------------------------------------------- Beta
export const WAITLIST_STATUSES = ['waiting', 'invited', 'joined', 'removed'] as const;
export const adminWaitlistEntrySchema = z.object({
  id: uuidSchema,
  email_masked: z.string(),
  program: z.string(),
  locale: z.string(),
  consent_marketing: z.boolean(),
  source: z.string().nullable(),
  status: z.enum(WAITLIST_STATUSES),
  created_at: z.string(),
});
export type AdminWaitlistEntry = z.infer<typeof adminWaitlistEntrySchema>;
export const adminWaitlistPageSchema = pageSchema(adminWaitlistEntrySchema).extend({ counts });
export type AdminBetaInvite = z.infer<typeof adminBetaInviteSchema>;
export const adminBetaInvitesPageSchema = pageSchema(adminBetaInviteSchema).extend({
  today: z.object({ sent: z.number().int(), limit: z.number().int(), remaining: z.number().int() }),
  counts,
});
export const adminBetaInviteCreateResultSchema = z.object({ queued: z.number().int(), skipped: z.number().int(), batch: z.string() });
export const betaReportSchema = z.object({ week: z.string(), kpis: record, posthog: record.nullable(), markdown: z.string() });
export type BetaReport = z.infer<typeof betaReportSchema>;

// ----------------------------------------------------------------------------- Góp ý, hỗ trợ
export const adminFeedbackItemSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema.nullable(),
  category: z.string(),
  message: z.string(),
  page_url: z.string().nullable(),
  trace_id: z.string().nullable(),
  screenshot: z.object({ media_asset_id: uuidSchema, url: z.string().nullable(), url_expires_at: z.string().nullable() }).nullable(),
  context: record,
  status: z.enum(FEEDBACK_STATUSES),
  created_at: z.string(),
});
export type AdminFeedbackItem = z.infer<typeof adminFeedbackItemSchema>;
export const adminFeedbackPageSchema = pageSchema(adminFeedbackItemSchema);

export const adminSupportTicketSchema = supportTicketSchema.extend({
  user: z.object({ id: uuidSchema, display_name: z.string(), email_masked: z.string().nullable(), status: z.string() }).nullable(),
  assigned_to: uuidSchema.nullable(),
  overdue: z.boolean(),
  context: record,
  closed_at: z.string().nullable(),
});
export type AdminSupportTicket = z.infer<typeof adminSupportTicketSchema>;
export const adminSupportTicketsPageSchema = pageSchema(adminSupportTicketSchema).extend({ counts });
export const deliveryResultSchema = z.object({
  channel: z.enum(['email', 'push', 'zalo', 'sms', 'inapp']),
  status: z.enum(['sent', 'scheduled', 'skipped', 'failed', 'duplicate']),
  reason: z.string().optional(),
  notification_id: z.string().optional(),
});
export const adminSupportReplyResultSchema = adminSupportTicketSchema.extend({
  delivery: z.array(deliveryResultSchema),
  credit: z.object({ delta: z.number().int(), balance: z.number().int(), ledger_id: z.number().int() }).nullable(),
});
export type AdminSupportReplyResult = z.infer<typeof adminSupportReplyResultSchema>;

// ----------------------------------------------------------------------------- Người dùng
export const ADMIN_USER_STATUSES = ['active', 'suspended', 'pending_deletion', 'deleted'] as const;
export const adminUserSummarySchema = z.object({
  id: uuidSchema,
  display_name: z.string(),
  email_masked: z.string().nullable(),
  status: z.enum(ADMIN_USER_STATUSES),
  is_guest: z.boolean(),
  roles: z.array(z.string()),
  created_at: z.string(),
});
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;
export const adminUsersPageSchema = pageSchema(adminUserSummarySchema);
export const adminUserDetailSchema = adminUserSummarySchema.extend({
  phone_masked: z.string().nullable(),
  ui_locale: z.string(),
  timezone: z.string(),
  providers: z.array(z.string()),
  active_sessions: z.number().int(),
  last_seen_at: z.string().nullable(),
  mfa_enrolled: z.boolean(),
  deletion: z.object({ request_id: uuidSchema, requested_at: z.string(), due_at: z.string(), completed_at: z.string().nullable() }).nullable(),
  beta: z.object({ tester: z.boolean(), redeemed_at: z.string().nullable(), invite_status: z.string().nullable() }),
  credits: z.object({ balance: z.number().int() }),
  subscriptions: z.array(subscriptionSchema),
  attempts: z.array(attemptSummarySchema),
  orders: z.array(orderSchema),
  tickets: z.array(supportTicketSchema),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export const adminUserLockResultSchema = z.object({ user_id: uuidSchema, status: z.literal('suspended'), sessions_revoked: z.number().int() });
export const adminUserUnlockResultSchema = z.object({ user_id: uuidSchema, status: z.literal('active') });
export const adminUserDeletionResultSchema = z.object({ status: z.literal('scheduled'), due_at: z.string(), request_id: uuidSchema });

// ----------------------------------------------------------------------------- Nội dung, AI
export const QUESTION_RECOMMENDATIONS = ['retire', 'review', 'ok', 'insufficient_data'] as const;
export const questionStatsItemSchema = z.object({
  question_id: uuidSchema,
  external_ref: z.string().nullable(),
  program: z.string(),
  section_code: z.string().nullable(),
  status: z.string(),
  n: z.number().int(),
  p_value: z.number().nullable(),
  discrimination: z.number().nullable(),
  avg_time_ms: z.number().int().nullable(),
  reports_open: z.number().int(),
  reports_total: z.number().int(),
  recommendation: z.enum(QUESTION_RECOMMENDATIONS),
  reasons: z.array(z.string()),
  computed_at: z.string().nullable(),
});
export type QuestionStatsItem = z.infer<typeof questionStatsItemSchema>;
export const questionStatsPageSchema = pageSchema(questionStatsItemSchema).extend({ computed_at: z.string().nullable() });
/** Chạy job ngay (recompute thống kê…): `result` null khi chạy ở worker hoặc chưa xong trong thời gian chờ */
export const adminJobRunResultSchema = z.object({ job_id: z.string(), mode: z.enum(['queued', 'inline']), result: record.nullable() });
export const aiQualityRowSchema = z.object({
  task_code: z.string(),
  prompt_version_id: uuidSchema.nullable(),
  prompt_version_no: z.number().int().nullable(),
  prompt_status: z.string().nullable(),
  tasks: z.number().int(),
  succeeded: z.number().int(),
  refused: z.number().int(),
  failed: z.number().int(),
  thumbs_up: z.number().int(),
  thumbs_down: z.number().int(),
  thumbs_up_ratio: z.number().nullable(),
  cost_usd: z.number(),
});
export type AiQualityRow = z.infer<typeof aiQualityRowSchema>;
export const aiQualityReportSchema = z.object({ from: z.string(), to: z.string(), data: z.array(aiQualityRowSchema) });
export const aiRefusalSchema = z.object({ id: uuidSchema, task_code: z.string().nullable(), reason: z.string(), error_code: z.string().nullable(), input_ref: record.nullable(), created_at: z.string() });
export type AiRefusal = z.infer<typeof aiRefusalSchema>;
export const aiRefusalsPageSchema = pageSchema(aiRefusalSchema).extend({ by_reason: counts });

// ----------------------------------------------------------------------------- Hệ thống, dead-letter, audit
export const featureFlagSchema = z.object({ key: z.string(), enabled: z.boolean(), rules: record, updated_at: z.string(), public: z.boolean() });
export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export const adminSystemStatusSchema = z.object({
  redis_healthy: z.boolean(),
  queues: z.array(z.object({ queue: z.string(), waiting: z.number().int(), active: z.number().int(), delayed: z.number().int(), failed: z.number().int(), prioritized: z.number().int(), oldest_waiting_sec: z.number() })),
  dead_letters: z.object({ total: z.number().int(), last_24h: z.number().int(), unreplayed: z.number().int(), by_queue: counts }),
  partitions: z.array(z.object({ table: z.string(), months_ahead: z.number().int(), missing: z.array(z.string()) })),
  flags: z.array(featureFlagSchema),
  sla: z.object({ content_reports_overdue: z.number().int(), support_tickets_overdue: z.number().int() }),
  /** B7/S26: chờ giao (không tính dead-letter), đang thử lại, dead-letter */
  outbox: z.object({ unpublished: z.number().int(), retrying: z.number().int(), dead_lettered: z.number().int(), oldest_unpublished_sec: z.number().nullable() }),
});
export type AdminSystemStatus = z.infer<typeof adminSystemStatusSchema>;
export const deadLetterItemSchema = z.object({
  id: uuidSchema,
  queue: z.string(),
  job: z.string().nullable(),
  job_id: z.string(),
  error: z.string().nullable(),
  attempts: z.number().int().nullable(),
  failed_at: z.string(),
  replayed_at: z.string().nullable(),
  replay_count: z.number().int(),
});
export type DeadLetterItem = z.infer<typeof deadLetterItemSchema>;
export const deadLettersPageSchema = pageSchema(deadLetterItemSchema);
export const deadLetterReplayResultSchema = deadLetterItemSchema.extend({ mode: z.enum(['queued', 'inline']), result: record.nullable(), error: z.string().nullable() });
export type DeadLetterReplayResult = z.infer<typeof deadLetterReplayResultSchema>;
export const auditLogItemSchema = z.object({
  id: z.number().int(),
  actor_user_id: uuidSchema.nullable(),
  actor_role: z.string().nullable(),
  action: z.string(),
  entity_type: z.string().nullable(),
  entity_id: uuidSchema.nullable(),
  before: record.nullable(),
  after: record.nullable(),
  created_at: z.string(),
});
export type AuditLogItem = z.infer<typeof auditLogItemSchema>;
export const auditLogsPageSchema = pageSchema(auditLogItemSchema);
