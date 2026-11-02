import { z } from 'zod';
import { uuidSchema } from '../common.js';
import { notificationCategoriesSchema, notificationPreferencesSchema } from './learning-tools.js';

/**
 * DTO Growth v1.1 (Sprint 8): referral (mã, link UTM, thống kê, thưởng credit hai chiều, chống lạm dụng) và thông báo đa kênh
 * (mẫu, đọc/đọc tất cả, huỷ đăng ký bằng link ký HMAC). Hợp đồng: docs/spec/allingo-openapi.yaml nhóm Growth.
 */

// ----------------------------------------------------------------------------- Thông báo
/** Mã template NotificationService (web dịch in-app theo `notifications.<template_code>`; email/push dựng ở server) */
export const NOTIFICATION_TEMPLATE_CODES = [
  'billing.order_paid',
  'billing.invoice_issued',
  'billing.subscription_expiring',
  'billing.subscription_expired',
  'billing.trial_started',
  'billing.trial_ending',
  'billing.trial_ended',
  'growth.referral_rewarded',
  'learning.study_reminder',
  'learning.weekly_summary',
  'admin.invoice_failed',
] as const;
export type NotificationTemplateCode = (typeof NOTIFICATION_TEMPLATE_CODES)[number];

/** Sự kiện Socket.IO (namespace /ws, room user:<id>) khi có thông báo in-app mới – v1.1 S8 */
export const NOTIFICATION_REALTIME_EVENT = 'notification.new';

export const notificationReadAllResultSchema = z.object({ updated: z.number().int(), unread_count: z.number().int() });

/** Token huỷ đăng ký (HMAC) trong link email – query `token` */
export const unsubscribeTokenQuerySchema = z.object({ token: z.string().min(20).max(512) });
export const unsubscribeResultSchema = z.object({
  unsubscribed: z.literal(true),
  /** Loại đã tắt email (`all` = mọi email không giao dịch) */
  category: z.enum(['learning', 'billing', 'marketing', 'all']),
  channel: z.literal('email'),
});
/** Trang quản lý thông báo không cần đăng nhập (link trong email) */
export const notificationManageSchema = notificationPreferencesSchema.extend({
  email_masked: z.string().nullable(),
  token_category: z.enum(['learning', 'billing', 'marketing', 'all']),
});
export type NotificationManage = z.infer<typeof notificationManageSchema>;
export const notificationManagePatchSchema = z.object({
  categories: z.object({ learning: z.object({ email: z.boolean(), push: z.boolean(), inapp: z.boolean() }).partial(), billing: z.object({ email: z.boolean(), push: z.boolean(), inapp: z.boolean() }).partial(), marketing: z.object({ email: z.boolean(), push: z.boolean(), inapp: z.boolean() }).partial() }).partial().optional(),
  channels: z.object({ email: z.boolean() }).partial().optional(),
});
export { notificationCategoriesSchema };

// ----------------------------------------------------------------------------- Referral
export const REFERRAL_STATUSES = ['joined', 'started', 'upgraded'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
/** Lý do không thưởng cố định (ghi `iam.referrals.blocked_reason`) */
export const REFERRAL_BLOCK_REASONS = ['self_referral', 'duplicate_device', 'duplicate_ip'] as const;
/** Lý do bỏ qua thưởng một mốc (ghi `iam.referrals.metadata.skipped.<stage>`) – có thể được cấp bù ở mốc sau nếu hết điều kiện */
export const REFERRAL_SKIP_REASONS = ['email_unverified', 'monthly_cap', 'disabled', 'blocked'] as const;
export const REFERRAL_STAGES = ['started', 'upgraded'] as const;
export type ReferralStage = (typeof REFERRAL_STAGES)[number];

export const referralRewardConfigSchema = z.object({ referrer: z.number().int().min(0).max(100_000), referee: z.number().int().min(0).max(100_000) });
/** Cấu hình referral – `billing.feature_flags['ff.growth.referral'].rules.config` (seed); thiếu → REFERRAL_DEFAULTS */
export const referralConfigSchema = z.object({
  rewards: z.object({ started: referralRewardConfigSchema, upgraded: referralRewardConfigSchema }),
  /** Số lần thưởng tối đa cho NGƯỜI GIỚI THIỆU trong một tháng (giờ VN) – vượt → cả hai bên không được thưởng mốc đó */
  monthly_cap: z.number().int().min(0).max(10_000),
  /** Cửa sổ (giờ) phát hiện cùng thiết bị/IP */
  abuse_window_hours: z.number().int().min(1).max(24 * 30),
  require_verified_email: z.boolean(),
});
export type ReferralConfig = z.infer<typeof referralConfigSchema>;
export const REFERRAL_DEFAULTS: ReferralConfig = {
  rewards: { started: { referrer: 200, referee: 200 }, upgraded: { referrer: 500, referee: 500 } },
  monthly_cap: 20,
  abuse_window_hours: 24,
  require_verified_email: true,
};

export const referralItemSchema = z.object({
  id: uuidSchema,
  /** Tên hiển thị đã che (vd "Ng***") */
  display_name: z.string(),
  status: z.enum(REFERRAL_STATUSES),
  joined_at: z.string(),
  started_at: z.string().nullable(),
  upgraded_at: z.string().nullable(),
  rewarded: z.object({ started: z.boolean(), upgraded: z.boolean() }),
  blocked_reason: z.enum(REFERRAL_BLOCK_REASONS).nullable(),
});

export const referralSummarySchema = z.object({
  /** Mã giới thiệu (8 ký tự A-Z2-9) */
  code: z.string(),
  /** Link chia sẻ (trang OG + chuyển hướng) có UTM */
  link: z.string(),
  /** Trang đăng ký của web có `ref` + UTM */
  landing_url: z.string(),
  share: z.object({ facebook: z.string(), zalo: z.string(), messenger: z.string(), text: z.string() }),
  og: z.object({ title: z.string(), description: z.string(), image: z.string() }),
  enabled: z.boolean(),
  joined: z.number().int(),
  started: z.number().int(),
  upgraded: z.number().int(),
  /** Tổng credit đã nhận từ referral (ledger reason `referral`) */
  credits_earned: z.number().int(),
  rewards: z.object({
    /** Số lần đã thưởng cho người giới thiệu trong tháng này / trần tháng */
    this_month: z.number().int(),
    monthly_cap: z.number().int(),
    /** Lần thưởng bị bỏ qua (chưa xác minh email, vượt trần, thiết bị/IP trùng) */
    skipped: z.number().int(),
  }),
  config: referralConfigSchema.pick({ rewards: true, monthly_cap: true }),
  recent: z.array(referralItemSchema),
});
export type ReferralSummary = z.infer<typeof referralSummarySchema>;

/** GET /referrals/{code} (công khai) – dữ liệu trang chia sẻ/OG cho web */
export const referralLandingSchema = z.object({
  code: z.string(),
  valid: z.boolean(),
  /** Tên người giới thiệu đã che */
  referrer_name: z.string().nullable(),
  reward: z.object({ referee_started: z.number().int(), referee_upgraded: z.number().int() }),
  og: z.object({ title: z.string(), description: z.string(), image: z.string(), url: z.string() }),
  register_url: z.string(),
});
export type ReferralLanding = z.infer<typeof referralLandingSchema>;
