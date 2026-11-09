import { z } from 'zod';
import { uuidSchema } from '../common.js';

/** Câu trả lời của người học lưu trong learn.attempt_answers.answer (JSONB), phân biệt theo `type`. */

const keySchema = z.string().min(1).max(32);

export const mcqSingleAnswerSchema = z.object({ type: z.literal('mcq_single'), selected: keySchema.nullable() });
export const mcqMultiAnswerSchema = z.object({ type: z.literal('mcq_multi'), selected: z.array(keySchema).max(10) });
export const fillBlankAnswerSchema = z.object({ type: z.literal('fill_blank'), blanks: z.record(keySchema, z.string().max(200)) });
export const matchingAnswerSchema = z.object({ type: z.literal('matching'), pairs: z.record(keySchema, keySchema) });
export const dragDropAnswerSchema = z.object({ type: z.literal('drag_drop'), placements: z.record(keySchema, keySchema) });
export const mapLabelAnswerSchema = z.object({ type: z.literal('map_label'), positions: z.record(keySchema, keySchema) });
export const tfngAnswerSchema = z.object({ type: z.literal('tfng'), values: z.record(keySchema, z.enum(['true', 'false', 'not_given'])) });
export const orderingAnswerSchema = z.object({ type: z.literal('ordering'), order: z.array(keySchema).max(15) });
export const dictationAnswerSchema = z.object({ type: z.literal('dictation'), text: z.string().max(4000) });
export const essayAnswerSchema = z.object({ type: z.literal('essay'), text: z.string().max(20_000) });
export const speakingAnswerSchema = z.object({ type: z.literal('speaking'), recording_id: uuidSchema });
export const handwritingAnswerSchema = z.object({
  type: z.literal('handwriting'),
  /** Danh sách nét, mỗi nét là mảng điểm [x, y] đã chuẩn hoá 0–1 */
  strokes: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).max(64),
  image_key: z.string().max(300).optional(),
});

// C2 – IELTS Reading/Listening: dạng gõ đáp án → `gaps` (id chỗ trống → chuỗi); nối → `pairs`; ngân hàng từ → `gaps` (id → mã từ);
// bản đồ/mặt bằng → `values` (mục → chữ cái vị trí)
const gapText = z.string().max(200);
const typedAnswer = <T extends string>(type: T) => z.object({ type: z.literal(type), gaps: z.record(keySchema, gapText) });
const pairsAnswer = <T extends string>(type: T) => z.object({ type: z.literal(type), pairs: z.record(keySchema, keySchema) });

export const matchingHeadingsAnswerSchema = pairsAnswer('matching_headings');
export const matchingInformationAnswerSchema = pairsAnswer('matching_information');
export const matchingFeaturesAnswerSchema = pairsAnswer('matching_features');
export const matchingSentenceEndingsAnswerSchema = pairsAnswer('matching_sentence_endings');
export const sentenceCompletionAnswerSchema = typedAnswer('sentence_completion');
export const summaryCompletionAnswerSchema = typedAnswer('summary_completion');
export const noteCompletionAnswerSchema = typedAnswer('note_completion');
export const tableCompletionAnswerSchema = typedAnswer('table_completion');
export const flowChartCompletionAnswerSchema = typedAnswer('flow_chart_completion');
export const formCompletionAnswerSchema = typedAnswer('form_completion');
export const shortAnswerAnswerSchema = typedAnswer('short_answer');
export const diagramLabellingAnswerSchema = typedAnswer('diagram_labelling');
export const summaryWordBankAnswerSchema = z.object({ type: z.literal('summary_word_bank'), gaps: z.record(keySchema, keySchema) });
export const planMapLabellingAnswerSchema = z.object({ type: z.literal('plan_map_labelling'), values: z.record(keySchema, keySchema) });

export const answerInputSchema = z.discriminatedUnion('type', [
  mcqSingleAnswerSchema,
  mcqMultiAnswerSchema,
  fillBlankAnswerSchema,
  matchingAnswerSchema,
  dragDropAnswerSchema,
  mapLabelAnswerSchema,
  tfngAnswerSchema,
  orderingAnswerSchema,
  dictationAnswerSchema,
  essayAnswerSchema,
  speakingAnswerSchema,
  handwritingAnswerSchema,
  matchingHeadingsAnswerSchema,
  matchingInformationAnswerSchema,
  matchingFeaturesAnswerSchema,
  matchingSentenceEndingsAnswerSchema,
  sentenceCompletionAnswerSchema,
  summaryCompletionAnswerSchema,
  noteCompletionAnswerSchema,
  tableCompletionAnswerSchema,
  flowChartCompletionAnswerSchema,
  formCompletionAnswerSchema,
  shortAnswerAnswerSchema,
  diagramLabellingAnswerSchema,
  summaryWordBankAnswerSchema,
  planMapLabellingAnswerSchema,
]);
export type AnswerInput = z.infer<typeof answerInputSchema>;
export type AnswerInputOf<T extends AnswerInput['type']> = Extract<AnswerInput, { type: T }>;

/** Bản đồ type → answer schema, dùng trong grade() để validate câu trả lời theo content.type */
export const answerInputSchemasByType = {
  mcq_single: mcqSingleAnswerSchema,
  mcq_multi: mcqMultiAnswerSchema,
  fill_blank: fillBlankAnswerSchema,
  matching: matchingAnswerSchema,
  drag_drop: dragDropAnswerSchema,
  map_label: mapLabelAnswerSchema,
  tfng: tfngAnswerSchema,
  ordering: orderingAnswerSchema,
  dictation: dictationAnswerSchema,
  essay: essayAnswerSchema,
  speaking: speakingAnswerSchema,
  handwriting: handwritingAnswerSchema,
  matching_headings: matchingHeadingsAnswerSchema,
  matching_information: matchingInformationAnswerSchema,
  matching_features: matchingFeaturesAnswerSchema,
  matching_sentence_endings: matchingSentenceEndingsAnswerSchema,
  sentence_completion: sentenceCompletionAnswerSchema,
  summary_completion: summaryCompletionAnswerSchema,
  note_completion: noteCompletionAnswerSchema,
  table_completion: tableCompletionAnswerSchema,
  flow_chart_completion: flowChartCompletionAnswerSchema,
  form_completion: formCompletionAnswerSchema,
  short_answer: shortAnswerAnswerSchema,
  diagram_labelling: diagramLabellingAnswerSchema,
  summary_word_bank: summaryWordBankAnswerSchema,
  plan_map_labelling: planMapLabellingAnswerSchema,
} as const satisfies Record<AnswerInput['type'], z.ZodTypeAny>;

/** Câu trả lời "trống" (chưa làm) – dùng khi auto-submit lúc hết giờ */
export function emptyAnswer(type: AnswerInput['type']): AnswerInput {
  switch (type) {
    case 'mcq_single':
      return { type, selected: null };
    case 'mcq_multi':
      return { type, selected: [] };
    case 'fill_blank':
      return { type, blanks: {} };
    case 'matching':
      return { type, pairs: {} };
    case 'drag_drop':
      return { type, placements: {} };
    case 'map_label':
      return { type, positions: {} };
    case 'tfng':
      return { type, values: {} };
    case 'ordering':
      return { type, order: [] };
    case 'dictation':
      return { type, text: '' };
    case 'essay':
      return { type, text: '' };
    case 'speaking':
      return { type, recording_id: '00000000-0000-0000-0000-000000000000' };
    case 'handwriting':
      return { type, strokes: [] };
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return { type, pairs: {} };
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
    case 'summary_word_bank':
      return { type, gaps: {} };
    case 'plan_map_labelling':
      return { type, values: {} };
  }
}

/** Kiểm tra câu trả lời có nội dung hay không (để đếm "đã trả lời") */
export function isAnswered(a: AnswerInput | null | undefined): boolean {
  if (!a) return false;
  switch (a.type) {
    case 'mcq_single':
      return a.selected !== null;
    case 'mcq_multi':
      return a.selected.length > 0;
    case 'fill_blank':
      return Object.values(a.blanks).some((v) => v.trim().length > 0);
    case 'matching':
      return Object.keys(a.pairs).length > 0;
    case 'drag_drop':
      return Object.keys(a.placements).length > 0;
    case 'map_label':
      return Object.keys(a.positions).length > 0;
    case 'tfng':
      return Object.keys(a.values).length > 0;
    case 'ordering':
      return a.order.length > 0;
    case 'dictation':
    case 'essay':
      return a.text.trim().length > 0;
    case 'speaking':
      return a.recording_id !== '00000000-0000-0000-0000-000000000000';
    case 'handwriting':
      return a.strokes.length > 0;
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return Object.values(a.pairs).some(Boolean);
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
    case 'summary_word_bank':
      return Object.values(a.gaps).some((v) => v.trim().length > 0);
    case 'plan_map_labelling':
      return Object.values(a.values).some(Boolean);
  }
}
