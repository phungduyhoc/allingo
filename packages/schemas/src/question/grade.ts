import type { AnswerInput } from './answer.js';
import { AUTO_GRADABLE_TYPES, type QuestionContent } from './content.js';

/** Kết quả chấm một câu: score ∈ [0, 1] × points do test_set_items.points quyết định */
export interface GradeResult {
  /** null khi dạng câu không chấm tự động (essay/speaking/handwriting) */
  is_correct: boolean | null;
  /** 0–1 */
  score: number;
  /** Chi tiết theo phần (từng blank/pair/statement) để Review tô màu */
  details?: Record<string, boolean>;
  /** Đáp án đúng đã chuẩn hoá để trả trong Review (không dùng trước khi nộp) */
  correct_answer: unknown;
}

const normalizeText = (s: string, caseSensitive = false): string => {
  const t = s.normalize('NFC').replace(/\s+/g, ' ').trim();
  return caseSensitive ? t : t.toLocaleLowerCase();
};

const stripPunct = (s: string) => s.replace(/[\p{P}\p{S}]/gu, ' ');

/** Khoảng cách Levenshtein đơn giản cho token ngắn */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

const ratio = (correct: number, total: number) => (total === 0 ? 0 : Math.round((correct / total) * 1000) / 1000);

const mapResult = (expected: Record<string, string>, given: Record<string, string>): GradeResult => {
  const keys = Object.keys(expected);
  const details: Record<string, boolean> = {};
  let correct = 0;
  for (const k of keys) {
    const ok = given[k] !== undefined && given[k] === expected[k];
    details[k] = ok;
    if (ok) correct++;
  }
  const score = ratio(correct, keys.length);
  return { is_correct: correct === keys.length, score, details, correct_answer: expected };
};

/**
 * Chấm tự động theo nội dung câu hỏi. Câu trả lời sai kiểu (type không khớp) → 0 điểm.
 * Hàm thuần, không I/O – dùng ở API (submit) và có thể tái dùng ở CMS để kiểm tra đáp án mẫu.
 */
export function grade(content: QuestionContent, answer: AnswerInput | null | undefined): GradeResult {
  if (!AUTO_GRADABLE_TYPES.has(content.type)) {
    return { is_correct: null, score: 0, correct_answer: null };
  }
  if (!answer || answer.type !== content.type) {
    return { ...gradeEmpty(content), score: 0 };
  }

  switch (content.type) {
    case 'mcq_single': {
      const a = answer as Extract<AnswerInput, { type: 'mcq_single' }>;
      const ok = a.selected === content.answer_key.correct;
      return { is_correct: ok, score: ok ? 1 : 0, correct_answer: content.answer_key.correct };
    }
    case 'mcq_multi': {
      const a = answer as Extract<AnswerInput, { type: 'mcq_multi' }>;
      const correctSet = new Set(content.answer_key.correct);
      const selected = new Set(a.selected);
      const hits = [...selected].filter((k) => correctSet.has(k)).length;
      const wrong = selected.size - hits;
      const allCorrect = hits === correctSet.size && wrong === 0;
      if (content.answer_key.scoring === 'all_or_nothing') {
        return { is_correct: allCorrect, score: allCorrect ? 1 : 0, correct_answer: content.answer_key.correct };
      }
      const score = Math.max(0, ratio(hits - wrong, correctSet.size));
      return { is_correct: allCorrect, score, correct_answer: content.answer_key.correct };
    }
    case 'fill_blank': {
      const a = answer as Extract<AnswerInput, { type: 'fill_blank' }>;
      const details: Record<string, boolean> = {};
      let correct = 0;
      for (const blank of content.blanks) {
        const given = a.blanks[blank.id] ?? '';
        const g = normalizeText(given, blank.case_sensitive);
        const wordsOk = blank.max_words ? g.split(' ').filter(Boolean).length <= blank.max_words : true;
        const ok = wordsOk && blank.accepted.some((acc) => normalizeText(acc, blank.case_sensitive) === g);
        details[blank.id] = ok;
        if (ok) correct++;
      }
      return {
        is_correct: correct === content.blanks.length,
        score: ratio(correct, content.blanks.length),
        details,
        correct_answer: Object.fromEntries(content.blanks.map((b) => [b.id, b.accepted])),
      };
    }
    case 'matching': {
      const a = answer as Extract<AnswerInput, { type: 'matching' }>;
      return mapResult(content.answer_key.pairs, a.pairs);
    }
    case 'drag_drop': {
      const a = answer as Extract<AnswerInput, { type: 'drag_drop' }>;
      return mapResult(content.answer_key.placements, a.placements);
    }
    case 'map_label': {
      const a = answer as Extract<AnswerInput, { type: 'map_label' }>;
      return mapResult(content.answer_key.positions, a.positions);
    }
    case 'tfng': {
      const a = answer as Extract<AnswerInput, { type: 'tfng' }>;
      return mapResult(content.answer_key.values, a.values);
    }
    case 'ordering': {
      const a = answer as Extract<AnswerInput, { type: 'ordering' }>;
      const expected = content.answer_key.order;
      const exact = expected.length === a.order.length && expected.every((k, i) => a.order[i] === k);
      if (content.answer_key.scoring === 'exact') {
        return { is_correct: exact, score: exact ? 1 : 0, correct_answer: expected };
      }
      let pairs = 0;
      for (let i = 0; i < expected.length - 1; i++) {
        const idx = a.order.indexOf(expected[i]!);
        if (idx >= 0 && a.order[idx + 1] === expected[i + 1]) pairs++;
      }
      return { is_correct: exact, score: ratio(pairs, expected.length - 1), correct_answer: expected };
    }
    case 'dictation': {
      const a = answer as Extract<AnswerInput, { type: 'dictation' }>;
      const key = content.answer_key;
      const prep = (s: string) => normalizeText(key.ignore_punctuation ? stripPunct(s) : s).split(' ').filter(Boolean);
      const expected = prep(key.text);
      const given = prep(a.text);
      const details: Record<string, boolean> = {};
      let correct = 0;
      // So khớp theo vị trí với cửa sổ ±1 để chịu được thiếu/thừa một từ
      for (let i = 0; i < expected.length; i++) {
        const exp = expected[i]!;
        const candidates = [given[i], given[i - 1], given[i + 1]].filter((x): x is string => typeof x === 'string');
        const ok = candidates.some((c) => levenshtein(c, exp) <= key.max_edit_distance_per_token);
        details[String(i)] = ok;
        if (ok) correct++;
      }
      const score = ratio(correct, expected.length);
      return { is_correct: score >= key.pass_ratio, score, details, correct_answer: key.text };
    }
    default:
      return { is_correct: null, score: 0, correct_answer: null };
  }
}

function gradeEmpty(content: QuestionContent): GradeResult {
  switch (content.type) {
    case 'mcq_single':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.correct };
    case 'mcq_multi':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.correct };
    case 'fill_blank':
      return { is_correct: false, score: 0, correct_answer: Object.fromEntries(content.blanks.map((b) => [b.id, b.accepted])) };
    case 'matching':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.pairs };
    case 'drag_drop':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.placements };
    case 'map_label':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.positions };
    case 'tfng':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.values };
    case 'ordering':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.order };
    case 'dictation':
      return { is_correct: false, score: 0, correct_answer: content.answer_key.text };
    default:
      return { is_correct: null, score: 0, correct_answer: null };
  }
}

/** Đáp án đúng (để Review hiển thị) mà không cần câu trả lời */
export function correctAnswerOf(content: QuestionContent): unknown {
  return gradeEmpty(content).correct_answer;
}
