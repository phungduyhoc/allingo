import { gapIdsOf } from '@allingo/schemas/question/content';
import type { AnswerInput, PublicQuestionContent, QuestionPublic } from '@/lib/types';
import { asPublicContent } from '@/lib/types';
import { isAnswered } from './attempt-state';

/**
 * C3/S167 – đánh số câu hỏi liên tục trong đề ("Questions 1–40"): một câu catalog IELTS chiếm nhiều số (TFNG 5 mệnh đề = 5 câu,
 * "Choose TWO" = 2). Server trả `number_start/mark_count` (cần `answer_key` để đếm); thiếu → mỗi câu một số theo thứ tự (TOEIC/cũ).
 * Logic thuần để kiểm thử bằng Vitest.
 */

export interface MarkInfo {
  /** Số đầu tiên của câu catalog trong đề */
  start: number;
  /** Số mục đánh số (≥ 1) */
  count: number;
}

/** Số của từng câu (đã sắp theo thứ tự làm bài): ưu tiên server, thiếu → cộng dồn `mark_count` (mặc định 1) */
export function markInfoOf(questions: readonly Pick<QuestionPublic, 'number_start' | 'mark_count'>[]): MarkInfo[] {
  let next = 1;
  return questions.map((q) => {
    const count = typeof q.mark_count === 'number' && q.mark_count >= 1 ? q.mark_count : 1;
    const start = typeof q.number_start === 'number' && q.number_start >= 1 ? q.number_start : next;
    next = start + count;
    return { start, count };
  });
}

/** Tổng số câu hỏi (mục) của đề */
export function totalMarks(infos: readonly MarkInfo[]): number {
  return infos.reduce((n, m) => Math.max(n, m.start + m.count - 1), 0);
}

/** "7" hoặc "7–11" */
export function markLabel(m: MarkInfo): string {
  return m.count > 1 ? `${m.start}–${m.start + m.count - 1}` : String(m.start);
}

/** Đề có câu chiếm nhiều số → hiển thị theo mục (lưới/tiến độ/nhãn "Câu 1–5") */
export function hasMultiMarks(infos: readonly MarkInfo[]): boolean {
  return infos.some((m) => m.count > 1);
}

/**
 * Khoá các mục đánh số theo thứ tự hiển thị (để tô "đã trả lời" từng số và focus đúng ô): chỗ trống `{{id}}`, mệnh đề TFNG,
 * mục nối (trừ dòng ví dụ của matching headings), địa điểm bản đồ. Dạng một mục → `[]` (cả câu là một số).
 */
export function subItemKeys(content: PublicQuestionContent | null): string[] {
  if (!content) return [];
  switch (content.type) {
    case 'tfng':
      return content.statements.map((s) => s.key);
    case 'fill_blank':
      return content.blanks.map((b) => b.id);
    case 'matching':
      return content.left.map((i) => i.key);
    case 'matching_headings':
      return content.items.filter((i) => i.key !== content.example?.item).map((i) => i.key);
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
    case 'plan_map_labelling':
      return content.items.map((i) => i.key);
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
    case 'summary_word_bank':
      return gapIdsOf(content as unknown as Parameters<typeof gapIdsOf>[0]);
    default:
      return [];
  }
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** Giá trị đã nhập của từng mục (theo khoá) từ câu trả lời */
function valuesOf(answer: AnswerInput | null): Record<string, unknown> | null {
  if (!answer) return null;
  const a = answer as unknown as Record<string, unknown>;
  for (const field of ['values', 'pairs', 'blanks', 'gaps'] as const) {
    const v = a[field];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

/**
 * Đã trả lời từng mục đánh số (độ dài = `count`): mục theo khoá (`subItemKeys`) khi khớp số mục; "Choose TWO" → mục thứ k đã
 * trả lời khi đã chọn > k lựa chọn; còn lại cả câu một trạng thái.
 */
export function marksAnswered(content: PublicQuestionContent | null, answer: AnswerInput | null, count: number): boolean[] {
  const whole = isAnswered(answer);
  if (count <= 1) return [whole];
  if (content?.type === 'mcq_multi') {
    const n = answer?.type === 'mcq_multi' ? answer.selected.length : 0;
    return Array.from({ length: count }, (_, k) => n > k);
  }
  const keys = subItemKeys(content);
  if (keys.length === count) {
    const values = valuesOf(answer);
    return keys.map((k) => filled(values?.[k]));
  }
  return Array.from({ length: count }, () => whole);
}

export interface MarkGridItem {
  /** Khoá ổn định: `${question_id}` hoặc `${question_id}:${k}` */
  key: string;
  questionId: string;
  /** Chỉ số câu catalog trong danh sách đã sắp xếp */
  index: number;
  /** Khoá mục trong câu (focus ô tương ứng) – null khi câu một số hoặc không xác định được */
  subKey: string | null;
  number: number;
  answered: boolean;
  flagged: boolean;
  sectionCode: string;
}

/** Lưới câu theo SỐ (mỗi mục một ô); câu đánh dấu → mọi số của câu đều mang cờ (cờ lưu theo câu catalog) */
export function markGridItems(
  questions: readonly QuestionPublic[],
  infos: readonly MarkInfo[],
  answers: Readonly<Record<string, AnswerInput | null | undefined>>,
  flags: Readonly<Record<string, boolean | undefined>>,
): MarkGridItem[] {
  return questions.flatMap((q, index) => {
    const info = infos[index] ?? { start: index + 1, count: 1 };
    const content = asPublicContent(q.content);
    const answered = marksAnswered(content, answers[q.question_id] ?? null, info.count);
    const keys = subItemKeys(content);
    return Array.from({ length: info.count }, (_, k) => ({
      key: info.count > 1 ? `${q.question_id}:${k}` : q.question_id,
      questionId: q.question_id,
      index,
      subKey: info.count > 1 && keys.length === info.count ? keys[k]! : null,
      number: info.start + k,
      answered: answered[k] ?? false,
      flagged: !!flags[q.question_id],
      sectionCode: q.section_code,
    }));
  });
}

/** Ô nhập/chọn của một mục trong khối câu (focus khi chọn số ở lưới) */
export function subItemSelector(questionId: string, subKey: string): string {
  const k = CSS.escape(subKey);
  return `#qblock-${CSS.escape(questionId)} [data-gap="${k}"], #qblock-${CSS.escape(questionId)} [data-sub="${k}"]`;
}
