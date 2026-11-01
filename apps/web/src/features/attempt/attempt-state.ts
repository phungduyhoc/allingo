import { emptyAnswer, isAnswered } from '@allingo/schemas';
import type { AnswerInput, Attempt, QuestionPublic } from '@/lib/types';
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
 * (trường hợp tải lại trang khi offline hoặc trước khi debounce kịp flush).
 */
export function initialAttemptState(attempt: Attempt, localPending: DraftEntry[]): AttemptUiState {
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
  const currentId = typeof attempt.ui_state?.current_question_id === 'string' ? attempt.ui_state.current_question_id : null;
  let currentIndex = currentId ? attempt.questions.findIndex((q) => q.question_id === currentId) : -1;
  if (currentIndex < 0) currentIndex = 0;
  return { answers, flags, currentIndex };
}

export function answerOrEmpty(q: QuestionPublic, answers: Record<string, AnswerInput>): AnswerInput {
  return answers[q.question_id] ?? emptyAnswer(q.question_type);
}

export function countUnanswered(questions: QuestionPublic[], answers: Record<string, AnswerInput>): number {
  return questions.filter((q) => !isAnswered(answers[q.question_id])).length;
}

export { isAnswered, emptyAnswer };
