import { gapIdsOf, type QuestionContent } from './content.js';
import type { GradeResult } from './grade.js';

/**
 * C1/C2 – số "câu hỏi" (điểm thô) mà một câu catalog đóng góp. TOEIC đếm theo câu (registry `marking = per_question` – luôn 1);
 * IELTS/JLPT/HSK đếm theo mục đánh số (`per_item`): câu TFNG 5 mệnh đề = 5 câu hỏi, "Choose TWO letters" = 2 câu hỏi, câu điền
 * 4 chỗ trống = 4 câu hỏi. Dùng để quy đổi band IELTS (raw /40) ở @allingo/scoring.
 */
export function markCount(c: QuestionContent): number {
  switch (c.type) {
    case 'mcq_single':
    case 'ordering':
    case 'dictation':
    case 'essay':
    case 'speaking':
    case 'handwriting':
      return 1;
    case 'mcq_multi':
      // all_or_nothing: một câu hỏi; partial ("Choose TWO") – mỗi lựa chọn đúng một câu hỏi
      return c.answer_key.scoring === 'partial' ? (c.select_count ?? c.answer_key.correct.length) : 1;
    case 'fill_blank':
      return c.blanks.length;
    case 'matching':
      return Math.max(1, Object.keys(c.answer_key.pairs).length);
    case 'drag_drop':
      return Math.max(1, Object.keys(c.answer_key.placements).length);
    case 'map_label':
      return Math.max(1, Object.keys(c.answer_key.positions).length);
    case 'tfng':
      return Math.max(1, c.statements.length);
    case 'matching_headings':
      return Math.max(1, c.items.filter((i) => i.key !== c.example?.item).length);
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
    case 'plan_map_labelling':
      return Math.max(1, c.items.length);
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
    case 'summary_word_bank':
      return Math.max(1, gapIdsOf(c).length);
  }
}

export interface MarkResult {
  /** Số câu hỏi đúng (nguyên – partial làm tròn theo tỷ lệ) */
  earned: number;
  max: number;
}

/**
 * Điểm thô theo mục từ kết quả grade(): `per_item` → round(score × markCount); `per_question` → 1 câu. Dạng chấm thủ công
 * (essay/speaking) → earned 0 (điểm từ module grading).
 */
export function marksOf(c: QuestionContent, g: Pick<GradeResult, 'score' | 'is_correct'>, marking: 'per_question' | 'per_item'): MarkResult {
  if (marking === 'per_question') return { earned: g.is_correct ? 1 : 0, max: 1 };
  const max = markCount(c);
  const earned = g.score === null ? 0 : Math.min(max, Math.round(g.score * max));
  return { earned, max };
}

export interface MarkNumber {
  /** Số câu hỏi đầu tiên của câu catalog trong đề ("Questions 1–40" – S167) */
  number_start: number;
  /** Số câu hỏi (mục đánh số) câu catalog chiếm: TOEIC luôn 1, IELTS = markCount */
  mark_count: number;
}

/**
 * C3/S167 – đánh số câu hỏi liên tục trong đề theo thứ tự làm bài: câu catalog thứ i bắt đầu từ 1 + tổng mục của các câu trước.
 * Cần đáp án (markCount đọc `answer_key` với nối/mcq_multi) → server tính rồi trả `number_start/mark_count` cho client.
 */
export function numberMarks(contents: readonly QuestionContent[], marking: 'per_question' | 'per_item'): MarkNumber[] {
  let next = 1;
  return contents.map((c) => {
    const mark_count = marking === 'per_item' ? markCount(c) : 1;
    const n = { number_start: next, mark_count };
    next += mark_count;
    return n;
  });
}
