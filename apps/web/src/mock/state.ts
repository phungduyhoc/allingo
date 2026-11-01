import type { AnswerInput, AttemptMode, AttemptResult, Enrollment, Explanation, User } from '@allingo/schemas';

/** Trạng thái "máy chủ" giả lập, lưu localStorage để tải lại trang vẫn giữ phiên/nháp */

export interface MockUserRecord extends User {
  password?: string;
  guest_token?: string;
}

export interface MockAnswerRecord {
  answer: AnswerInput;
  time_spent_ms?: number;
  flagged?: boolean;
}

export interface MockAttemptRecord {
  id: string;
  user_id: string;
  test_set_id: string;
  program: string;
  mode: AttemptMode;
  status: 'in_progress' | 'submitted' | 'graded';
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  answers: Record<string, MockAnswerRecord>;
  section_elapsed_sec: Record<string, number>;
  ui_state: Record<string, unknown>;
  events: { type: string; at: string; meta?: Record<string, unknown> }[];
  result: AttemptResult | null;
  /** Lượt luyện (GET /practice/questions): tập câu chọn từ nhiều đề, thay cho toàn bộ câu của test_set_id */
  question_ids?: string[];
}

export interface MockState {
  users: Record<string, MockUserRecord>;
  sessionUserId: string | null;
  attempts: Record<string, MockAttemptRecord>;
  enrollments: Record<string, Enrollment[]>;
  explanations: Record<string, Explanation>;
  /** usage[userId][feature][YYYY-MM-DD] = count */
  usage: Record<string, Record<string, Record<string, number>>>;
  xp: Record<string, number>;
}

const KEY = 'allingo.mock.v1';

export function emptyState(): MockState {
  return { users: {}, sessionUserId: null, attempts: {}, enrollments: {}, explanations: {}, usage: {}, xp: {} };
}

export function loadState(): MockState {
  try {
    if (typeof window === 'undefined') return emptyState();
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<MockState>) };
  } catch {
    return emptyState();
  }
}

export function saveState(state: MockState): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* bỏ qua khi localStorage không khả dụng */
  }
}

export function resetState(): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
