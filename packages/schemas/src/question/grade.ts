import { answerInputSchemasByType, type AnswerInput, type AnswerInputOf } from './answer.js';
import { AUTO_GRADABLE_TYPES, DEFAULT_PARTIAL_SCORING, gapIdsOf, type PartialScoringMode, type QuestionContent, type QuestionContentOf, type TypedGapContent } from './content.js';
import { matchesAccepted, withinWordLimit } from './normalize.js';
import type { MatchingFamilyType } from './rl-types.js';

/** Lý do chấm 0 điểm mà không phải do trả lời sai */
export type GradeError = 'answer_type_mismatch';

/**
 * Kết quả chấm một câu: score ∈ [0, 1] × points do test_set_items.points quyết định.
 * - Dạng tự chấm (AUTO_GRADABLE_TYPES): auto = true, is_correct/score luôn là giá trị.
 * - essay/speaking/handwriting: auto = false, needs_manual = true, is_correct = score = null
 *   (điểm do AI/giáo viên chấm ở module grading, không phải ở đây).
 */
export interface GradeResult {
  /** null khi dạng câu không chấm tự động (essay/speaking/handwriting) */
  is_correct: boolean | null;
  /** 0–1; null khi không chấm tự động */
  score: number | null;
  /** true khi dạng câu được chấm tự động bởi hàm này */
  auto: boolean;
  /** true khi cần AI/giáo viên chấm (essay/speaking/handwriting) */
  needs_manual: boolean;
  /** Chi tiết theo phần (từng blank/pair/statement) để Review tô màu */
  details?: Record<string, boolean>;
  /** Đáp án đúng đã chuẩn hoá để trả trong Review (không dùng trước khi nộp) */
  correct_answer: unknown;
  /** Có khi câu trả lời không khớp dạng câu hỏi (score = 0) */
  error?: GradeError;
}

// ---------------------------------------------------------------------------
// Tiện ích chuẩn hoá văn bản

const PUNCT_RE = /[\p{P}\p{S}]/gu;

/** Trim, gộp nhiều khoảng trắng thành một, NFC; hạ chữ thường trừ khi caseSensitive */
export const normalizeText = (s: string, caseSensitive = false, ignorePunctuation = false): string => {
  const base = ignorePunctuation ? s.replace(PUNCT_RE, ' ') : s;
  const t = base.normalize('NFC').replace(/\s+/g, ' ').trim();
  return caseSensitive ? t : t.toLocaleLowerCase();
};

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

/** Tỷ lệ làm tròn 3 chữ số; total = 0 → 0 */
const ratio = (correct: number, total: number) => (total === 0 ? 0 : Math.round((correct / total) * 1000) / 1000);

/** Áp chính sách partial/all_or_nothing lên số phần đúng */
const partialScore = (correct: number, total: number, mode: PartialScoringMode): number => {
  if (mode === 'all_or_nothing') return correct === total && total > 0 ? 1 : 0;
  return ratio(correct, total);
};

const AUTO: Pick<GradeResult, 'auto' | 'needs_manual'> = { auto: true, needs_manual: false };
const MANUAL: Pick<GradeResult, 'auto' | 'needs_manual'> = { auto: false, needs_manual: true };

/**
 * So khớp key → value (matching/drag_drop/map_label/tfng).
 * `invalidValues`: giá trị bị coi là sai dù trùng đáp án (vd. mục bên phải dùng lặp khi không cho phép).
 */
function gradeMap(
  expected: Record<string, string>,
  given: Record<string, string>,
  mode: PartialScoringMode | undefined,
  invalidValues: ReadonlySet<string> = new Set(),
): Omit<GradeResult, 'auto' | 'needs_manual'> {
  const keys = Object.keys(expected);
  const details: Record<string, boolean> = {};
  let correct = 0;
  for (const k of keys) {
    const g = given[k];
    const ok = g !== undefined && g === expected[k] && !invalidValues.has(g);
    details[k] = ok;
    if (ok) correct++;
  }
  return { is_correct: correct === keys.length, score: partialScore(correct, keys.length, mode ?? DEFAULT_PARTIAL_SCORING), details, correct_answer: expected };
}

/** Các giá trị xuất hiện nhiều hơn một lần trong bản đồ */
function duplicatedValues(map: Record<string, string>): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of Object.values(map)) {
    if (seen.has(v)) dup.add(v);
    seen.add(v);
  }
  return dup;
}

// ---------------------------------------------------------------------------
// Chấm từng dạng

type Partial9 = Omit<GradeResult, 'auto' | 'needs_manual'>;

function gradeMcqSingle(c: QuestionContentOf<'mcq_single'>, a: AnswerInputOf<'mcq_single'>): Partial9 {
  const ok = a.selected === c.answer_key.correct;
  return { is_correct: ok, score: ok ? 1 : 0, correct_answer: c.answer_key.correct };
}

function gradeMcqMulti(c: QuestionContentOf<'mcq_multi'>, a: AnswerInputOf<'mcq_multi'>): Partial9 {
  const key = c.answer_key;
  const correctSet = new Set(key.correct);
  const selected = new Set(a.selected);
  const details: Record<string, boolean> = {};
  for (const k of key.correct) details[k] = selected.has(k);
  const hits = key.correct.filter((k) => selected.has(k)).length;
  const extra = selected.size - hits;
  const allCorrect = hits === correctSet.size && extra === 0;
  if (key.scoring === 'all_or_nothing') {
    return { is_correct: allCorrect, score: allCorrect ? 1 : 0, details, correct_answer: key.correct };
  }
  // partial: chọn thừa lựa chọn sai → 0 nếu penalize_extra, ngược lại chỉ đếm lựa chọn đúng
  const score = extra > 0 && (key.penalize_extra ?? true) ? 0 : ratio(hits, correctSet.size);
  return { is_correct: allCorrect, score, details, correct_answer: key.correct };
}

function gradeFillBlank(c: QuestionContentOf<'fill_blank'>, a: AnswerInputOf<'fill_blank'>): Partial9 {
  const details: Record<string, boolean> = {};
  const matches = (blank: QuestionContentOf<'fill_blank'>['blanks'][number], raw: string): boolean => {
    const g = normalizeText(raw, blank.case_sensitive, blank.ignore_punctuation ?? false);
    if (!g) return false;
    if (blank.max_words !== undefined && g.split(' ').length > blank.max_words) return false;
    return blank.accepted.some((acc) => normalizeText(acc, blank.case_sensitive, blank.ignore_punctuation ?? false) === g);
  };
  let correct = 0;
  if (c.answer_key.ordered) {
    for (const blank of c.blanks) {
      const ok = matches(blank, a.blanks[blank.id] ?? '');
      details[blank.id] = ok;
      if (ok) correct++;
    }
  } else {
    // "in any order": mỗi giá trị người học điền khớp với một ô chưa dùng bất kỳ
    const remaining = [...c.blanks];
    for (const blank of c.blanks) {
      const raw = a.blanks[blank.id] ?? '';
      const idx = remaining.findIndex((b) => matches(b, raw));
      const ok = idx >= 0;
      if (ok) {
        remaining.splice(idx, 1);
        correct++;
      }
      details[blank.id] = ok;
    }
  }
  return {
    is_correct: correct === c.blanks.length,
    score: partialScore(correct, c.blanks.length, c.answer_key.scoring ?? DEFAULT_PARTIAL_SCORING),
    details,
    correct_answer: fillBlankKey(c),
  };
}

const fillBlankKey = (c: QuestionContentOf<'fill_blank'>) => Object.fromEntries(c.blanks.map((b) => [b.id, b.accepted]));

function gradeMatching(c: QuestionContentOf<'matching'>, a: AnswerInputOf<'matching'>): Partial9 {
  // Không cho dùng lặp mục bên phải → các cặp dùng cùng một mục đều sai
  const invalid = c.allow_reuse ? new Set<string>() : duplicatedValues(a.pairs);
  return gradeMap(c.answer_key.pairs, a.pairs, c.answer_key.scoring, invalid);
}

function gradeDragDrop(c: QuestionContentOf<'drag_drop'>, a: AnswerInputOf<'drag_drop'>): Partial9 {
  return gradeMap(c.answer_key.placements, a.placements, c.answer_key.scoring);
}

function gradeMapLabel(c: QuestionContentOf<'map_label'>, a: AnswerInputOf<'map_label'>): Partial9 {
  return gradeMap(c.answer_key.positions, a.positions, c.answer_key.scoring);
}

function gradeTfng(c: QuestionContentOf<'tfng'>, a: AnswerInputOf<'tfng'>): Partial9 {
  return gradeMap(c.answer_key.values, a.values, c.answer_key.scoring);
}

function gradeOrdering(c: QuestionContentOf<'ordering'>, a: AnswerInputOf<'ordering'>): Partial9 {
  const expected = c.answer_key.order;
  const exact = expected.length === a.order.length && expected.every((k, i) => a.order[i] === k);
  const base = { is_correct: exact, correct_answer: expected };
  switch (c.answer_key.scoring) {
    case 'exact':
      return { ...base, score: exact ? 1 : 0 };
    case 'partial': {
      // Tỷ lệ phần tử đúng vị trí
      const details: Record<string, boolean> = {};
      let hits = 0;
      expected.forEach((k, i) => {
        const ok = a.order[i] === k;
        details[k] = ok;
        if (ok) hits++;
      });
      return { ...base, score: ratio(hits, expected.length), details };
    }
    case 'adjacent_pairs': {
      // Tỷ lệ cặp kề (k_i, k_{i+1}) xuất hiện kề nhau đúng thứ tự trong câu trả lời
      let pairs = 0;
      for (let i = 0; i < expected.length - 1; i++) {
        const idx = a.order.indexOf(expected[i]!);
        if (idx >= 0 && a.order[idx + 1] === expected[i + 1]) pairs++;
      }
      return { ...base, score: ratio(pairs, expected.length - 1) };
    }
  }
}

function gradeDictation(c: QuestionContentOf<'dictation'>, a: AnswerInputOf<'dictation'>): Partial9 {
  const key = c.answer_key;
  const tokens = (s: string) => normalizeText(s, false, key.ignore_punctuation).split(' ').filter(Boolean);
  const expected = tokens(key.text);
  const given = tokens(a.text);
  const details: Record<string, boolean> = {};
  let correct = 0;
  // So khớp theo vị trí với cửa sổ ±1 để chịu được thiếu/thừa một từ; mỗi token người học chỉ dùng một lần
  const used = new Set<number>();
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i]!;
    const hit = [i, i - 1, i + 1].find((j) => {
      const g = given[j];
      return j >= 0 && g !== undefined && !used.has(j) && levenshtein(g, exp) <= key.max_edit_distance_per_token;
    });
    const ok = hit !== undefined;
    if (ok) {
      used.add(hit);
      correct++;
    }
    details[String(i)] = ok;
  }
  const score = ratio(correct, expected.length);
  return { is_correct: score >= key.pass_ratio, score, details, correct_answer: key.text };
}

// --------------------------------------------------------------------------- C2 – IELTS Reading/Listening

/** Đáp án đúng của dạng gõ: id chỗ trống → các cách viết được chấp nhận (Review hiển thị cách đầu + biến thể) */
const typedGapKey = (c: TypedGapContent) => Object.fromEntries(gapIdsOf(c).map((id) => [id, c.answer_key.gaps[id]?.accepted ?? []]));

/** Dạng gõ đáp án: chuẩn hoá (normalize.ts) + giới hạn từ (ô ghi đè giới hạn chung) + chính tả Anh/Mỹ khi khai báo */
function gradeTypedGaps(c: TypedGapContent, a: { gaps: Record<string, string> }): Partial9 {
  const ids = gapIdsOf(c);
  const meta = new Map(c.gaps.map((g) => [g.id, g]));
  const details: Record<string, boolean> = {};
  let correct = 0;
  for (const id of ids) {
    const key = c.answer_key.gaps[id];
    const raw = a.gaps[id] ?? '';
    const limit = meta.get(id)?.word_limit ?? c.word_limit;
    const ok = !!key && raw.trim().length > 0 && withinWordLimit(raw, limit) && matchesAccepted(raw, key.accepted, { caseSensitive: key.case_sensitive ?? false, spellingVariants: c.answer_key.spelling_variants ?? false });
    details[id] = ok;
    if (ok) correct++;
  }
  return { is_correct: correct === ids.length, score: partialScore(correct, ids.length, c.answer_key.scoring ?? DEFAULT_PARTIAL_SCORING), details, correct_answer: typedGapKey(c) };
}

/** Nối (4 dạng): không cho dùng lại lựa chọn → các mục dùng chung một lựa chọn đều sai; mục ví dụ không tính điểm */
function gradeMatchingFamily(c: QuestionContentOf<MatchingFamilyType>, a: { pairs: Record<string, string> }): Partial9 {
  const exampleItem = c.type === 'matching_headings' ? c.example?.item : undefined;
  const expected = Object.fromEntries(Object.entries(c.answer_key.pairs).filter(([k]) => k !== exampleItem));
  const given = Object.fromEntries(Object.entries(a.pairs).filter(([k]) => k !== exampleItem));
  const invalid = c.allow_reuse ? new Set<string>() : duplicatedValues(given);
  return gradeMap(expected, given, c.answer_key.scoring, invalid);
}

function gradeWordBank(c: QuestionContentOf<'summary_word_bank'>, a: AnswerInputOf<'summary_word_bank'>): Partial9 {
  const invalid = c.allow_reuse ? new Set<string>() : duplicatedValues(a.gaps);
  const expected = Object.fromEntries(gapIdsOf(c).map((id) => [id, c.answer_key.gaps[id]!]));
  return gradeMap(expected, a.gaps, c.answer_key.scoring, invalid);
}

function gradePlanMap(c: QuestionContentOf<'plan_map_labelling'>, a: AnswerInputOf<'plan_map_labelling'>): Partial9 {
  const expected = Object.fromEntries(c.items.map((it) => [it.key, c.answer_key.values[it.key]!]));
  return gradeMap(expected, a.values, c.answer_key.scoring);
}

// ---------------------------------------------------------------------------

/**
 * Chấm tự động theo nội dung câu hỏi. Hàm thuần, không I/O – dùng ở API (submit/review) và CMS (kiểm tra đáp án mẫu).
 *
 * Quy tắc:
 * - `answer` null/undefined (chưa làm): dạng tự chấm → is_correct = false, score = 0; dạng thủ công → null/null.
 * - `answer.type` ≠ `content.type` → { is_correct: false, score: 0, error: 'answer_type_mismatch' } (không ném).
 * - `answer.type` đúng nhưng payload sai schema → ném ZodError (dữ liệu hỏng, caller phải xử lý).
 * - essay/speaking/handwriting: không chấm, trả needs_manual = true sau khi validate answer.
 */
export function grade(content: QuestionContent, answer: AnswerInput | null | undefined): GradeResult {
  const meta = AUTO_GRADABLE_TYPES.has(content.type) ? AUTO : MANUAL;
  const correct_answer = correctAnswerOf(content);

  if (answer === null || answer === undefined) {
    return meta.auto ? { ...meta, is_correct: false, score: 0, correct_answer } : { ...meta, is_correct: null, score: null, correct_answer };
  }
  if (answer.type !== content.type) {
    return { ...meta, is_correct: false, score: 0, correct_answer, error: 'answer_type_mismatch' };
  }
  const parsed: AnswerInput = answerInputSchemasByType[content.type].parse(answer);

  switch (content.type) {
    case 'mcq_single':
      return { ...AUTO, ...gradeMcqSingle(content, parsed as AnswerInputOf<'mcq_single'>) };
    case 'mcq_multi':
      return { ...AUTO, ...gradeMcqMulti(content, parsed as AnswerInputOf<'mcq_multi'>) };
    case 'fill_blank':
      return { ...AUTO, ...gradeFillBlank(content, parsed as AnswerInputOf<'fill_blank'>) };
    case 'matching':
      return { ...AUTO, ...gradeMatching(content, parsed as AnswerInputOf<'matching'>) };
    case 'drag_drop':
      return { ...AUTO, ...gradeDragDrop(content, parsed as AnswerInputOf<'drag_drop'>) };
    case 'map_label':
      return { ...AUTO, ...gradeMapLabel(content, parsed as AnswerInputOf<'map_label'>) };
    case 'tfng':
      return { ...AUTO, ...gradeTfng(content, parsed as AnswerInputOf<'tfng'>) };
    case 'ordering':
      return { ...AUTO, ...gradeOrdering(content, parsed as AnswerInputOf<'ordering'>) };
    case 'dictation':
      return { ...AUTO, ...gradeDictation(content, parsed as AnswerInputOf<'dictation'>) };
    case 'essay':
    case 'speaking':
    case 'handwriting':
      return { ...MANUAL, is_correct: null, score: null, correct_answer };
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return { ...AUTO, ...gradeMatchingFamily(content, parsed as { pairs: Record<string, string> }) };
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
      return { ...AUTO, ...gradeTypedGaps(content, parsed as { gaps: Record<string, string> }) };
    case 'summary_word_bank':
      return { ...AUTO, ...gradeWordBank(content, parsed as AnswerInputOf<'summary_word_bank'>) };
    case 'plan_map_labelling':
      return { ...AUTO, ...gradePlanMap(content, parsed as AnswerInputOf<'plan_map_labelling'>) };
  }
}

/** Đáp án đúng (để Review hiển thị) mà không cần câu trả lời – đủ 26 dạng */
export function correctAnswerOf(content: QuestionContent): unknown {
  switch (content.type) {
    case 'mcq_single':
      return content.answer_key.correct;
    case 'mcq_multi':
      return content.answer_key.correct;
    case 'fill_blank':
      return fillBlankKey(content);
    case 'matching':
      return content.answer_key.pairs;
    case 'drag_drop':
      return content.answer_key.placements;
    case 'map_label':
      return content.answer_key.positions;
    case 'tfng':
      return content.answer_key.values;
    case 'ordering':
      return content.answer_key.order;
    case 'dictation':
      return content.answer_key.text;
    case 'essay':
    case 'speaking':
      // Bài mẫu (nếu tác giả cung cấp) – không phải đáp án duy nhất
      return content.answer_key.model_answer ?? null;
    case 'handwriting':
      return { target: content.target, stroke_count: content.answer_key.stroke_count ?? null };
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return content.answer_key.pairs;
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
      return typedGapKey(content);
    case 'summary_word_bank':
      return content.answer_key.gaps;
    case 'plan_map_labelling':
      return content.answer_key.values;
  }
}
