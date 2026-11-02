import type { AnswerInput, AttemptAiDiagnosis, AttemptMode, AttemptResult, Enrollment, Explanation, User } from '@allingo/schemas';

/** Trạng thái "máy chủ" giả lập, lưu localStorage để tải lại trang vẫn giữ phiên/nháp */

export interface MockUserRecord extends User {
  password?: string;
  guest_token?: string;
  /** Gói (mock): 'free' mặc định; tài khoản demo learner_pro@allingo.dev là 'monthly' (Pro) */
  plan?: 'free' | 'monthly';
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
  /** Số lần audio_started theo question_id (Sprint 4) */
  audio_plays?: Record<string, number>;
  /** Chẩn đoán AI đã lưu (S5 – như score_breakdown.ai_diagnosis của API) */
  ai_diagnosis?: Omit<AttemptAiDiagnosis, 'cached' | 'attempt_id'>;
}

export interface MockState {
  users: Record<string, MockUserRecord>;
  sessionUserId: string | null;
  attempts: Record<string, MockAttemptRecord>;
  enrollments: Record<string, Enrollment[]>;
  explanations: Record<string, Explanation>;
  /** usage[userId][feature][kỳ theo giờ VN: YYYY-MM-DD | YYYY-MM | all] = count */
  usage: Record<string, Record<string, Record<string, number>>>;
  xp: Record<string, number>;
  /** ai_tasks giả lập: chủ tác vụ (POST /ai/feedback chỉ cho chủ) */
  aiTasks: Record<string, { user_id: string; task: string }>;
  /** ai.feedback giả lập theo ai_task_id */
  feedback: Record<string, { id: string; user_id: string; rating: string; comment: string | null }>;
  /** Số dư credit AI theo user */
  credits: Record<string, number>;
}

const KEY = 'allingo.mock.v1';

export function emptyState(): MockState {
  return { users: {}, sessionUserId: null, attempts: {}, enrollments: {}, explanations: {}, usage: {}, xp: {}, aiTasks: {}, feedback: {}, credits: {} };
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
