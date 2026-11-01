/**
 * Máy trạng thái duyệt nội dung câu hỏi (CMS): draft → ai_checked → review1 → review2 → published → retired.
 * Hàm thuần, không phụ thuộc Payload; được gọi trong hook `beforeChange` của collection `questions`.
 */

export const QUESTION_STATUSES = ['draft', 'ai_checked', 'review1', 'review2', 'published', 'rejected', 'retired'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const CMS_ROLES = ['editor', 'teacher', 'admin'] as const;
export type CmsRole = (typeof CMS_ROLES)[number];

export type ReviewStage = 'ai_check' | 'review1' | 'review2';
/** approve/reject/needs_change: quyết định duyệt; submit/retire/reopen: mốc chuyển trạng thái khác (chỉ dùng trong CMS) */
export type ReviewDecision = 'approve' | 'reject' | 'needs_change' | 'submit' | 'retire' | 'reopen';
export const REVIEW_DECISIONS: ReadonlyArray<ReviewDecision> = ['approve', 'reject', 'needs_change', 'submit', 'retire', 'reopen'];

export interface AiReport {
  verdict?: 'pass' | 'fail' | 'needs_change';
  issues?: Array<{ field?: string; severity: 'error' | 'warning'; message: string }>;
  ai_task_id?: string | null;
  checked_at?: string;
  error?: string;
  /** Lưu dưới field JSON của Payload nên cho phép khoá mở rộng */
  [key: string]: unknown;
}

export interface TransitionContext {
  from: QuestionStatus;
  to: QuestionStatus;
  role: CmsRole;
  aiReport?: AiReport | null;
  note?: string | null;
  /** true khi chuyển trạng thái do hệ thống (nút AI kiểm tra) */
  viaAiCheck?: boolean;
}

export interface TransitionEffect {
  /** Bản ghi thêm vào `reviews` */
  review: { stage: ReviewStage; decision: ReviewDecision } | null;
  /** Cần gọi API nội bộ publish */
  publish: boolean;
}

export type TransitionResult = { ok: true; effect: TransitionEffect } | { ok: false; message: string };

interface Rule {
  from: QuestionStatus;
  to: QuestionStatus;
  roles: ReadonlyArray<CmsRole>;
  review: TransitionEffect['review'];
  publish?: boolean;
  requireNote?: boolean;
  guard?: (ctx: TransitionContext) => string | null;
}

const ALL: ReadonlyArray<CmsRole> = ['editor', 'teacher', 'admin'];
const REVIEWERS: ReadonlyArray<CmsRole> = ['teacher', 'admin'];

const notFailed = (ctx: TransitionContext): string | null =>
  ctx.aiReport?.verdict === 'fail' ? 'AI kiểm tra kết luận "fail" – sửa nội dung và kiểm tra lại trước khi gửi duyệt.' : null;

const RULES: ReadonlyArray<Rule> = [
  // Editor: draft ↔ ai_checked (qua nút AI), gửi review1
  {
    from: 'draft',
    to: 'ai_checked',
    roles: ALL,
    review: { stage: 'ai_check', decision: 'approve' },
    guard: (ctx) => {
      if (!ctx.viaAiCheck) return 'Trạng thái "ai_checked" chỉ được đặt qua nút "Gửi AI kiểm tra".';
      const v = ctx.aiReport?.verdict;
      if (v !== 'pass' && v !== 'needs_change') return 'AI chưa trả kết quả pass/needs_change nên không thể chuyển sang ai_checked.';
      return null;
    },
  },
  { from: 'ai_checked', to: 'draft', roles: ALL, review: { stage: 'ai_check', decision: 'reopen' } },
  { from: 'draft', to: 'review1', roles: ALL, review: { stage: 'review1', decision: 'submit' }, guard: notFailed },
  { from: 'ai_checked', to: 'review1', roles: ALL, review: { stage: 'review1', decision: 'submit' }, guard: notFailed },
  // Teacher/admin duyệt vòng 1
  { from: 'review1', to: 'review2', roles: REVIEWERS, review: { stage: 'review1', decision: 'approve' } },
  { from: 'review1', to: 'draft', roles: REVIEWERS, review: { stage: 'review1', decision: 'needs_change' }, requireNote: true },
  { from: 'review1', to: 'rejected', roles: REVIEWERS, review: { stage: 'review1', decision: 'reject' }, requireNote: true },
  // Vòng 2 → phát hành (gọi API nội bộ)
  { from: 'review2', to: 'published', roles: REVIEWERS, review: { stage: 'review2', decision: 'approve' }, publish: true },
  { from: 'review2', to: 'draft', roles: REVIEWERS, review: { stage: 'review2', decision: 'needs_change' }, requireNote: true },
  { from: 'review2', to: 'rejected', roles: REVIEWERS, review: { stage: 'review2', decision: 'reject' }, requireNote: true },
  // Sau phát hành
  { from: 'published', to: 'retired', roles: REVIEWERS, review: { stage: 'review2', decision: 'retire' } },
  { from: 'rejected', to: 'draft', roles: ALL, review: { stage: 'review1', decision: 'reopen' } },
  { from: 'retired', to: 'draft', roles: ['admin'], review: { stage: 'review2', decision: 'reopen' } },
];

export const STATUS_LABELS: Record<QuestionStatus, { vi: string; en: string }> = {
  draft: { vi: 'Nháp', en: 'Draft' },
  ai_checked: { vi: 'AI đã kiểm tra', en: 'AI checked' },
  review1: { vi: 'Chờ duyệt vòng 1', en: 'Review 1' },
  review2: { vi: 'Chờ duyệt vòng 2', en: 'Review 2' },
  published: { vi: 'Đã phát hành', en: 'Published' },
  rejected: { vi: 'Từ chối', en: 'Rejected' },
  retired: { vi: 'Ngừng dùng', en: 'Retired' },
};

export function isQuestionStatus(v: unknown): v is QuestionStatus {
  return typeof v === 'string' && (QUESTION_STATUSES as readonly string[]).includes(v);
}

export function isCmsRole(v: unknown): v is CmsRole {
  return typeof v === 'string' && (CMS_ROLES as readonly string[]).includes(v);
}

/** Các trạng thái đích hợp lệ từ `from` với vai trò `role` (dùng cho UI gợi ý) */
export function allowedTargets(from: QuestionStatus, role: CmsRole): QuestionStatus[] {
  return RULES.filter((r) => r.from === from && r.roles.includes(role) && !(r.from === 'draft' && r.to === 'ai_checked')).map((r) => r.to);
}

/** Kiểm tra một chuyển trạng thái; `from === to` luôn hợp lệ (không tạo review). */
export function evaluateTransition(ctx: TransitionContext): TransitionResult {
  if (ctx.from === ctx.to) return { ok: true, effect: { review: null, publish: false } };
  const rule = RULES.find((r) => r.from === ctx.from && r.to === ctx.to);
  if (!rule) {
    return {
      ok: false,
      message: `Không thể chuyển từ "${STATUS_LABELS[ctx.from].vi}" sang "${STATUS_LABELS[ctx.to].vi}". Các trạng thái hợp lệ: ${allowedTargets(ctx.from, ctx.role)
        .map((s) => STATUS_LABELS[s].vi)
        .join(', ') || '(không có)'}.`,
    };
  }
  if (!rule.roles.includes(ctx.role)) {
    return {
      ok: false,
      message: `Vai trò "${ctx.role}" không có quyền chuyển "${STATUS_LABELS[ctx.from].vi}" → "${STATUS_LABELS[ctx.to].vi}" (cần: ${rule.roles.join('/')}).`,
    };
  }
  if (rule.requireNote && !(ctx.note && ctx.note.trim().length > 0)) {
    return { ok: false, message: `Chuyển "${STATUS_LABELS[ctx.from].vi}" → "${STATUS_LABELS[ctx.to].vi}" cần ghi chú (reviewNote) cho người soạn.` };
  }
  if (rule.guard) {
    const g = rule.guard(ctx);
    if (g) return { ok: false, message: g };
  }
  return { ok: true, effect: { review: rule.review, publish: rule.publish === true } };
}

/** Trạng thái mà editor có thể sửa nội dung trực tiếp (ngoài các trạng thái này cần admin/teacher) */
export const EDITABLE_CONTENT_STATUSES: ReadonlySet<QuestionStatus> = new Set(['draft', 'ai_checked', 'rejected']);
