import { type DiagnosticStep } from '@allingo/schemas/api/learning-plan';
import { isAnswered, type AnswerInput } from '@allingo/schemas/question/answer';

/**
 * Máy trạng thái màn chẩn đoán (thuần, có test): một câu mỗi màn, KHÔNG hiện đúng/sai từng câu (`last_correct` bị bỏ qua).
 *
 * idle → loading (POST /me/diagnostic | GET …/next) → question ⇄ submitting (POST …/next) → … → done (step.done + result)
 * - 409 khi gửi (câu đang chờ đã đổi ở tab khác / bấm đúp) → `conflict` → loading → tải lại câu đang chờ (GET), giữ đáp án nếu
 *   vẫn là câu cũ;
 * - lỗi mạng/khác → giữ câu + đáp án, hiện lỗi để thử lại (không mất lựa chọn).
 */

export type DiagnosticPhase = 'idle' | 'loading' | 'question' | 'submitting' | 'done' | 'error';

export interface DiagnosticUiState {
  phase: DiagnosticPhase;
  step: DiagnosticStep | null;
  answer: AnswerInput | null;
  /** Thời điểm câu hiện tại xuất hiện (ms) – tính `time_spent_ms` */
  shownAt: number | null;
  error: unknown;
  /** Số lần đồng bộ lại sau 409 (chống lặp vô hạn) */
  resyncs: number;
}

export type DiagnosticAction =
  | { type: 'load' }
  | { type: 'loaded'; step: DiagnosticStep; at: number }
  | { type: 'select'; answer: AnswerInput }
  | { type: 'submit' }
  | { type: 'conflict' }
  | { type: 'failed'; error: unknown };

export const initialDiagnosticState: DiagnosticUiState = { phase: 'idle', step: null, answer: null, shownAt: null, error: null, resyncs: 0 };

export const MAX_RESYNCS = 3;

/** Id câu đang chờ của bước (null khi đã xong / chưa có) */
export function currentQuestionId(step: DiagnosticStep | null): string | null {
  const q = step?.next_question as { question_id?: unknown } | null | undefined;
  return typeof q?.question_id === 'string' ? q.question_id : null;
}

export function diagnosticReducer(state: DiagnosticUiState, action: DiagnosticAction): DiagnosticUiState {
  switch (action.type) {
    case 'load':
      return { ...state, phase: 'loading', error: null };
    case 'loaded': {
      const { step } = action;
      if (step.done) return { ...state, phase: 'done', step, answer: null, shownAt: null, error: null };
      const sameQuestion = currentQuestionId(step) !== null && currentQuestionId(step) === currentQuestionId(state.step);
      return {
        ...state,
        phase: 'question',
        step,
        answer: sameQuestion ? state.answer : null,
        shownAt: sameQuestion && state.shownAt !== null ? state.shownAt : action.at,
        error: null,
        // Sang câu mới → đếm lại số lần đồng bộ
        resyncs: sameQuestion ? state.resyncs : 0,
      };
    }
    case 'select':
      if (state.phase !== 'question') return state;
      return { ...state, answer: action.answer, error: null };
    case 'submit':
      if (state.phase !== 'question' || !isAnswered(state.answer) || !currentQuestionId(state.step)) return state;
      return { ...state, phase: 'submitting', error: null };
    case 'conflict':
      return { ...state, phase: 'loading', resyncs: state.resyncs + 1, error: null };
    case 'failed':
      // Đã có câu → quay lại câu (giữ đáp án) để thử lại; chưa có gì → màn lỗi
      return { ...state, phase: state.step && !state.step.done ? 'question' : 'error', error: action.error };
    default:
      return state;
  }
}

/** Thân POST /me/diagnostic/{id}/next cho câu đang chờ (null khi chưa chọn) */
export function answerBody(state: DiagnosticUiState, now: number): { question_id: string; answer: AnswerInput; time_spent_ms?: number } | null {
  const qid = currentQuestionId(state.step);
  if (!qid || !isAnswered(state.answer)) return null;
  const spent = state.shownAt !== null ? Math.max(0, Math.min(3_600_000, Math.round(now - state.shownAt))) : undefined;
  return { question_id: qid, answer: state.answer!, ...(spent !== undefined ? { time_spent_ms: spent } : {}) };
}

/** Tiến độ hiển thị: câu thứ n / dự kiến; planned có thể tăng khi gặp nhóm passage dài hơn trung bình */
export function diagnosticProgress(step: DiagnosticStep | null): { number: number; planned: number; pct: number } {
  if (!step) return { number: 0, planned: 0, pct: 0 };
  const planned = Math.max(step.progress.planned, step.progress.served, 1);
  const answered = step.progress.answered;
  const number = step.done ? answered : Math.min(planned, answered + 1);
  return { number, planned, pct: Math.max(0, Math.min(100, Math.round((answered / planned) * 100))) };
}
