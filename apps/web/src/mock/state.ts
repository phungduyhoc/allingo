import type { AnswerInput, AttemptAiDiagnosis, AttemptMode, AttemptResult, Enrollment, Explanation, Note, NotificationPreferences, PlanAdjustProposal, PlanSettings, PlanTask, ReconciliationRun, RefusalCode, TutorCitation, User } from '@allingo/schemas';
import type { DiagnosticState } from '@allingo/scoring';
import type { MockPromotion } from './billing-fixtures';

/** Trạng thái "máy chủ" giả lập, lưu localStorage để tải lại trang vẫn giữ phiên/nháp */

export interface MockUserRecord extends User {
  password?: string;
  guest_token?: string;
  /** Gói (mock): 'free' mặc định; tài khoản demo learner_pro@allingo.dev là 'monthly' (Pro) */
  plan?: 'free' | 'monthly';
  /** S7: loại gói hiện hành như `GET /me/entitlements.plan_kind` (monthly | yearly | lifetime | combo; dùng thử = monthly) */
  plan_kind?: string;
  /** S8: mã giới thiệu (cấp lười) */
  referral_code?: string;
}

/** S7/S8 – billing giả lập (bám billing.orders/payments/subscriptions/credit_ledger/invoices/promotion_redemptions) */
export interface MockOrderRecord {
  id: string;
  user_id: string;
  plan_id: string;
  price_id: string;
  subtotal: number;
  discount: number;
  total: number;
  promotion_code: string | null;
  promotion_id: string | null;
  bonus_credits: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded' | 'expired';
  buyer_info: { type: 'personal' | 'business'; name: string | null; email: string | null; tax_code: string | null; company: string | null; address: string | null } | null;
  idempotency_key: string;
  body_hash: string;
  created_at: string;
  paid_at: string | null;
  expires_at: string;
  invoice: {
    status: string;
    series: string | null;
    invoice_no: string | null;
    lookup_code: string | null;
    issued_at: string | null;
    cancelled_at: string | null;
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export interface MockPaymentRecord {
  id: string;
  order_id: string;
  user_id: string;
  provider: string;
  ref: string;
  amount: number;
  status: 'initiated' | 'success' | 'failed' | 'refunded';
  provider_txn_id: string | null;
  /** "Thành công nhưng mất webhook": cổng đã trừ tiền, chờ payment.reconcile */
  simulated: 'paid' | null;
  return_url: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface MockSubscriptionRecord {
  id: string;
  user_id: string;
  plan_id: string;
  program: string | null;
  status: 'trialing' | 'active' | 'cancelled' | 'expired' | 'lifetime';
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  source_order_id: string | null;
  created_at: string;
}

export interface MockLedgerRecord {
  id: number;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  ref: { type: string; id: string | null } | null;
  expires_at: string | null;
  note: string | null;
  created_at: string;
}

export interface MockNotificationRecord {
  id: string;
  user_id: string;
  template_code: string;
  category: string;
  payload: Record<string, unknown>;
  url: string | null;
  created_at: string;
  read_at: string | null;
}

export interface MockReferralRecord {
  id: string;
  referrer_id: string;
  referee_id: string;
  code: string;
  status: 'joined' | 'started' | 'upgraded';
  joined_at: string;
  started_at: string | null;
  upgraded_at: string | null;
  rewarded: { started: boolean; upgraded: boolean };
  blocked_reason: 'self_referral' | 'duplicate_device' | 'duplicate_ip' | null;
  device_fp: string | null;
}

export interface MockAnswerRecord {
  answer: AnswerInput;
  time_spent_ms?: number;
  flagged?: boolean;
}

export interface MockAttemptRecord {
  id: string;
  user_id: string;
  test_set_id: string;
  program: string;
  mode: AttemptMode;
  status: 'in_progress' | 'submitted' | 'graded';
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  answers: Record<string, MockAnswerRecord>;
  section_elapsed_sec: Record<string, number>;
  ui_state: Record<string, unknown>;
  events: { type: string; at: string; meta?: Record<string, unknown> }[];
  result: AttemptResult | null;
  /** Lượt luyện (GET /practice/questions): tập câu chọn từ nhiều đề, thay cho toàn bộ câu của test_set_id */
  question_ids?: string[];
  /** Số lần audio_started theo question_id (Sprint 4) */
  audio_plays?: Record<string, number>;
  /** Chẩn đoán AI đã lưu (S5 – như score_breakdown.ai_diagnosis của API) */
  ai_diagnosis?: Omit<AttemptAiDiagnosis, 'cached' | 'attempt_id'>;
  /** S9: task lộ trình mở lượt này (tự done khi chấm) */
  plan_task_id?: string | null;
  /** S9: Idempotency-Key của POST /attempts (lượt luyện theo section) */
  idempotency_key?: string | null;
  /** S9: trạng thái bài chẩn đoán thích ứng (draft_state.adaptive) */
  adaptive?: DiagnosticState;
}

/** S9 – lộ trình giả lập (learn.study_plans/plan_weeks/plan_tasks) */
export interface MockPlanTaskRecord {
  id: string;
  week_id: string;
  due_date: string;
  task_type: PlanTask['task_type'];
  title: { vi: string; en: string };
  ref_type: 'section' | 'test_set' | 'lesson' | 'vocab_list' | null;
  ref_id: string | null;
  est_minutes: number;
  status: PlanTask['status'];
  evidence_code: string | null;
  evidence_params: Record<string, string | number>;
  result_ref: Record<string, unknown> | null;
  completed_at: string | null;
}

export interface MockPlanWeekRecord {
  id: string;
  week_no: number;
  start_date: string;
  end_date: string;
  phase: 'foundation' | 'practice' | 'simulation';
  focus: string | null;
  focus_skill: string | null;
  budget_minutes: number;
  study_dates: string[];
  checkin_done_at: string | null;
  adjustment: Record<string, unknown> | null;
}

export interface MockPlanRecord {
  id: string;
  user_id: string;
  program: string;
  version_no: number;
  generated_at: string;
  settings: PlanSettings;
  baseline: { score: number | null; low: number | null; high: number | null; source: string } | null;
  target_suggestion: { suggested: number; feasible: boolean | null } | null;
  full_test_every_weeks: number;
  minutes_per_skill: Record<string, number>;
  weeks: MockPlanWeekRecord[];
  tasks: MockPlanTaskRecord[];
}

/** S9 – learn.plan_adjustments giả lập */
export interface MockProposalRecord extends Omit<PlanAdjustProposal, 'proposal_id'> {
  id: string;
  user_id: string;
  plan_id: string;
  /** Thay đổi áp vào task khi apply */
  patch: { task_id: string; status?: PlanTask['status']; due_date?: string; est_minutes?: number }[];
  /** pending → trạng thái cuối lúc (ms) – mô phỏng job plan.adjust */
  resolve_at: number | null;
  resolve_to: PlanAdjustProposal['status'] | null;
}

export interface MockStreakRecord {
  current: number;
  longest: number;
  last_active_date: string | null;
  freeze_available_at: string | null;
  freezes_used: number;
}

export interface MockState {
  users: Record<string, MockUserRecord>;
  sessionUserId: string | null;
  attempts: Record<string, MockAttemptRecord>;
  enrollments: Record<string, Enrollment[]>;
  explanations: Record<string, Explanation>;
  /** usage[userId][feature][kỳ theo giờ VN: YYYY-MM-DD | YYYY-MM | all] = count */
  usage: Record<string, Record<string, Record<string, number>>>;
  xp: Record<string, number>;
  /** ai_tasks giả lập: chủ tác vụ (POST /ai/feedback chỉ cho chủ) */
  aiTasks: Record<string, { user_id: string; task: string }>;
  /** ai.feedback giả lập theo ai_task_id */
  feedback: Record<string, { id: string; user_id: string; rating: string; comment: string | null }>;
  /** Số dư credit AI theo user */
  credits: Record<string, number>;
  /** S6: hội thoại gia sư (learn.chat_threads/chat_messages) */
  threads: Record<string, MockThreadRecord>;
  /** S6: ghi chú (learn.notes) */
  notes: Record<string, Note & { user_id: string }>;
  /** S6: thẻ SRS vocab – khoá `${user_id}|${ref}` */
  srsCards: Record<string, { id: string; user_id: string; ref_id: string; headword: string; created_at: string; context: string | null }>;
  /** S6: ai.translation_cache giả lập – khoá term|context|locale */
  translations: Record<string, string>;
  /** S6: ai.tts_cache giả lập – khoá voice|text */
  tts: Record<string, string>;
  /** S6: ops.notification_preferences */
  prefs: Record<string, NotificationPreferences>;
  /** S6: ops.push_subscriptions */
  pushSubs: Record<string, { id: string; user_id: string; endpoint: string; keys: { p256dh: string; auth: string }; user_agent: string | null; locale: string | null; created_at: string }>;
  /** S7/S8: billing */
  orders: Record<string, MockOrderRecord>;
  payments: Record<string, MockPaymentRecord>;
  subscriptions: Record<string, MockSubscriptionRecord>;
  ledger: MockLedgerRecord[];
  /** Lượt khuyến mãi: reserved (đơn chờ) → redeemed | released */
  redemptions: Record<string, { id: string; promotion_id: string; user_id: string; order_id: string | null; status: 'reserved' | 'redeemed' | 'released'; discount: number; credits: number; created_at: string }>;
  /** Khuyến mãi do admin tạo/sửa (đè seed theo id) */
  promotions: Record<string, MockPromotion>;
  invoiceSeq: number;
  deadLetters: Record<string, { id: string; queue: string; job: string; business_id: string; payload: Record<string, unknown>; error: string | null; attempts: number | null; failed_at: string; resolved_at: string | null; retried_at: string | null; retried_by: string | null }>;
  reconciliations: Record<string, ReconciliationRun>;
  flags: Record<string, { enabled: boolean }>;
  /** S8: thông báo in-app + referral */
  notifications: Record<string, MockNotificationRecord>;
  referrals: Record<string, MockReferralRecord>;
  /** S9: lộ trình hiện hành theo user, đề xuất điều chỉnh, chuỗi ngày, nhật ký XP, huy hiệu đã đạt, mastery chẩn đoán */
  plans: Record<string, MockPlanRecord>;
  proposals: Record<string, MockProposalRecord>;
  streaks: Record<string, MockStreakRecord>;
  xpLog: Record<string, { kind: string; xp: number; at: string; ref: string | null }[]>;
  badges: Record<string, Record<string, string>>;
  mastery: Record<string, { subskill: string; skill: string; sections?: string[]; mastery: number; confidence: number; n_obs: number }[]>;
}

export interface MockMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ai_task_id: string | null;
  created_at: string;
  refused?: boolean;
  refusal_code?: RefusalCode | null;
  suggested_followups?: string[];
  citations?: TutorCitation[];
}

export interface MockThreadRecord {
  id: string;
  user_id: string;
  program: string;
  title: string | null;
  context: { kind: 'attempt' | 'question' | 'free'; attempt_id?: string; question_version_id?: string; mode: 'text' };
  created_at: string;
  updated_at: string;
  /** Lượt người học đã gửi (không tính tin bị từ chối) */
  turns_used: number;
  messages: MockMessageRecord[];
}

const KEY = 'allingo.mock.v1';

export function emptyState(): MockState {
  return {
    users: {},
    sessionUserId: null,
    attempts: {},
    enrollments: {},
    explanations: {},
    usage: {},
    xp: {},
    aiTasks: {},
    feedback: {},
    credits: {},
    threads: {},
    notes: {},
    srsCards: {},
    translations: {},
    tts: {},
    prefs: {},
    pushSubs: {},
    orders: {},
    payments: {},
    subscriptions: {},
    ledger: [],
    redemptions: {},
    promotions: {},
    invoiceSeq: 0,
    deadLetters: {},
    reconciliations: {},
    flags: {},
    notifications: {},
    referrals: {},
    plans: {},
    proposals: {},
    streaks: {},
    xpLog: {},
    badges: {},
    mastery: {},
  };
}

export function loadState(): MockState {
  try {
    if (typeof window === 'undefined') return emptyState();
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<MockState>) };
  } catch {
    return emptyState();
  }
}

export function saveState(state: MockState): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* bỏ qua khi localStorage không khả dụng */
  }
}

export function resetState(): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
