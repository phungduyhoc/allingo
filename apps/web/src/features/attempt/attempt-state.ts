import { emptyAnswer, isAnswered } from '@allingo/schemas/question/answer';
import type { AnswerInput, Attempt, AttemptAnswersPut, AttemptMode, QuestionPublic } from '@/lib/types';
import type { DraftEntry } from './draft-queue';

export interface AttemptUiState {
  answers: Record<string, AnswerInput>;
  flags: Record<string, boolean>;
  currentIndex: number;
}

export type AttemptAction = { type: 'answer'; questionId: string; answer: AnswerInput } | { type: 'flag'; questionId: string; flagged: boolean } | { type: 'goto'; index: number };

export function attemptReducer(state: AttemptUiState, action: AttemptAction): AttemptUiState {
  switch (action.type) {
    case 'answer':
      return { ...state, answers: { ...state.answers, [action.questionId]: action.answer } };
    case 'flag':
      return { ...state, flags: { ...state.flags, [action.questionId]: action.flagged } };
    case 'goto':
      return { ...state, currentIndex: action.index };
  }
}

/**
 * Khôi phục trạng thái từ `draft_answers` + `ui_state` của server, rồi đè bằng nháp cục bộ chưa gửi
 * (IndexedDB – tải lại trang khi offline hoặc trước khi debounce kịp flush). `localUi` là câu đang xem chưa gửi được.
 */
export function initialAttemptState(attempt: Attempt, localPending: DraftEntry[], localUi?: AttemptAnswersPut['ui_state']): AttemptUiState {
  const answers: Record<string, AnswerInput> = {};
  const flags: Record<string, boolean> = {};
  for (const d of attempt.draft_answers) {
    answers[d.question_id] = d.answer;
    if (d.flagged) flags[d.question_id] = true;
  }
  for (const d of localPending) {
    answers[d.question_id] = d.answer;
    if (d.flagged !== undefined) flags[d.question_id] = d.flagged;
  }
  const serverId = typeof attempt.ui_state?.current_question_id === 'string' ? attempt.ui_state.current_question_id : null;
  const currentId = localUi?.current_question_id ?? serverId;
  const ordered = sortQuestions(attempt.questions);
  let currentIndex = currentId ? ordered.findIndex((q) => q.question_id === currentId) : -1;
  if (currentIndex < 0) currentIndex = 0;
  return { answers, flags, currentIndex };
}

export function sortQuestions(questions: QuestionPublic[]): QuestionPublic[] {
  return [...questions].sort((a, b) => a.order_no - b.order_no);
}

export function answerOrEmpty(q: QuestionPublic, answers: Record<string, AnswerInput>): AnswerInput {
  return answers[q.question_id] ?? emptyAnswer(q.question_type);
}

export function countUnanswered(questions: QuestionPublic[], answers: Record<string, AnswerInput>): number {
  return questions.filter((q) => !isAnswered(answers[q.question_id])).length;
}

/** Đặc điểm theo chế độ làm bài */
export interface ModeTraits {
  /** Server trả `feedback` (đáp án + giải thích ngay sau khi trả lời) – practice/drill */
  feedback: boolean;
  /** Quy tắc thi: audio phát một lần, không xem đáp án – exam/diagnostic/timed_drill */
  examLike: boolean;
}

export function modeTraits(mode: AttemptMode): ModeTraits {
  const feedback = mode === 'practice' || mode === 'drill';
  return { feedback, examLike: !feedback };
}

/** Một Part (section) trong thứ tự câu: [start, end] là chỉ số trong danh sách câu đã sắp xếp */
export interface SectionRange {
  code: string;
  start: number;
  end: number;
}

/** Các Part theo thứ tự xuất hiện (mỗi Part là một đoạn liên tiếp; Part lặp lại không liền kề được tách đoạn) */
export function sectionRanges(questions: QuestionPublic[]): SectionRange[] {
  const out: SectionRange[] = [];
  questions.forEach((q, i) => {
    const last = out[out.length - 1];
    if (last && last.code === q.section_code) last.end = i;
    else out.push({ code: q.section_code, start: i, end: i });
  });
  return out;
}

export function sectionIndexOf(ranges: SectionRange[], questionIndex: number): number {
  return ranges.findIndex((r) => questionIndex >= r.start && questionIndex <= r.end);
}

/** Nhóm câu dùng chung một đoạn văn (Part 6–7): cùng `group_key`, hoặc cùng passage.id, liền kề và cùng Part */
export interface QuestionGroup {
  key: string;
  start: number;
  end: number;
}

const groupKeyOf = (q: QuestionPublic): string | null => (q.passage ? (q.group_key ?? `passage:${q.passage.id}`) : null);

export function questionGroups(questions: QuestionPublic[]): QuestionGroup[] {
  const out: QuestionGroup[] = [];
  questions.forEach((q, i) => {
    const key = groupKeyOf(q);
    const last = out[out.length - 1];
    if (key && last && last.key === key && questions[last.end]?.section_code === q.section_code) last.end = i;
    else out.push({ key: key ?? `single:${q.question_id}`, start: i, end: i });
  });
  return out;
}

export function groupOf(groups: QuestionGroup[], questionIndex: number): QuestionGroup | null {
  return groups.find((g) => questionIndex >= g.start && questionIndex <= g.end) ?? null;
}

export { isAnswered, emptyAnswer };
