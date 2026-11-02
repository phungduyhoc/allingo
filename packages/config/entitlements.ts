/**
 * Bảng ánh xạ TÍNH NĂNG → entitlement / quota / credit (Sprint 7, CLAUDE.md §5.7) – nguồn duy nhất dùng chung API và web.
 *
 * - API: `FeatureGateService` (apps/api/src/modules/billing) đọc bảng này cho MỌI endpoint tiêu quota/credit; không còn
 *   hard-code feature_code rải rác trong module nghiệp vụ.
 * - Web: đọc cùng bảng (qua `@allingo/schemas`, gói này được bundle vào đó) + `GET /me/entitlements` để hiển thị khoá/mở,
 *   nhưng SERVER quyết định.
 * - Bảng này KHÔNG chứa số lượng (giới hạn nằm ở `billing.quotas`, giá ở `billing.prices`, credit/tác vụ ở
 *   `ai.model_routes.credits_cost`) – chỉ nói "tính năng X cần quyền gì, tiêu quota nào, tính credit theo tác vụ AI nào".
 *
 * Tệp thuần TypeScript, không import gói khác (được `@allingo/schemas` bundle → không kéo dependency ESLint của
 * `@allingo/config` vào image production). Mã feature phải trùng `FEATURE_CODES` của `@allingo/schemas/product`
 * (test `packages/schemas/test/entitlements.test.ts` kiểm tra).
 */

/** feature_code dùng trong billing.entitlements / billing.quotas / billing.plans.features */
export type GateFeatureCode =
  | 'full_test'
  | 'mini_test'
  | 'part_drill'
  | 'ai_explain'
  | 'ai_tutor'
  | 'ai_tutor_thread_turns'
  | 'ai_diagnose'
  | 'grade_writing'
  | 'grade_speaking'
  | 'dictionary_ai'
  | 'shadowing'
  | 'study_plan'
  | 'srs_new_cards'
  | 'streak_freeze';

/** Mã tác vụ AI tính credit (ai.prompt_templates.code / ai.model_routes.task_code) */
export type GateCreditTask =
  | 'explain_mcq'
  | 'tutor_chat'
  | 'diagnose_rl'
  | 'segment_translate'
  | 'grade_writing_ielts'
  | 'grade_writing_toeic'
  | 'grade_speaking_ielts'
  | 'grade_speaking_toeic';

export interface FeatureGate {
  /** Quyền phải có (Free lấy từ `plans.features` của gói `free`, Pro từ `billing.v_active_entitlements`); null = ai cũng dùng được */
  readonly entitlement: GateFeatureCode | null;
  /** Quota tiêu mỗi lần dùng (`billing.quotas` theo plan_kind; không có dòng = không giới hạn); null = không tiêu quota */
  readonly quota: GateFeatureCode | null;
  /** Quota theo phạm vi tài nguyên (đếm ở bảng nghiệp vụ, không ở Redis) – vd lượt/thread gia sư (A72) */
  readonly scopedQuota?: GateFeatureCode;
  /** Tác vụ AI tính credit (AiGateway trừ trong cùng transaction với ai_tasks) */
  readonly creditTask?: GateCreditTask;
  /** Nội dung đánh dấu miễn phí (`catalog.test_sets.is_free`) bỏ qua kiểm tra quyền – VẪN tiêu quota */
  readonly freeContentBypassesEntitlement?: boolean;
  /** Endpoint áp dụng (tài liệu – test ma trận kiểm tra mọi gate đều có ít nhất một endpoint) */
  readonly endpoints: readonly string[];
  /** Mô tả ngắn (tiếng Việt, tài liệu kỹ thuật – không hiển thị cho người dùng cuối) */
  readonly note: string;
}

export const FEATURE_GATES = {
  full_test: {
    entitlement: 'full_test',
    quota: 'full_test',
    freeContentBypassesEntitlement: true,
    endpoints: ['POST /attempts (test_sets.kind = full)', 'GET /programs/{program}/test-sets (locked)'],
    note: 'Đề thi thử đầy đủ – Free 2 đề/tháng (seed), Pro không giới hạn',
  },
  mini_test: {
    entitlement: 'mini_test',
    quota: 'mini_test',
    freeContentBypassesEntitlement: true,
    endpoints: ['POST /attempts (test_sets.kind = mini | diagnostic | topic_pack)', 'GET /programs/{program}/test-sets (locked)'],
    note: 'Đề mini / chẩn đoán – Free 3/ngày',
  },
  part_drill: {
    entitlement: 'part_drill',
    quota: 'part_drill',
    freeContentBypassesEntitlement: true,
    endpoints: ['POST /attempts (section_id | test_sets.kind = part_drill)', 'GET /practice/questions'],
    note: 'Luyện theo Part / drill – Free 5/ngày',
  },
  ai_explain: {
    entitlement: 'ai_explain',
    quota: 'ai_explain',
    creditTask: 'explain_mcq',
    endpoints: ['POST /ai/explain'],
    note: 'Giải thích AI từng câu – quota ngày + credit (cache hit không tính)',
  },
  ai_tutor: {
    entitlement: 'ai_tutor',
    quota: 'ai_tutor',
    scopedQuota: 'ai_tutor_thread_turns',
    creditTask: 'tutor_chat',
    endpoints: ['POST /ai/threads/{threadId}/messages'],
    note: 'Gia sư AI – quota ngày + lượt/thread + credit',
  },
  ai_diagnose: {
    entitlement: 'ai_diagnose',
    quota: 'ai_diagnose',
    creditTask: 'diagnose_rl',
    endpoints: ['POST /attempts/{attemptId}/diagnosis'],
    note: 'Chẩn đoán AI sau bài – chỉ Pro',
  },
  dictionary_ai: {
    entitlement: 'dictionary_ai',
    quota: 'dictionary_ai',
    creditTask: 'segment_translate',
    endpoints: ['GET /dictionary/lookup (ai=auto|always, cần dịch AI)'],
    note: 'Dịch AI khi từ điển không có – Free 30/ngày',
  },
  srs_new_cards: {
    entitlement: null,
    quota: 'srs_new_cards',
    endpoints: ['POST /me/srs/cards'],
    note: 'Thẻ SRS mới – Free 10/ngày, Pro 30/ngày (không cần quyền riêng)',
  },
  grade_writing: {
    entitlement: 'grade_writing',
    quota: 'grade_writing',
    creditTask: 'grade_writing_ielts',
    endpoints: ['POST /submissions (writing) – S9'],
    note: 'Chấm Writing AI – chỉ Pro (endpoint làm ở sprint chấm bài)',
  },
  grade_speaking: {
    entitlement: 'grade_speaking',
    quota: 'grade_speaking',
    creditTask: 'grade_speaking_ielts',
    endpoints: ['POST /submissions (speaking) – S9'],
    note: 'Chấm Speaking AI – chỉ Pro (endpoint làm ở sprint chấm bài)',
  },
  shadowing: {
    entitlement: 'shadowing',
    quota: 'shadowing',
    endpoints: ['POST /shadowing/score – S9'],
    note: 'Shadowing & chấm phát âm – chỉ Pro',
  },
  study_plan: {
    entitlement: 'study_plan',
    quota: null,
    endpoints: ['GET /me/plan – S9'],
    note: 'Lộ trình thích ứng',
  },
  notes: {
    entitlement: null,
    quota: null,
    endpoints: ['POST /notes', 'PUT /notes', 'PATCH /notes/{noteId}'],
    note: 'Ghi chú – không chặn theo gói (A86, SPEC-ISSUES S60)',
  },
} as const satisfies Record<string, FeatureGate>;

export type GateKey = keyof typeof FEATURE_GATES;
export const GATE_KEYS = Object.keys(FEATURE_GATES) as GateKey[];

/** Gate theo loại đề (`catalog.test_sets.kind`) – dùng chung POST /attempts và cờ `locked` của danh sách đề */
export function gateForTestSetKind(kind: string): 'full_test' | 'mini_test' | 'part_drill' {
  if (kind === 'full') return 'full_test';
  if (kind === 'part_drill') return 'part_drill';
  return 'mini_test';
}

/** Kết quả đánh giá gate (thuần – test ma trận plan × feature) */
export type GateDecision =
  | { allowed: true; reason: 'ok' }
  | { allowed: false; reason: 'upgrade_required'; status: 403; code: 'forbidden' }
  | { allowed: false; reason: 'quota_exceeded'; status: 429; code: 'quota_exceeded' };

/**
 * Quyết định cho phép/không (không có tác dụng phụ):
 *  1) cần entitlement mà không có (trừ nội dung miễn phí khi gate cho phép) → 403 `forbidden` `{feature, upgrade: true}`
 *  2) quota có giới hạn và `used + amount > limit` → 429 `quota_exceeded` `{quota: QuotaExceededDetails}`
 * Thiếu credit (402 `insufficient_credits`) do AiGateway quyết định khi trừ credit.
 */
export function evaluateGate(
  gate: FeatureGate,
  input: { features: ReadonlySet<string>; quota?: { limit: number | null; used: number } | null; amount?: number; contentIsFree?: boolean },
): GateDecision {
  const bypass = !!input.contentIsFree && !!gate.freeContentBypassesEntitlement;
  if (gate.entitlement && !bypass && !input.features.has(gate.entitlement)) return { allowed: false, reason: 'upgrade_required', status: 403, code: 'forbidden' };
  const q = input.quota;
  if (gate.quota && q && q.limit !== null && q.used + (input.amount ?? 1) > q.limit) return { allowed: false, reason: 'quota_exceeded', status: 429, code: 'quota_exceeded' };
  return { allowed: true, reason: 'ok' };
}

/**
 * Hợp đồng lỗi gating cho client (envelope `{ error: { code, message, details } }`):
 *  - 403 `forbidden` + `details = { feature, program, gate, upgrade: true }` → hiện CTA nâng cấp
 *  - 429 `quota_exceeded` + `details.quota = { feature, period, limit, used, remaining: 0, resets_at }` → "hết lượt, reset lúc…"
 *  - 402 `insufficient_credits` + `details = { required, balance }` → mua gói credit
 */
export const GATING_ERROR_CONTRACT = {
  upgrade_required: { status: 403, code: 'forbidden' },
  quota_exceeded: { status: 429, code: 'quota_exceeded' },
  insufficient_credits: { status: 402, code: 'insufficient_credits' },
} as const;
