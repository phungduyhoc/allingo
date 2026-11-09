import { z } from 'zod';
import { localizedTextSchema, uuidSchema } from '../common.js';

/** Thành phần dùng chung của mọi dạng câu (tách từ content.ts ở C2 để module dạng câu IELTS dùng lại – không vòng import). */

export const keySchema = z.string().min(1).max(32);

/**
 * Chính sách điểm cho dạng nhiều phần (blank/pair/slot/label/statement):
 * - partial (mặc định khi bỏ trống): score = tỷ lệ phần đúng, is_correct chỉ khi đúng toàn bộ
 * - all_or_nothing: score = 1 khi đúng toàn bộ, ngược lại 0
 * Để optional (không .default) nhằm giữ tương thích kiểu với content đã viết tay ở apps/*; grade() coi undefined = partial.
 */
export const PARTIAL_SCORING_MODES = ['partial', 'all_or_nothing'] as const;
export type PartialScoringMode = (typeof PARTIAL_SCORING_MODES)[number];
export const DEFAULT_PARTIAL_SCORING: PartialScoringMode = 'partial';
export const partialScoringSchema = z.enum(PARTIAL_SCORING_MODES).optional();

/** Tham chiếu media đính kèm câu hỏi (audio Listening, ảnh Part 1, biểu đồ...) */
export const questionMediaSchema = z.object({
  audio_asset_id: uuidSchema.optional(),
  image_asset_id: uuidSchema.optional(),
  /** Exam Mode: 'once' = phát một lần, không tua; Practice luôn 'free' */
  listen_policy: z.enum(['once', 'free']).default('free'),
  /** Khoảng dừng sau audio để trả lời (ms) – Listening Part 1–4 */
  pause_ms: z.number().int().min(0).max(60_000).optional(),
});
export type QuestionMedia = z.infer<typeof questionMediaSchema>;

export const optionSchema = z.object({
  key: keySchema,
  text: z.string().max(2000),
  /** Lựa chọn dạng ảnh/audio (Part 1 có thể chỉ có audio, text rỗng) */
  image_asset_id: uuidSchema.optional(),
  audio_asset_id: uuidSchema.optional(),
});
export type QuestionOption = z.infer<typeof optionSchema>;

/** Phần chung cho mọi dạng câu */
export const baseFields = {
  /** Đề bài (markdown nhẹ). Listening Part 1/2 có thể rỗng. */
  stem: z.string().max(8000).default(''),
  stem_i18n: localizedTextSchema.optional(),
  media: questionMediaSchema.optional(),
  /** Giải thích do tác giả viết (hạt giống cho explain_mcq) – không trả client trước khi nộp */
  explanation: localizedTextSchema.optional(),
  /** Trích đoạn transcript/passage quyết định đáp án (dùng cho Review/giải thích) */
  evidence: z.string().max(4000).optional(),
  tags: z.array(z.string().max(64)).max(20).default([]),
};

export const itemSchema = z.object({ key: keySchema, text: z.string().max(1000), image_asset_id: uuidSchema.optional() });

