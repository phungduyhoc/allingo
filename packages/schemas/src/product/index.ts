import { XP_TABLE } from './xp.js';
/**
 * Hằng số sản phẩm dùng chung API/web/CMS (không chứa giá – giá nằm trong billing.plans/prices seed).
 */

export const ROLE_CODES = ['learner', 'teacher', 'editor', 'admin', 'superadmin', 'org_admin', 'service'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Mã tính năng dùng cho billing.entitlements.feature_code / billing.quotas.feature_code */
export const FEATURE_CODES = {
  FULL_TEST: 'full_test',
  MINI_TEST: 'mini_test',
  PART_DRILL: 'part_drill',
  AI_EXPLAIN: 'ai_explain',
  AI_TUTOR: 'ai_tutor',
  /** Số lượt người học gửi trong MỘT hội thoại gia sư (S6) – period `lifetime` = cả đời thread, đếm từ learn.chat_messages */
  AI_TUTOR_THREAD_TURNS: 'ai_tutor_thread_turns',
  AI_DIAGNOSE: 'ai_diagnose',
  GRADE_WRITING: 'grade_writing',
  GRADE_SPEAKING: 'grade_speaking',
  DICTIONARY_AI: 'dictionary_ai',
  SHADOWING: 'shadowing',
  STUDY_PLAN: 'study_plan',
  SRS_NEW_CARDS: 'srs_new_cards',
  STREAK_FREEZE: 'streak_freeze',
} as const;
export type FeatureCode = (typeof FEATURE_CODES)[keyof typeof FEATURE_CODES];

/**
 * Quota theo PHẠM VI (không theo người dùng × kỳ): giới hạn đọc từ billing.quotas nhưng đếm ở bảng nghiệp vụ
 * (vd lượt/thread đếm trong learn.chat_messages) – QuotaService không đếm Redis và /me/entitlements không liệt kê.
 */
export const SCOPED_QUOTA_FEATURES: readonly FeatureCode[] = ['ai_tutor_thread_turns'];

/** Tính năng chỉ Pro (không có quota Free) – nguồn sự thật là billing.quotas/entitlements, đây là mặc định seed */
export const PRO_ONLY_FEATURES: readonly FeatureCode[] = ['grade_writing', 'grade_speaking', 'ai_diagnose', 'streak_freeze'];

/**
 * Quota mặc định cho gói Free (seed vào billing.quotas; server đọc DB, không đọc hằng số này lúc runtime).
 * limit = null nghĩa là không giới hạn.
 */
export const DEFAULT_QUOTAS: ReadonlyArray<{ plan_kind: 'free' | 'monthly' | 'yearly' | 'lifetime' | 'combo'; feature: FeatureCode; period: 'day' | 'month' | 'lifetime'; limit: number }> = [
  { plan_kind: 'free', feature: 'full_test', period: 'month', limit: 2 },
  { plan_kind: 'free', feature: 'mini_test', period: 'day', limit: 3 },
  { plan_kind: 'free', feature: 'part_drill', period: 'day', limit: 5 },
  { plan_kind: 'free', feature: 'ai_explain', period: 'day', limit: 10 },
  { plan_kind: 'free', feature: 'ai_tutor', period: 'day', limit: 20 },
  { plan_kind: 'free', feature: 'ai_tutor_thread_turns', period: 'lifetime', limit: 20 },
  { plan_kind: 'free', feature: 'dictionary_ai', period: 'day', limit: 30 },
  { plan_kind: 'free', feature: 'srs_new_cards', period: 'day', limit: 10 },
  { plan_kind: 'monthly', feature: 'ai_explain', period: 'day', limit: 300 },
  { plan_kind: 'monthly', feature: 'ai_tutor_thread_turns', period: 'lifetime', limit: 200 },
  { plan_kind: 'monthly', feature: 'ai_tutor', period: 'day', limit: 200 },
  { plan_kind: 'monthly', feature: 'srs_new_cards', period: 'day', limit: 30 },
  { plan_kind: 'yearly', feature: 'ai_explain', period: 'day', limit: 300 },
  { plan_kind: 'yearly', feature: 'ai_tutor_thread_turns', period: 'lifetime', limit: 200 },
  { plan_kind: 'yearly', feature: 'ai_tutor', period: 'day', limit: 200 },
  { plan_kind: 'yearly', feature: 'srs_new_cards', period: 'day', limit: 30 },
  { plan_kind: 'lifetime', feature: 'ai_explain', period: 'day', limit: 300 },
  { plan_kind: 'lifetime', feature: 'ai_tutor_thread_turns', period: 'lifetime', limit: 200 },
  { plan_kind: 'lifetime', feature: 'ai_tutor', period: 'day', limit: 200 },
  { plan_kind: 'lifetime', feature: 'srs_new_cards', period: 'day', limit: 30 },
  { plan_kind: 'combo', feature: 'ai_explain', period: 'day', limit: 500 },
  { plan_kind: 'combo', feature: 'ai_tutor_thread_turns', period: 'lifetime', limit: 200 },
  { plan_kind: 'combo', feature: 'ai_tutor', period: 'day', limit: 300 },
  { plan_kind: 'combo', feature: 'srs_new_cards', period: 'day', limit: 40 },
];

/**
 * Điểm XP theo hành động (learn.xp_events.kind) – S9: nguồn là `packages/config/xp.ts` (bundle như entitlements.ts);
 * `XP_RULES` giữ tên cũ để tương thích (web mock, test-engine).
 */
export { XP_TABLE, XP_KINDS, attemptXp, levelForXp, type XpKind } from './xp.js';
export const XP_RULES = XP_TABLE;

/** Thời gian ân hạn nộp bài sau khi hết giờ (giây) */
export const ATTEMPT_GRACE_SECONDS = 30;
/** Lưu nháp: kích thước lô tối đa */
export const ATTEMPT_ANSWER_BATCH_MAX = 100;
/** Credit chào mừng cho tài khoản khách (đủ vài lượt giải thích); tài khoản đăng ký nhận credits_included của gói Free */
export const GUEST_WELCOME_CREDITS = 30;
/** Phiên khách hết hạn sau (ngày) */
export const GUEST_SESSION_DAYS = 30;

/** Tên hiển thị chương trình (dự phòng khi DB chưa có) */
export const PROGRAM_META = {
  toeic: { name: { vi: 'TOEIC', en: 'TOEIC' }, scale: { min: 10, max: 990, step: 5 } },
  ielts: { name: { vi: 'IELTS', en: 'IELTS' }, scale: { min: 0, max: 9, step: 0.5 } },
  jlpt: { name: { vi: 'JLPT', en: 'JLPT' }, scale: { min: 0, max: 180, step: 1 } },
  hsk: { name: { vi: 'HSK', en: 'HSK' }, scale: { min: 0, max: 300, step: 1 } },
} as const;

/** Mã tác vụ AI (ai.prompt_templates.code) */
export const AI_TASK_CODES = [
  'explain_mcq',
  'tutor_chat',
  'diagnose_rl',
  'summarize_attempt',
  'grade_writing_ielts',
  'grade_writing_toeic',
  'grade_speaking_ielts',
  'grade_speaking_toeic',
  'upgrade_phrasing',
  'generate_questions',
  'check_question',
  'segment_translate',
  'plan_adjust',
  'guard_classify',
] as const;
export type AiTaskCode = (typeof AI_TASK_CODES)[number];

/** Sự kiện miền (ops.outbox.event_type) – aggregate.past_tense */
export const DOMAIN_EVENTS = {
  USER_REGISTERED: 'user.registered',
  USER_MERGED: 'user.merged',
  USER_DELETED: 'user.deleted',
  ATTEMPT_STARTED: 'attempt.started',
  ATTEMPT_SUBMITTED: 'attempt.submitted',
  ATTEMPT_GRADED: 'attempt.graded',
  AI_TASK_COMPLETED: 'ai_task.completed',
  ORDER_PAID: 'order.paid',
  /** S7: hoàn tiền thủ công (admin) – thu hồi entitlement/credit */
  ORDER_REFUNDED: 'order.refunded',
  /** S7: nhắc hết hạn trước 7/3/1 ngày (growth tạo ops.notifications) */
  SUBSCRIPTION_EXPIRING: 'subscription.expiring',
  /** S7: hết kỳ → hạ Free (growth thông báo) */
  SUBSCRIPTION_EXPIRED: 'subscription.expired',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  /** S8: dùng thử Pro (trial_days) – subscription `trialing` */
  SUBSCRIPTION_TRIAL_STARTED: 'subscription.trial_started',
  /** S8: mã khuyến mãi được dùng (đơn đã thanh toán hoặc đổi mã trial/credit) */
  PROMOTION_REDEEMED: 'promotion.redeemed',
  /** S8: hoá đơn điện tử phát hành / thất bại hết lượt thử (dead-letter) / huỷ khi hoàn tiền */
  INVOICE_ISSUED: 'invoice.issued',
  INVOICE_FAILED: 'invoice.failed',
  INVOICE_CANCELLED: 'invoice.cancelled',
  /** S8: thưởng referral (mỗi mốc started/upgraded) */
  REFERRAL_REWARDED: 'referral.rewarded',
  CONTENT_PUBLISHED: 'content.published',
  CONTENT_RETIRED: 'content.retired',
  /** S9: lộ trình (PlanGenerator) – sinh/sinh lại, đề xuất điều chỉnh sẵn sàng, đã áp dụng; WS `plan.updated` */
  PLAN_GENERATED: 'plan.generated',
  PLAN_ADJUST_PROPOSED: 'plan.adjust_proposed',
  PLAN_ADJUSTED: 'plan.adjusted',
  /** S9: task lộ trình hoàn thành (tự động từ attempt.graded/lesson.completed hoặc người học đánh dấu) */
  PLAN_TASK_COMPLETED: 'plan_task.completed',
  /** S9: huy hiệu mới (rule engine) → growth gửi thông báo in-app */
  BADGE_AWARDED: 'badge.awarded',
  /** S9: bài học hoàn thành (producer ở sprint bài học; learning đã nghe để tự done task lesson/grammar) */
  LESSON_COMPLETED: 'lesson.completed',
  /** S10: sổ lỗi cập nhật sau attempt.graded (số mục mới/gộp) – analytics xoá cache thống kê */
  ERROR_LOG_UPDATED: 'error_log.updated',
  /** S12: beta kín & phản hồi */
  WAITLIST_JOINED: 'waitlist.joined',
  BETA_INVITED: 'beta.invited',
  BETA_REDEEMED: 'beta.redeemed',
  SURVEY_SUBMITTED: 'survey.submitted',
  FEEDBACK_SUBMITTED: 'feedback.submitted',
  CONTENT_REPORT_CREATED: 'content_report.created',
  CONTENT_REPORT_RESOLVED: 'content_report.resolved',
  SUPPORT_TICKET_CREATED: 'support_ticket.created',
  SUPPORT_TICKET_REPLIED: 'support_ticket.replied',
  /** S12: admin khoá/mở tài khoản */
  USER_LOCKED: 'user.locked',
  USER_UNLOCKED: 'user.unlocked',
} as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/** Hàng đợi BullMQ */
export const QUEUES = ['grading', 'content', 'media', 'notify', 'analytics', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

/** Tên job BullMQ (`aggregate.action`) – Sprint 5 */
export const JOB_NAMES = {
  /** Sinh lô câu hỏi AI cho CMS (generate_questions → draft source=ai → check_question → dedup embedding) */
  CONTENT_GENERATE: 'content.generate',
  /** Tóm tắt tiến bộ sau mỗi 3 bài đã chấm (summarize_attempt → learn.notes kind=system_summary) */
  SUMMARY_ATTEMPT: 'summary.attempt',
  /** Chạy eval set cho một phiên bản prompt (POST /admin/eval-runs) */
  EVAL_RUN: 'eval.run',
  /** S7 – billing (hàng đợi maintenance, worker chạy định kỳ; POST /admin/billing/jobs/{job} chạy ngay) */
  ORDER_EXPIRE: 'order.expire',
  PAYMENT_RECONCILE: 'payment.reconcile',
  SUBSCRIPTION_EXPIRE: 'subscription.expire',
  CREDIT_GRANT_MONTHLY: 'credit.grant_monthly',
  CREDIT_EXPIRE: 'credit.expire',
  BILLING_RECONCILE: 'billing.reconcile',
  /** S8 – Free cấp lại credit hằng tháng (idempotent theo (user, kỳ tháng VN)) */
  CREDIT_GRANT_FREE_MONTHLY: 'credit.grant_free_monthly',
  /** S8 – hoá đơn điện tử: phát hành sau order.paid, huỷ khi hoàn tiền, quét thử lại theo backoff */
  INVOICE_ISSUE: 'invoice.issue',
  INVOICE_CANCEL: 'invoice.cancel',
  INVOICE_RETRY: 'invoice.retry',
  /** S8 – gửi thông báo đã hẹn giờ (giờ yên lặng) */
  NOTIFICATION_DISPATCH: 'notification.dispatch',
  /** S9 – sinh lại lộ trình (POST /me/plan/regenerate → 202) */
  PLAN_GENERATE: 'plan.generate',
  /** S9 – plan_adjust (AI) sau check-in / câu lệnh tự nhiên → đề xuất có kiểm tra ràng buộc */
  PLAN_ADJUST: 'plan.adjust',
  /** S9 – task pending quá hạn 3 ngày (giờ người học) → expired; đề xuất hết hạn → expired */
  PLAN_EXPIRE_TASKS: 'plan.expire_tasks',
  /** S9 – nhắc học theo giờ ưa thích + nhắc chuỗi sắp mất 20:00 (giờ người học) */
  STUDY_REMINDER: 'notify.study_reminder',
  /** S10 – tối ưu trọng số FSRS-5 theo người dùng (≥ 1.000 review, hằng tuần) */
  SRS_OPTIMIZE: 'srs.optimize',
  /** S10 – email/in-app tóm tắt tuần sáng thứ Hai (giờ VN) */
  WEEKLY_SUMMARY: 'notify.weekly_summary',
  /** S12 – thống kê câu từ attempt_answers (p-value, point-biserial, thời gian TB, báo lỗi) – 02:30 giờ VN */
  CONTENT_STATS_NIGHTLY: 'content.stats_nightly',
  /** S12 – dọn dữ liệu theo chính sách lưu giữ (ghi âm hết hạn + S3, ai_tasks, outbox/thông báo/audit cũ) – 03:30 giờ VN */
  RETENTION_CLEANUP: 'ops.retention_cleanup',
  /** S12 – gửi email mời beta theo đợt (≤ daily_invite_limit/ngày giờ VN) + hết hạn mã */
  BETA_INVITES_SEND: 'beta.invites_send',
  /** S12 – cảnh báo SLA (báo lỗi câu 48 giờ, ticket phản hồi đầu 24 giờ) */
  SLA_CHECK: 'ops.sla_check',
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/** Ngưỡng cosine embedding coi là trùng câu đã phát hành (S5 – generate_questions dedup) */
export const EMBEDDING_DUPLICATE_THRESHOLD = 0.92;
/** Số chiều embedding (ai.embeddings.embedding vector(1536)) */
export const EMBEDDING_DIMENSIONS = 1536;
/** Tóm tắt tiến bộ sau mỗi N bài đã chấm */
export const SUMMARY_EVERY_N_ATTEMPTS = 3;
export * from './entitlements.js';
