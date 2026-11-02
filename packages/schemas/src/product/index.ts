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

/** Điểm XP theo hành động (learn.xp_events.kind) */
export const XP_RULES = {
  attempt_submitted: 20,
  attempt_full_test_submitted: 100,
  question_correct: 2,
  lesson_completed: 30,
  srs_review: 1,
  streak_day: 10,
  diagnostic_completed: 50,
  explain_viewed: 0,
} as const;
export type XpKind = keyof typeof XP_RULES;

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
  CONTENT_PUBLISHED: 'content.published',
  CONTENT_RETIRED: 'content.retired',
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
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/** Ngưỡng cosine embedding coi là trùng câu đã phát hành (S5 – generate_questions dedup) */
export const EMBEDDING_DUPLICATE_THRESHOLD = 0.92;
/** Số chiều embedding (ai.embeddings.embedding vector(1536)) */
export const EMBEDDING_DIMENSIONS = 1536;
/** Tóm tắt tiến bộ sau mỗi N bài đã chấm */
export const SUMMARY_EVERY_N_ATTEMPTS = 3;
export * from './entitlements.js';
