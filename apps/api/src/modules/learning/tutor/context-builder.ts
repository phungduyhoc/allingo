/**
 * ContextBuilder cho `tutor_chat` (S6) – thuần, không I/O để unit test:
 * - Ghép biến template: mục tiêu/ngày thi (enrollment), tóm tắt attempt (số liệu + thẻ summarize_attempt), câu đang xem,
 *   5 lỗi gần nhất, lịch sử hội thoại; cắt theo ngân sách token (ước lượng ký tự/4).
 * - Câu đang xem: KHÔNG có đáp án/giải thích khi `reveal = false` (attempt đó in_progress – exam luôn; practice khi chưa trả lời).
 * - Nội dung người học (tin nhắn, lượt user trong lịch sử) bọc `<user_input>`; dữ liệu hệ thống nằm trong `<data>` của template.
 * - Không có họ tên/email/số điện thoại/user_id trong biến (CLAUDE.md §5.4).
 */
import { wrapUserInput } from '../../ai-gateway/index.js';

/** Ước lượng token: ~4 ký tự/token (đủ cho ngân sách; không cần tokenizer theo model) */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);
const tok = (v: unknown): number => estimateTokens(typeof v === 'string' ? v : JSON.stringify(v ?? null));

const cut = (s: string | null | undefined, n: number): string | null => {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
};

/** Bỏ thẻ phân vùng prompt khỏi văn bản (chống thoát khỏi <user_input>/<data>) */
export const stripPromptTags = (s: string): string => s.replace(/<\/?\s*(user_input|data|system)\s*>/gi, '');

export interface TutorGoal {
  target_score: number | null;
  target_level: string | null;
  exam_date: string | null;
  current_estimate: number | null;
}

export interface TutorAttemptSummary {
  attempt_id: string;
  mode: string;
  status: string;
  test_set_title: string | null;
  question_count: number;
  answered_count: number;
  scaled_score: number | null;
  raw_score: number | null;
  by_section: Record<string, { correct: number; total: number }> | null;
  weak_areas: string[];
}

export interface TutorSystemSummary {
  headline?: string;
  weakest?: { area?: string; evidence?: string };
  next_tasks?: Array<{ task_type?: string; ref_hint?: string; reason?: string }>;
  trend_note?: string | null;
}

export interface TutorReferencedQuestion {
  question_version_id: string;
  section_code: string;
  question_type: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  passage_excerpt: string | null;
  /** Được phép đưa đáp án/giải thích vào ngữ cảnh */
  reveal: boolean;
  correct_option: string | null;
  explanation: string | null;
  learner_choice: string | null;
}

export interface TutorMistake {
  section_code: string;
  question_type: string;
  subskills: string[];
  stem_excerpt: string;
  chosen: string | null;
  correct: string | null;
}

export interface TutorTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface TutorContextInput {
  program: string;
  entitlement: 'free' | 'pro';
  examMode: boolean;
  goal: TutorGoal | null;
  attempt: TutorAttemptSummary | null;
  systemSummary: TutorSystemSummary | null;
  question: TutorReferencedQuestion | null;
  mistakes: TutorMistake[];
  /** Cũ → mới */
  history: TutorTurn[];
  message: string;
  allowedActions: string[];
  /** Ngân sách token cho phần ngữ cảnh + lịch sử (không gồm system prompt và tin nhắn hiện tại) */
  budgetTokens: number;
}

export interface TutorContextResult {
  variables: Record<string, unknown>;
  /** Token ước lượng của phần đã đưa vào (ngữ cảnh + lịch sử + tin nhắn) */
  tokens: number;
  /** Phần bị cắt/bỏ do ngân sách (để log/đo) */
  trimmed: string[];
  /** Khoá <data> có nội dung – đối chiếu grounded_on */
  provided: string[];
}

const MAX_HISTORY_TURNS = 12;
const TURN_CHARS = 600;
const PASSAGE_CHARS = 900;
const STEM_CHARS = 600;

/** Câu đang xem → object đưa vào `referenced_question`; reveal = false → không có đáp án/giải thích/lựa chọn của người học */
export function referencedQuestionData(q: TutorReferencedQuestion, opts: { passageChars?: number } = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    question_version_id: q.question_version_id,
    section: q.section_code,
    type: q.question_type,
    stem: cut(q.stem, STEM_CHARS),
    options: q.options.map((o) => ({ key: o.key, text: cut(o.text, 200) })),
  };
  if (q.passage_excerpt && (opts.passageChars ?? PASSAGE_CHARS) > 0) base.passage_excerpt = cut(q.passage_excerpt, opts.passageChars ?? PASSAGE_CHARS);
  if (q.reveal) {
    base.correct_option = q.correct_option;
    if (q.explanation) base.author_explanation = cut(q.explanation, 600);
    if (q.learner_choice) base.learner_choice = q.learner_choice;
  } else {
    base.answer_hidden = 'attempt in progress – do not reveal or hint the answer';
  }
  return base;
}

export function buildTutorContext(input: TutorContextInput): TutorContextResult {
  const trimmed: string[] = [];
  const provided: string[] = [];
  const message = stripPromptTags(input.message).trim();
  let budget = input.budgetTokens;

  const goal = input.goal;
  const fixed: Record<string, unknown> = {
    program: input.program,
    target_score: goal?.target_score ?? goal?.target_level ?? null,
    exam_date: goal?.exam_date ?? null,
    current_estimate: goal?.current_estimate ?? null,
    entitlement: input.entitlement,
    exam_mode: String(input.examMode),
    proactive_allowed: 'false',
    allowed_actions: input.allowedActions,
    submission_summary: null,
    today_plan: null,
  };
  if (goal && (goal.target_score !== null || goal.target_level || goal.exam_date)) provided.push('goal');
  budget -= tok(fixed);

  // 1) Câu đang xem (ưu tiên cao nhất) – co passage nếu thiếu ngân sách
  let referenced: Record<string, unknown> | null = null;
  if (input.question) {
    for (const chars of [PASSAGE_CHARS, 400, 0]) {
      const r = referencedQuestionData(input.question, { passageChars: chars });
      if (tok(r) <= budget || chars === 0) {
        referenced = r;
        if (chars < PASSAGE_CHARS && input.question.passage_excerpt) trimmed.push(`referenced_question.passage(${chars})`);
        break;
      }
    }
    if (referenced && tok(referenced) <= budget) {
      budget -= tok(referenced);
      provided.push('referenced_question');
    } else {
      // vẫn giữ đề + phương án tối thiểu
      referenced = { question_version_id: input.question.question_version_id, section: input.question.section_code, stem: cut(input.question.stem, 200), ...(input.question.reveal ? {} : { answer_hidden: 'attempt in progress' }) };
      budget -= tok(referenced);
      trimmed.push('referenced_question.minimal');
      provided.push('referenced_question');
    }
  }

  // 2) Tóm tắt attempt (số liệu + thẻ tóm tắt)
  let attemptSummary: Record<string, unknown> | null = null;
  if (input.attempt || input.systemSummary) {
    const a = input.attempt;
    const full: Record<string, unknown> = {
      ...(a
        ? { mode: a.mode, status: a.status, test: a.test_set_title, questions: a.question_count, answered: a.answered_count, raw_score: a.raw_score, estimated_score: a.scaled_score, by_section: a.by_section, weak_areas: a.weak_areas }
        : {}),
      ...(input.systemSummary ? { progress_summary: { headline: input.systemSummary.headline, weakest: input.systemSummary.weakest, next: input.systemSummary.next_tasks?.slice(0, 2) } } : {}),
    };
    const compact: Record<string, unknown> = a ? { mode: a.mode, status: a.status, estimated_score: a.scaled_score, weak_areas: a.weak_areas.slice(0, 3) } : { progress_summary: input.systemSummary?.headline ?? null };
    if (tok(full) <= budget) attemptSummary = full;
    else if (tok(compact) <= budget) {
      attemptSummary = compact;
      trimmed.push('attempt_summary.compact');
    } else trimmed.push('attempt_summary');
    if (attemptSummary) {
      budget -= tok(attemptSummary);
      provided.push('latest_attempt_summary');
    }
  }

  // 3) Lỗi gần đây (≤ 5, bỏ dần từ cũ nhất)
  const errors: Array<Record<string, unknown>> = [];
  for (const m of input.mistakes.slice(0, 5)) {
    const item = { section: m.section_code, type: m.question_type, subskills: m.subskills.slice(0, 3), stem: cut(m.stem_excerpt, 160), chosen: m.chosen, correct: m.correct };
    if (tok(item) + 2 > budget) {
      trimmed.push(`recurring_errors[${errors.length}..]`);
      break;
    }
    budget -= tok(item) + 2;
    errors.push(item);
  }
  if (errors.length) provided.push('recurring_errors_30d');

  // 4) Lịch sử: giữ lượt MỚI nhất trước, cắt từng lượt ≤ 600 ký tự; lượt user bọc <user_input>
  const turns: Array<{ role: string; text: string }> = [];
  const recent = input.history.slice(-MAX_HISTORY_TURNS).reverse();
  if (input.history.length > MAX_HISTORY_TURNS) trimmed.push(`history.older(${input.history.length - MAX_HISTORY_TURNS})`);
  for (const t of recent) {
    const clean = cut(stripPromptTags(t.text).trim(), TURN_CHARS) ?? '';
    const text = t.role === 'user' ? wrapUserInput(clean) : clean;
    const cost = estimateTokens(text) + 3;
    if (cost > budget) {
      trimmed.push(`history.dropped(${recent.length - turns.length})`);
      break;
    }
    budget -= cost;
    turns.push({ role: t.role, text });
  }
  turns.reverse();

  const variables: Record<string, unknown> = {
    ...fixed,
    attempt_summary: attemptSummary,
    recurring_errors: errors,
    referenced_question: referenced,
    history: turns,
    message,
  };
  return { variables, tokens: input.budgetTokens - budget + estimateTokens(message), trimmed, provided };
}
