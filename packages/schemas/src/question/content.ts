import { z } from 'zod';
import { localizedTextSchema, uuidSchema } from '../common.js';

/**
 * Nội dung câu hỏi lưu trong catalog.question_versions.content (JSONB).
 * Discriminated union theo `type` = catalog.question_types.code (12 dạng).
 * `answer_key` KHÔNG BAO GIỜ trả cho client – xem toPublicContent().
 */

export const QUESTION_TYPE_CODES = [
  'mcq_single',
  'mcq_multi',
  'fill_blank',
  'matching',
  'drag_drop',
  'map_label',
  'tfng',
  'ordering',
  'dictation',
  'essay',
  'speaking',
  'handwriting',
] as const;
export type QuestionTypeCode = (typeof QUESTION_TYPE_CODES)[number];
export const questionTypeCodeSchema = z.enum(QUESTION_TYPE_CODES);

/** Dạng được chấm tự động bằng packages/schemas.grade() */
export const AUTO_GRADABLE_TYPES: ReadonlySet<QuestionTypeCode> = new Set([
  'mcq_single',
  'mcq_multi',
  'fill_blank',
  'matching',
  'drag_drop',
  'map_label',
  'tfng',
  'ordering',
  'dictation',
]);

const keySchema = z.string().min(1).max(32);

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

const optionSchema = z.object({
  key: keySchema,
  text: z.string().max(2000),
  /** Lựa chọn dạng ảnh/audio (Part 1 có thể chỉ có audio, text rỗng) */
  image_asset_id: uuidSchema.optional(),
  audio_asset_id: uuidSchema.optional(),
});
export type QuestionOption = z.infer<typeof optionSchema>;

/** Phần chung cho mọi dạng câu */
const baseFields = {
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

const itemSchema = z.object({ key: keySchema, text: z.string().max(1000), image_asset_id: uuidSchema.optional() });

// ---------------------------------------------------------------------------
export const mcqSingleContentSchema = z.object({
  type: z.literal('mcq_single'),
  ...baseFields,
  options: z.array(optionSchema).min(2).max(8),
  answer_key: z.object({ correct: keySchema }),
});

export const mcqMultiContentSchema = z.object({
  type: z.literal('mcq_multi'),
  ...baseFields,
  options: z.array(optionSchema).min(2).max(10),
  answer_key: z.object({
    correct: z.array(keySchema).min(1),
    /** all_or_nothing: đúng hết mới được điểm; partial: điểm theo tỷ lệ, chọn sai bị trừ */
    scoring: z.enum(['all_or_nothing', 'partial']).default('all_or_nothing'),
  }),
});

export const fillBlankContentSchema = z.object({
  type: z.literal('fill_blank'),
  ...baseFields,
  /** Đề bài dùng {{b1}}, {{b2}} đánh dấu chỗ trống */
  blanks: z
    .array(
      z.object({
        id: keySchema,
        /** Các đáp án chấp nhận (đã chuẩn hoá khi chấm: trim, gộp khoảng trắng, so không phân biệt hoa thường trừ khi case_sensitive) */
        accepted: z.array(z.string().min(1).max(200)).min(1),
        case_sensitive: z.boolean().default(false),
        /** Giới hạn số từ (IELTS "NO MORE THAN TWO WORDS") */
        max_words: z.number().int().min(1).max(10).optional(),
        /** Tuỳ chọn hiện gợi ý chữ cái đầu / số ký tự */
        hint: z.string().max(100).optional(),
      }),
    )
    .min(1)
    .max(20),
  answer_key: z.object({ ordered: z.boolean().default(true) }).default({ ordered: true }),
});

export const matchingContentSchema = z.object({
  type: z.literal('matching'),
  ...baseFields,
  left: z.array(itemSchema).min(2).max(15),
  right: z.array(itemSchema).min(2).max(15),
  /** Một mục bên phải có thể được dùng nhiều lần (IELTS matching headings/features) */
  allow_reuse: z.boolean().default(false),
  answer_key: z.object({ pairs: z.record(keySchema, keySchema) }),
});

export const dragDropContentSchema = z.object({
  type: z.literal('drag_drop'),
  ...baseFields,
  items: z.array(itemSchema).min(2).max(20),
  slots: z.array(z.object({ key: keySchema, label: z.string().max(300) })).min(1).max(20),
  answer_key: z.object({ placements: z.record(keySchema, keySchema) }),
});

export const mapLabelContentSchema = z.object({
  type: z.literal('map_label'),
  ...baseFields,
  image_asset_id: uuidSchema,
  labels: z.array(itemSchema).min(2).max(15),
  /** Vị trí trên ảnh (toạ độ % 0–100) */
  positions: z.array(z.object({ key: keySchema, x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).min(1).max(15),
  answer_key: z.object({ positions: z.record(keySchema, keySchema) }),
});

export const tfngContentSchema = z.object({
  type: z.literal('tfng'),
  ...baseFields,
  /** tfng = True/False/Not Given; ynng = Yes/No/Not Given */
  variant: z.enum(['tfng', 'ynng']).default('tfng'),
  statements: z.array(itemSchema).min(1).max(15),
  answer_key: z.object({ values: z.record(keySchema, z.enum(['true', 'false', 'not_given'])) }),
});

export const orderingContentSchema = z.object({
  type: z.literal('ordering'),
  ...baseFields,
  items: z.array(itemSchema).min(2).max(15),
  answer_key: z.object({
    order: z.array(keySchema).min(2),
    /** exact: đúng toàn bộ; adjacent_pairs: điểm theo tỷ lệ cặp kề đúng */
    scoring: z.enum(['exact', 'adjacent_pairs']).default('exact'),
  }),
});

export const dictationContentSchema = z.object({
  type: z.literal('dictation'),
  ...baseFields,
  media: questionMediaSchema,
  answer_key: z.object({
    text: z.string().min(1).max(2000),
    /** Số ký tự sai cho phép mỗi token (Levenshtein) */
    max_edit_distance_per_token: z.number().int().min(0).max(3).default(1),
    ignore_punctuation: z.boolean().default(true),
    /** Tỷ lệ token đúng tối thiểu để tính là đúng */
    pass_ratio: z.number().min(0).max(1).default(0.9),
  }),
});

export const essayContentSchema = z.object({
  type: z.literal('essay'),
  ...baseFields,
  /** Loại nhiệm vụ: ielts_task1 | ielts_task2 | toeic_w_q1_5 | toeic_w_q6_7 | toeic_w_q8 | generic */
  task_type: z.string().max(40),
  word_limit: z.object({ min: z.number().int().min(0), max: z.number().int().min(1).optional() }).default({ min: 0 }),
  time_limit_sec: z.number().int().min(60).max(7200).optional(),
  /** Mã rubric trong allingo-prompts.yaml (grade_writing_ielts / grade_writing_toeic) */
  rubric_code: z.string().max(60),
  /** Ảnh/biểu đồ cho Task 1 hoặc TOEIC Q1–5 */
  image_asset_id: uuidSchema.optional(),
  answer_key: z.object({ model_answer: z.string().max(6000).optional(), notes: z.string().max(2000).optional() }).default({}),
});

export const speakingContentSchema = z.object({
  type: z.literal('speaking'),
  ...baseFields,
  /** ielts_part1 | ielts_part2 | ielts_part3 | toeic_s_q1_2 | ... */
  task_type: z.string().max(40),
  prep_seconds: z.number().int().min(0).max(120).default(0),
  response_seconds: z.number().int().min(10).max(600),
  rubric_code: z.string().max(60),
  /** Cue card (IELTS Part 2) */
  cue_points: z.array(z.string().max(300)).max(6).default([]),
  image_asset_id: uuidSchema.optional(),
  answer_key: z.object({ model_answer: z.string().max(6000).optional(), notes: z.string().max(2000).optional() }).default({}),
});

export const handwritingContentSchema = z.object({
  type: z.literal('handwriting'),
  ...baseFields,
  /** Ký tự Hán/Kanji cần viết */
  target: z.string().min(1).max(8),
  script: z.enum(['hanzi', 'kanji']),
  reading: z.string().max(60).optional(),
  meaning: localizedTextSchema.optional(),
  answer_key: z.object({ stroke_count: z.number().int().min(1).max(64).optional() }).default({}),
});

export const questionContentSchema = z.discriminatedUnion('type', [
  mcqSingleContentSchema,
  mcqMultiContentSchema,
  fillBlankContentSchema,
  matchingContentSchema,
  dragDropContentSchema,
  mapLabelContentSchema,
  tfngContentSchema,
  orderingContentSchema,
  dictationContentSchema,
  essayContentSchema,
  speakingContentSchema,
  handwritingContentSchema,
]);
export type QuestionContent = z.infer<typeof questionContentSchema>;
export type QuestionContentOf<T extends QuestionTypeCode> = Extract<QuestionContent, { type: T }>;

export const questionContentSchemasByType = {
  mcq_single: mcqSingleContentSchema,
  mcq_multi: mcqMultiContentSchema,
  fill_blank: fillBlankContentSchema,
  matching: matchingContentSchema,
  drag_drop: dragDropContentSchema,
  map_label: mapLabelContentSchema,
  tfng: tfngContentSchema,
  ordering: orderingContentSchema,
  dictation: dictationContentSchema,
  essay: essayContentSchema,
  speaking: speakingContentSchema,
  handwriting: handwritingContentSchema,
} as const satisfies Record<QuestionTypeCode, z.ZodTypeAny>;
