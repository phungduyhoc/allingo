/**
 * Máy trạng thái duyệt nội dung (ADR-0024) – DÙNG CHUNG cho CMS (Payload hook) và API (`/admin/content/.../review`).
 * draft → (ai_checked) → review1 → review2 → published → retired; nhánh needs_change → draft, reject → rejected.
 * Hàm thuần: không phụ thuộc DB/Payload. `content_reviews.decision` trong DDL chỉ có approve/reject/needs_change;
 * submit/retire/reopen là mốc chuyển trạng thái (ghi audit, không ghi content_reviews).
 */

export const CONTENT_STATUSES = ['draft', 'ai_checked', 'review1', 'review2', 'published', 'rejected', 'retired'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_ROLES = ['editor', 'teacher', 'admin'] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

export const REVIEW_STAGES = ['ai_check', 'review1', 'review2'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

/** Quyết định ghi vào catalog.content_reviews (khớp enum DDL) */
export const REVIEW_DECISIONS_DB = ['approve', 'reject', 'needs_change'] as const;
export type ReviewDecisionDb = (typeof REVIEW_DECISIONS_DB)[number];
/** Toàn bộ quyết định/hành động (mở rộng: submit/retire/reopen – SPEC-ISSUES S15) */
export const REVIEW_DECISIONS = ['approve', 'reject', 'needs_change', 'submit', 'retire', 'reopen'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const CONTENT_ENTITY_TYPES = ['question', 'passage', 'lesson', 'exercise', 'video', 'vocab_item'] as const;
export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number];

export interface AiCheckReport {
  verdict?: 'pass' | 'fail' | 'needs_change';
  issues?: Array<{ field?: string; severity: 'error' | 'warning'; message: string }>;
  ai_task_id?: string | null;
  checked_at?: string;
  error?: string;
  [key: string]: unknown;
}

export interface TransitionContext {
  from: ContentStatus;
  to: ContentStatus;
  role: ContentRole;
  aiReport?: AiCheckReport | null;
  note?: string | null;
  /** true khi chuyển trạng thái do hệ thống (nút/endpoint AI kiểm tra) */
  viaAiCheck?: boolean;
  /** Người thực hiện và người đã duyệt vòng 1 (kiểm tra nguyên tắc 4 mắt ở vòng 2) */
  actorId?: string | null;
  review1ApproverId?: string | null;
}

export interface TransitionEffect {
  review: { stage: ReviewStage; decision: ReviewDecision } | null;
  /** Đưa phiên bản hiện tại ra cho người học (outbox content.published) */
  publish: boolean;
  /** Rút khỏi người học (outbox content.retired) */
  retire: boolean;
}

export type TransitionErrorCode = 'invalid_transition' | 'role_not_allowed' | 'note_required' | 'ai_check_failed' | 'ai_check_only' | 'four_eyes';
export type TransitionResult = { ok: true; effect: TransitionEffect } | { ok: false; code: TransitionErrorCode; message: string };

interface Rule {
  from: ContentStatus;
  to: ContentStatus;
  roles: ReadonlyArray<ContentRole>;
  review: TransitionEffect['review'];
  publish?: boolean;
  retire?: boolean;
  requireNote?: boolean;
  guard?: (ctx: TransitionContext) => { code: TransitionErrorCode; message: string } | null;
}

const ALL: ReadonlyArray<ContentRole> = ['editor', 'teacher', 'admin'];
const REVIEWERS: ReadonlyArray<ContentRole> = ['teacher', 'admin'];
/** Vòng 2: admin (giáo viên cấp cao được cấp vai trò admin theo chương trình – A23) */
const SENIOR: ReadonlyArray<ContentRole> = ['admin'];

const notFailed = (ctx: TransitionContext) =>
  ctx.aiReport?.verdict === 'fail' ? { code: 'ai_check_failed' as const, message: 'AI kiểm tra kết luận "fail" – sửa nội dung và kiểm tra lại trước khi gửi duyệt.' } : null;

const fourEyes = (ctx: TransitionContext) =>
  ctx.actorId && ctx.review1ApproverId && ctx.actorId === ctx.review1ApproverId
    ? { code: 'four_eyes' as const, message: 'Người duyệt vòng 2 phải khác người đã duyệt vòng 1 (nguyên tắc 4 mắt).' }
    : null;

const RULES: ReadonlyArray<Rule> = [
  {
    from: 'draft',
    to: 'ai_checked',
    roles: ALL,
    review: { stage: 'ai_check', decision: 'approve' },
    guard: (ctx) => {
      if (!ctx.viaAiCheck) return { code: 'ai_check_only', message: 'Trạng thái "AI đã kiểm tra" chỉ được đặt qua chức năng "Gửi AI kiểm tra".' };
      const v = ctx.aiReport?.verdict;
      if (v !== 'pass' && v !== 'needs_change') return { code: 'ai_check_failed', message: 'AI chưa trả kết quả pass/needs_change nên không thể chuyển sang "AI đã kiểm tra".' };
      return null;
    },
  },
  { from: 'ai_checked', to: 'draft', roles: ALL, review: { stage: 'ai_check', decision: 'reopen' } },
  { from: 'draft', to: 'review1', roles: ALL, review: { stage: 'review1', decision: 'submit' }, guard: notFailed },
  { from: 'ai_checked', to: 'review1', roles: ALL, review: { stage: 'review1', decision: 'submit' }, guard: notFailed },
  { from: 'review1', to: 'review2', roles: REVIEWERS, review: { stage: 'review1', decision: 'approve' } },
  { from: 'review1', to: 'draft', roles: REVIEWERS, review: { stage: 'review1', decision: 'needs_change' }, requireNote: true },
  { from: 'review1', to: 'rejected', roles: REVIEWERS, review: { stage: 'review1', decision: 'reject' }, requireNote: true },
  { from: 'review2', to: 'published', roles: SENIOR, review: { stage: 'review2', decision: 'approve' }, publish: true, guard: fourEyes },
  { from: 'review2', to: 'draft', roles: SENIOR, review: { stage: 'review2', decision: 'needs_change' }, requireNote: true },
  { from: 'review2', to: 'rejected', roles: SENIOR, review: { stage: 'review2', decision: 'reject' }, requireNote: true },
  { from: 'published', to: 'retired', roles: REVIEWERS, review: { stage: 'review2', decision: 'retire' }, retire: true },
  { from: 'rejected', to: 'draft', roles: ALL, review: { stage: 'review1', decision: 'reopen' } },
  { from: 'retired', to: 'draft', roles: ['admin'], review: { stage: 'review2', decision: 'reopen' } },
];

export const CONTENT_STATUS_LABELS: Record<ContentStatus, { vi: string; en: string }> = {
  draft: { vi: 'Nháp', en: 'Draft' },
  ai_checked: { vi: 'AI đã kiểm tra', en: 'AI checked' },
  review1: { vi: 'Chờ duyệt vòng 1', en: 'Review 1' },
  review2: { vi: 'Chờ duyệt vòng 2', en: 'Review 2' },
  published: { vi: 'Đã phát hành', en: 'Published' },
  rejected: { vi: 'Từ chối', en: 'Rejected' },
  retired: { vi: 'Ngừng dùng', en: 'Retired' },
};

/** Trạng thái editor được sửa nội dung trực tiếp */
export const EDITABLE_CONTENT_STATUSES: ReadonlySet<ContentStatus> = new Set(['draft', 'ai_checked', 'rejected']);

export function isContentStatus(v: unknown): v is ContentStatus {
  return typeof v === 'string' && (CONTENT_STATUSES as readonly string[]).includes(v);
}
export function isContentRole(v: unknown): v is ContentRole {
  return typeof v === 'string' && (CONTENT_ROLES as readonly string[]).includes(v);
}

/** Vai trò nội dung cao nhất từ danh sách vai trò hệ thống (superadmin ≡ admin) */
export function contentRoleOf(roles: readonly string[]): ContentRole | null {
  if (roles.includes('admin') || roles.includes('superadmin')) return 'admin';
  if (roles.includes('teacher')) return 'teacher';
  if (roles.includes('editor')) return 'editor';
  return null;
}

export function allowedTargets(from: ContentStatus, role: ContentRole): ContentStatus[] {
  return RULES.filter((r) => r.from === from && r.roles.includes(role) && !(r.from === 'draft' && r.to === 'ai_checked')).map((r) => r.to);
}

/** Đích của một quyết định (dùng cho API `{stage, decision}`) */
export function targetOf(from: ContentStatus, stage: ReviewStage, decision: ReviewDecision): ContentStatus | null {
  const rule = RULES.find((r) => r.from === from && r.review?.stage === stage && r.review.decision === decision);
  return rule?.to ?? null;
}

export function evaluateTransition(ctx: TransitionContext): TransitionResult {
  if (ctx.from === ctx.to) return { ok: true, effect: { review: null, publish: false, retire: false } };
  const rule = RULES.find((r) => r.from === ctx.from && r.to === ctx.to);
  const vi = (s: ContentStatus) => CONTENT_STATUS_LABELS[s].vi;
  if (!rule) {
    const targets = allowedTargets(ctx.from, ctx.role).map(vi).join(', ') || '(không có)';
    return { ok: false, code: 'invalid_transition', message: `Không thể chuyển từ "${vi(ctx.from)}" sang "${vi(ctx.to)}". Các trạng thái hợp lệ: ${targets}.` };
  }
  if (!rule.roles.includes(ctx.role)) {
    return { ok: false, code: 'role_not_allowed', message: `Vai trò "${ctx.role}" không có quyền chuyển "${vi(ctx.from)}" → "${vi(ctx.to)}" (cần: ${rule.roles.join('/')}).` };
  }
  if (rule.requireNote && !(ctx.note && ctx.note.trim().length > 0)) {
    return { ok: false, code: 'note_required', message: `Chuyển "${vi(ctx.from)}" → "${vi(ctx.to)}" cần ghi chú cho người soạn.` };
  }
  const g = rule.guard?.(ctx);
  if (g) return { ok: false, ...g };
  return { ok: true, effect: { review: rule.review, publish: rule.publish === true, retire: rule.retire === true } };
}

/** Quyết định có được ghi vào catalog.content_reviews (enum DDL) không */
export function isDbReviewDecision(d: ReviewDecision): d is ReviewDecisionDb {
  return (REVIEW_DECISIONS_DB as readonly string[]).includes(d);
}
