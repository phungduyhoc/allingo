import { z } from 'zod';
import { programCodeSchema, uuidSchema } from '../common.js';
import { CONTENT_STATUSES } from '../content/workflow.js';
import { IMPORT_MAX_BYTES } from '../content/import-sheet.js';

/**
 * B2 – công cụ sản xuất nội dung (OpenAPI v1.1 nhóm Admin): hàng chờ duyệt (lọc/sắp xếp, duyệt/từ chối hàng loạt có lý do,
 * phân công reviewer), nhập câu hỏi từ Excel (dry-run → xác nhận), AI soạn nháp cả đề theo blueprint. Zod đầu vào dùng ở API;
 * kiểu phản hồi web lấy từ `components['schemas']` (OpenAPI).
 */

export const REVIEW_QUEUE_STATUSES = ['draft', 'ai_checked', 'review1', 'review2'] as const;
export const REVIEW_QUEUE_SORTS = ['created_at', 'updated_at', 'similarity'] as const;
export const REVIEW_BULK_ACTIONS = ['approve', 'reject', 'needs_change', 'submit'] as const;
export type ReviewBulkAction = (typeof REVIEW_BULK_ACTIONS)[number];

const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

export const reviewQueueQuerySchema = z.object({
  program: programCodeSchema.optional(),
  section: z.string().max(32).optional(),
  /** Trạng thái duyệt của bản đang soạn (bỏ trống = mọi trạng thái chờ: draft/ai_checked/review1/review2) */
  status: z.enum(CONTENT_STATUSES).optional(),
  source: z.enum(['human', 'ai', 'licensed']).optional(),
  duplicate: boolish.optional(),
  /** uuid hoặc `me` */
  created_by: z.union([uuidSchema, z.literal('me')]).optional(),
  /** uuid, `me` hoặc `none` (chưa phân công) */
  assignee: z.union([uuidSchema, z.literal('me'), z.literal('none')]).optional(),
  test_set_id: uuidSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(REVIEW_QUEUE_SORTS).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

export const reviewBulkInputSchema = z
  .object({
    question_ids: z.array(uuidSchema).min(1).max(100),
    action: z.enum(REVIEW_BULK_ACTIONS),
    /** Bắt buộc ≥ 3 ký tự khi từ chối / yêu cầu sửa (ghi content_reviews.notes + audit) */
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === 'reject' || v.action === 'needs_change') && (v.notes ?? '').length < 3) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'notes (≥ 3 chars) required for reject/needs_change' });
  });
export type ReviewBulkInput = z.infer<typeof reviewBulkInputSchema>;

export const reviewAssignInputSchema = z.object({
  question_ids: z.array(uuidSchema).min(1).max(200),
  /** null = bỏ phân công */
  assignee_id: uuidSchema.nullable(),
});
export type ReviewAssignInput = z.infer<typeof reviewAssignInputSchema>;

/** POST /admin/content/imports – tệp .xlsx base64 (≤ 1 MB), dry-run trước; xác nhận gửi lại cùng tệp + fingerprint của dry-run */
export const contentImportInputSchema = z.object({
  file_name: z.string().min(1).max(200).regex(/\.xlsx$/i, 'file must be .xlsx'),
  file_base64: z.string().min(16).max(Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 8),
  dry_run: z.boolean().default(true),
  /** Bắt buộc khi dry_run = false: sha256 tệp của lần dry-run (chống ghi nhầm tệp khác) */
  confirm_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Bỏ qua dòng nghi trùng câu đã có (mặc định: vẫn nhập, gắn cờ nghi trùng vào hàng chờ duyệt) */
  skip_bank_duplicates: z.boolean().default(false),
});
export type ContentImportInput = z.infer<typeof contentImportInputSchema>;

export const similarQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(10).default(3) });
