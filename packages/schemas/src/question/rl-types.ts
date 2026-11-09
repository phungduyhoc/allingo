import { z } from 'zod';
import { uuidSchema } from '../common.js';
import { baseFields, itemSchema, keySchema, partialScoringSchema } from './base.js';

/**
 * C2 – dạng câu IELTS Reading/Listening (ADR-0038). Nguyên tắc chung:
 * - Mọi đáp án nằm trong `answer_key` (toPublicContent() bỏ trọn khối) – không để đáp án trong cấu trúc hiển thị như `fill_blank`
 *   cũ (S163).
 * - Chỗ trống đánh dấu `{{id}}` trong văn bản (câu, đoạn tóm tắt, ghi chú, ô bảng, bước sơ đồ, giá trị biểu mẫu); `gapIdsOf()`
 *   liệt kê theo thứ tự xuất hiện – đó là thứ tự đánh số câu hỏi trong câu.
 * - Một câu catalog chứa nhiều mục đánh số (IELTS "Questions 1–5"): chấm từng mục, `markCount()` đếm số câu hỏi IELTS.
 * - Kiểm tra tham chiếu (đáp án ↔ chỗ trống/mục/lựa chọn) bằng `superRefine` – nội dung lệch bị từ chối ở CMS/API/AI sinh câu.
 */

export const GAP_TOKEN_SOURCE = String.raw`\{\{([A-Za-z0-9_-]{1,32})\}\}`;
/** Tách chuỗi theo chỗ trống – phần tử lẻ là id (dùng ở renderer) */
export const GAP_SPLIT_RE = new RegExp(`(\\{\\{[A-Za-z0-9_-]{1,32}\\}\\})`, 'g');

/** Id chỗ trống trong một đoạn văn bản theo thứ tự xuất hiện */
export function gapTokens(text: string): string[] {
  return [...text.matchAll(new RegExp(GAP_TOKEN_SOURCE, 'g'))].map((m) => m[1]!);
}

/**
 * Giới hạn từ của câu điền ("NO MORE THAN TWO WORDS AND/OR A NUMBER", "ONE WORD ONLY", "A NUMBER"):
 * - max_words: số từ tối đa (từ có gạch nối tính một từ)
 * - allow_number: được thêm MỘT số (AND/OR A NUMBER) – số không tính vào max_words
 * - number_only: chỉ được viết một số ("Write A NUMBER")
 */
export const wordLimitSchema = z
  .object({
    max_words: z.number().int().min(1).max(6).optional(),
    allow_number: z.boolean().optional(),
    number_only: z.boolean().optional(),
  })
  .refine((w) => w.number_only === true || w.max_words !== undefined, { message: 'word_limit cần max_words hoặc number_only' });
export type WordLimit = z.infer<typeof wordLimitSchema>;

/** Thông tin hiển thị riêng của một chỗ trống (ghi đè word_limit chung, nhãn cho trình đọc màn hình) */
const gapMetaSchema = z.object({ id: keySchema, word_limit: wordLimitSchema.optional(), label: z.string().max(200).optional() });

/** Đáp án một chỗ trống: các cách viết được chấp nhận; "(the) library" = chấp nhận cả "library" và "the library" */
export const typedGapKeySchema = z.object({
  accepted: z.array(z.string().min(1).max(200)).min(1).max(12),
  case_sensitive: z.boolean().optional(),
});

export const typedAnswerKeySchema = z.object({
  gaps: z.record(keySchema, typedGapKeySchema),
  /** Chấp nhận cả chính tả Anh và Mỹ (colour/color, centre/center, organise/organize) – chỉ khi khai báo true */
  spelling_variants: z.boolean().optional(),
  scoring: partialScoringSchema,
});

const typedFields = {
  ...baseFields,
  /** Giới hạn từ chung cho mọi chỗ trống (ô có `gaps[].word_limit` thì ghi đè) */
  word_limit: wordLimitSchema.optional(),
  gaps: z.array(gapMetaSchema).max(30).default([]),
  answer_key: typedAnswerKeySchema,
};

const titleField = z.string().max(200).optional();
const pct = z.number().min(0).max(100);

type Ctx = z.RefinementCtx;
const issue = (ctx: Ctx, path: Array<string | number>, message: string) => ctx.addIssue({ code: 'custom', message, path });

/** Kiểm tra id chỗ trống ↔ answer_key.gaps ↔ gaps[] (dùng chung cho mọi dạng gõ đáp án) */
function refineTypedGaps(ids: readonly string[], c: { answer_key: { gaps: Record<string, unknown> }; gaps?: ReadonlyArray<{ id: string }> }, ctx: Ctx): void {
  if (!ids.length) issue(ctx, [], 'Không có chỗ trống {{id}} nào');
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issue(ctx, [], `Chỗ trống {{${id}}} bị lặp`);
    seen.add(id);
    if (!(id in c.answer_key.gaps)) issue(ctx, ['answer_key', 'gaps', id], `Thiếu đáp án cho chỗ trống ${id}`);
  }
  for (const k of Object.keys(c.answer_key.gaps)) if (!seen.has(k)) issue(ctx, ['answer_key', 'gaps', k], `Đáp án ${k} không có chỗ trống tương ứng`);
  for (const [i, g] of (c.gaps ?? []).entries()) if (!seen.has(g.id)) issue(ctx, ['gaps', i, 'id'], `gaps[].id ${g.id} không có trong nội dung`);
}

function refineUniqueKeys(list: ReadonlyArray<{ key: string }>, path: string, ctx: Ctx): Set<string> {
  const keys = new Set<string>();
  for (const [i, x] of list.entries()) {
    if (keys.has(x.key)) issue(ctx, [path, i, 'key'], `Mã ${x.key} bị lặp`);
    keys.add(x.key);
  }
  return keys;
}

// --------------------------------------------------------------------------- Điền từ (gõ đáp án)

export const sentenceCompletionContentSchema = z
  .object({
    type: z.literal('sentence_completion'),
    ...typedFields,
    /** Mỗi câu chứa một (hiếm khi hai) chỗ trống `{{id}}` */
    sentences: z.array(z.object({ key: keySchema, text: z.string().min(1).max(600) })).min(1).max(15),
  })
  .superRefine((c, ctx) => refineTypedGaps(c.sentences.flatMap((s) => gapTokens(s.text)), c, ctx));

export const summaryCompletionContentSchema = z
  .object({
    type: z.literal('summary_completion'),
    ...typedFields,
    title: titleField,
    /** Đoạn tóm tắt (có thể nhiều đoạn, cách nhau dòng trống) */
    text: z.string().min(1).max(4000),
  })
  .superRefine((c, ctx) => refineTypedGaps(gapTokens(c.text), c, ctx));

export const noteCompletionContentSchema = z
  .object({
    type: z.literal('note_completion'),
    ...typedFields,
    title: titleField,
    /** Dòng ghi chú; `level` 0–2 = mức thụt lề; `heading` = tiêu đề mục */
    lines: z.array(z.object({ text: z.string().min(1).max(600), level: z.number().int().min(0).max(2).default(0), heading: z.boolean().optional() })).min(1).max(40),
  })
  .superRefine((c, ctx) => refineTypedGaps(c.lines.flatMap((l) => gapTokens(l.text)), c, ctx));

export const tableCompletionContentSchema = z
  .object({
    type: z.literal('table_completion'),
    ...typedFields,
    title: titleField,
    columns: z.array(z.string().max(200)).min(1).max(6),
    /** Ô bảng theo hàng; ô có thể chứa `{{id}}` */
    rows: z.array(z.array(z.string().max(400)).min(1).max(6)).min(1).max(15),
  })
  .superRefine((c, ctx) => {
    for (const [i, r] of c.rows.entries()) if (r.length !== c.columns.length) issue(ctx, ['rows', i], `Hàng ${i + 1} có ${r.length} ô, cần ${c.columns.length}`);
    refineTypedGaps(c.rows.flatMap((r) => r.flatMap(gapTokens)), c, ctx);
  });

export const flowChartCompletionContentSchema = z
  .object({
    type: z.literal('flow_chart_completion'),
    ...typedFields,
    title: titleField,
    steps: z.array(z.object({ text: z.string().min(1).max(600) })).min(2).max(12),
  })
  .superRefine((c, ctx) => refineTypedGaps(c.steps.flatMap((s) => gapTokens(s.text)), c, ctx));

export const formCompletionContentSchema = z
  .object({
    type: z.literal('form_completion'),
    ...typedFields,
    title: titleField,
    /** Dòng biểu mẫu "Nhãn: giá trị" – giá trị chứa `{{id}}` (hoặc là ví dụ đã điền sẵn) */
    fields: z.array(z.object({ label: z.string().min(1).max(200), value: z.string().max(400) })).min(1).max(20),
  })
  .superRefine((c, ctx) => refineTypedGaps(c.fields.flatMap((f) => gapTokens(f.value)), c, ctx));

export const shortAnswerContentSchema = z
  .object({
    type: z.literal('short_answer'),
    ...typedFields,
    /** Mỗi câu hỏi là một chỗ trả lời (id = khoá đáp án) */
    questions: z.array(z.object({ id: keySchema, text: z.string().min(1).max(600) })).min(1).max(10),
  })
  .superRefine((c, ctx) => refineTypedGaps(c.questions.map((q) => q.id), c, ctx));

/** Gán nhãn sơ đồ bằng cách GÕ từ (IELTS Reading/Listening diagram labelling) */
export const diagramLabellingContentSchema = z
  .object({
    type: z.literal('diagram_labelling'),
    ...typedFields,
    image_asset_id: uuidSchema,
    /** Mô tả văn bản thay thế toàn bộ sơ đồ – người không nhìn thấy ảnh vẫn làm được bài */
    image_alt: z.string().min(1).max(1500),
    title: titleField,
    /** Vị trí nhãn trên ảnh (toạ độ % 0–100) + mô tả vị trí bằng chữ */
    labels: z.array(z.object({ id: keySchema, x: pct, y: pct, description: z.string().min(1).max(300) })).min(1).max(12),
  })
  .superRefine((c, ctx) => refineTypedGaps(c.labels.map((l) => l.id), c, ctx));

// --------------------------------------------------------------------------- Nối (matching)

const matchingFamilyAnswerKey = z.object({ pairs: z.record(keySchema, keySchema), scoring: partialScoringSchema });

function refineMatching(c: { items: ReadonlyArray<{ key: string }>; options: ReadonlyArray<{ key: string }>; answer_key: { pairs: Record<string, string> }; example?: { item: string; option: string } | undefined }, ctx: Ctx): void {
  const items = refineUniqueKeys(c.items, 'items', ctx);
  const options = refineUniqueKeys(c.options, 'options', ctx);
  if (c.example) {
    if (!items.has(c.example.item)) issue(ctx, ['example', 'item'], `Ví dụ trỏ tới mục ${c.example.item} không tồn tại`);
    if (!options.has(c.example.option)) issue(ctx, ['example', 'option'], `Ví dụ trỏ tới lựa chọn ${c.example.option} không tồn tại`);
  }
  for (const it of c.items) {
    if (c.example?.item === it.key) continue;
    if (!(it.key in c.answer_key.pairs)) issue(ctx, ['answer_key', 'pairs', it.key], `Thiếu đáp án cho mục ${it.key}`);
  }
  for (const [k, v] of Object.entries(c.answer_key.pairs)) {
    if (!items.has(k)) issue(ctx, ['answer_key', 'pairs', k], `Đáp án cho mục ${k} không tồn tại`);
    if (!options.has(v)) issue(ctx, ['answer_key', 'pairs', k], `Lựa chọn ${v} không tồn tại`);
  }
}

const matchingFields = (reuseDefault: boolean) => ({
  ...baseFields,
  /** Mục cần nối (đoạn văn, mệnh đề, nửa đầu câu) */
  items: z.array(itemSchema).min(1).max(15),
  /** Danh sách lựa chọn (tiêu đề i–x, đoạn A–H, đặc điểm A–E, đuôi câu A–G) */
  options: z.array(itemSchema).min(2).max(20),
  /** Tiêu đề khung lựa chọn ("List of Headings", "List of Researchers"…) */
  options_title: z.string().max(120).optional(),
  /** Một lựa chọn được dùng nhiều lần ("You may use any letter more than once") */
  allow_reuse: z.boolean().default(reuseDefault),
  answer_key: matchingFamilyAnswerKey,
});

/** Nối tiêu đề với đoạn văn – có thể có dòng ví dụ đã điền (không tính điểm) */
export const matchingHeadingsContentSchema = z
  .object({ type: z.literal('matching_headings'), ...matchingFields(false), example: z.object({ item: keySchema, option: keySchema }).optional() })
  .superRefine(refineMatching);
/** Thông tin nằm ở đoạn nào (A–G) – mặc định cho dùng lại chữ cái */
export const matchingInformationContentSchema = z.object({ type: z.literal('matching_information'), ...matchingFields(true) }).superRefine(refineMatching);
/** Nối mệnh đề với đặc điểm/người/mốc thời gian */
export const matchingFeaturesContentSchema = z.object({ type: z.literal('matching_features'), ...matchingFields(true) }).superRefine(refineMatching);
/** Nối nửa đầu câu với đuôi câu (có đuôi nhiễu) */
export const matchingSentenceEndingsContentSchema = z.object({ type: z.literal('matching_sentence_endings'), ...matchingFields(false) }).superRefine(refineMatching);

// --------------------------------------------------------------------------- Tóm tắt chọn từ ngân hàng

export const summaryWordBankContentSchema = z
  .object({
    type: z.literal('summary_word_bank'),
    ...baseFields,
    title: titleField,
    text: z.string().min(1).max(4000),
    /** Ngân hàng từ A–L (nhiều hơn số chỗ trống) */
    bank: z.array(itemSchema).min(2).max(20),
    allow_reuse: z.boolean().default(false),
    answer_key: z.object({ gaps: z.record(keySchema, keySchema), scoring: partialScoringSchema }),
  })
  .superRefine((c, ctx) => {
    const bank = refineUniqueKeys(c.bank, 'bank', ctx);
    const ids = gapTokens(c.text);
    if (!ids.length) issue(ctx, ['text'], 'Không có chỗ trống {{id}} nào');
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issue(ctx, ['text'], `Chỗ trống {{${id}}} bị lặp`);
      seen.add(id);
      if (!(id in c.answer_key.gaps)) issue(ctx, ['answer_key', 'gaps', id], `Thiếu đáp án cho chỗ trống ${id}`);
    }
    for (const [k, v] of Object.entries(c.answer_key.gaps)) {
      if (!seen.has(k)) issue(ctx, ['answer_key', 'gaps', k], `Đáp án ${k} không có chỗ trống tương ứng`);
      if (!bank.has(v)) issue(ctx, ['answer_key', 'gaps', k], `Từ ${v} không có trong ngân hàng`);
    }
  });

// --------------------------------------------------------------------------- Bản đồ / mặt bằng (chọn chữ cái)

export const planMapLabellingContentSchema = z
  .object({
    type: z.literal('plan_map_labelling'),
    ...baseFields,
    /** map: bản đồ; plan: mặt bằng toà nhà; diagram: sơ đồ chọn chữ cái */
    kind: z.enum(['map', 'plan', 'diagram']).default('map'),
    image_asset_id: uuidSchema,
    /** Mô tả văn bản thay thế toàn bộ ảnh (bắt buộc – phương án không cần nhìn) */
    image_alt: z.string().min(1).max(1500),
    title: titleField,
    /** Vị trí có chữ cái trên ảnh (toạ độ % 0–100) + mô tả vị trí bằng chữ cho trình đọc màn hình */
    markers: z.array(z.object({ key: keySchema, x: pct, y: pct, description: z.string().max(300).optional() })).min(2).max(15),
    /** Địa điểm cần xác định (mỗi mục là một câu hỏi) */
    items: z.array(itemSchema).min(1).max(12),
    answer_key: z.object({ values: z.record(keySchema, keySchema), scoring: partialScoringSchema }),
  })
  .superRefine((c, ctx) => {
    const markers = refineUniqueKeys(c.markers, 'markers', ctx);
    const items = refineUniqueKeys(c.items, 'items', ctx);
    for (const it of c.items) if (!(it.key in c.answer_key.values)) issue(ctx, ['answer_key', 'values', it.key], `Thiếu đáp án cho mục ${it.key}`);
    for (const [k, v] of Object.entries(c.answer_key.values)) {
      if (!items.has(k)) issue(ctx, ['answer_key', 'values', k], `Đáp án cho mục ${k} không tồn tại`);
      if (!markers.has(v)) issue(ctx, ['answer_key', 'values', k], `Vị trí ${v} không có trên ảnh`);
    }
  });

/** Dạng gõ đáp án (chấm bằng chuẩn hoá chuỗi) */
export const TYPED_GAP_TYPES = ['sentence_completion', 'summary_completion', 'note_completion', 'table_completion', 'flow_chart_completion', 'form_completion', 'short_answer', 'diagram_labelling'] as const;
export type TypedGapType = (typeof TYPED_GAP_TYPES)[number];
/** Dạng nối (mục → lựa chọn) */
export const MATCHING_FAMILY_TYPES = ['matching_headings', 'matching_information', 'matching_features', 'matching_sentence_endings'] as const;
export type MatchingFamilyType = (typeof MATCHING_FAMILY_TYPES)[number];

export const RL_QUESTION_TYPE_CODES = [...MATCHING_FAMILY_TYPES, ...TYPED_GAP_TYPES, 'summary_word_bank', 'plan_map_labelling'] as const;
