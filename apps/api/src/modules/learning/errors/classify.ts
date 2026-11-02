import type { ErrorKind } from '@allingo/schemas';

/**
 * Phân loại lỗi theo luật (Sprint 10 – A155; AI gán nhãn tinh ở GĐ2). Thuần, xác định – test đơn vị.
 *
 * Thứ tự:
 *  1. Bỏ trống khi bài bị tự nộp (hết giờ) → `timeout` (rule `unanswered_time_up`).
 *  2. Đã trả lời nhưng thời gian làm câu > ngưỡng theo Part → `timeout` (rule `slow`).
 *  3. Theo subskill của câu (bảng `SUBSKILL_KIND`, ưu tiên paraphrase > trap > vocabulary > grammar > inference > listening_detail).
 *  4. Theo chủ đề (topic) nếu mã gợi ý ngữ pháp/từ vựng.
 *  5. Theo Part: Listening → listening_detail; Part 5/6 → grammar; Part 7 → inference; còn lại → other.
 * Chỉ trả các loại sprint yêu cầu: timeout | paraphrase | trap | vocabulary | grammar | listening_detail | inference | other.
 */

/** Ngưỡng thời gian (ms) một câu theo Part TOEIC – gấp ~1,5 lần nhịp thi thật (Listening gồm cả thời gian nghe) */
export const TIMEOUT_THRESHOLD_MS: Readonly<Record<string, number>> = {
  part1: 30_000,
  part2: 25_000,
  part3: 45_000,
  part4: 45_000,
  part5: 40_000,
  part6: 75_000,
  part7: 90_000,
};
export const TIMEOUT_FALLBACK_MS = 90_000;

/** Subskill → loại lỗi (mã seed TOEIC; chương trình khác dùng quy tắc tên ở `kindFromCode`) */
export const SUBSKILL_KIND: Readonly<Record<string, ErrorKind>> = {
  paraphrase_recognition: 'paraphrase',
  detail: 'paraphrase',
  similar_sound: 'trap',
  indirect_response: 'trap',
  vocabulary_context: 'vocabulary',
  word_form: 'grammar',
  verb_tense: 'grammar',
  preposition: 'grammar',
  pronoun: 'grammar',
  conjunction: 'grammar',
  relative_clause: 'grammar',
  inference: 'inference',
  listening_inference: 'inference',
  speaker_intent: 'inference',
  next_action: 'inference',
  listening_gist: 'inference',
  listening_detail: 'listening_detail',
  wh_question: 'listening_detail',
  yes_no_question: 'listening_detail',
  tag_question: 'listening_detail',
  choice_question: 'listening_detail',
  statement_response: 'listening_detail',
  request_suggestion: 'listening_detail',
  photo_description: 'listening_detail',
  graphic_question: 'listening_detail',
};

const PRIORITY: readonly ErrorKind[] = ['paraphrase', 'trap', 'vocabulary', 'grammar', 'inference', 'listening_detail'];

/** Quy tắc theo tên mã (subskill/topic chưa có trong bảng) */
export function kindFromCode(code: string, skill: string | null): ErrorKind | null {
  const c = code.toLowerCase();
  if (/paraphras|synonym/.test(c)) return 'paraphrase';
  if (/trap|distract|similar_sound/.test(c)) return 'trap';
  if (/vocab|lexic|collocation|idiom|word_choice/.test(c)) return 'vocabulary';
  if (/grammar|tense|preposition|pronoun|conjunction|clause|agreement|word_form|article|modal|passive/.test(c)) return 'grammar';
  if (/infer|implied|intent|purpose|main_idea|gist/.test(c)) return 'inference';
  if (/detail|specific/.test(c)) return skill === 'listening' ? 'listening_detail' : 'paraphrase';
  return null;
}

export interface ClassifyInput {
  section_code: string;
  /** listening | reading | … (TOEIC: theo Part) */
  skill_code: string | null;
  subskill_codes: readonly string[];
  topic_code: string | null;
  time_spent_ms: number | null;
  answered: boolean;
  auto_submitted: boolean;
}

export interface Classification {
  kind: ErrorKind;
  rule: 'unanswered_time_up' | 'slow' | 'subskill' | 'topic' | 'section' | 'default';
  evidence: { time_spent_ms: number | null; threshold_ms: number; subskill: string | null; topic: string | null; section: string };
}

export function timeoutThreshold(sectionCode: string): number {
  return TIMEOUT_THRESHOLD_MS[sectionCode] ?? TIMEOUT_FALLBACK_MS;
}

export function classifyError(input: ClassifyInput): Classification {
  const threshold = timeoutThreshold(input.section_code);
  const base = { time_spent_ms: input.time_spent_ms, threshold_ms: threshold, topic: input.topic_code, section: input.section_code };
  if (!input.answered && input.auto_submitted) return { kind: 'timeout', rule: 'unanswered_time_up', evidence: { ...base, subskill: input.subskill_codes[0] ?? null } };
  if (input.answered && input.time_spent_ms !== null && input.time_spent_ms > threshold) return { kind: 'timeout', rule: 'slow', evidence: { ...base, subskill: input.subskill_codes[0] ?? null } };
  const candidates = input.subskill_codes.map((code) => ({ code, kind: SUBSKILL_KIND[code] ?? kindFromCode(code, input.skill_code) })).filter((x): x is { code: string; kind: ErrorKind } => x.kind !== null);
  if (candidates.length) {
    const best = [...candidates].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0]!;
    return { kind: best.kind, rule: 'subskill', evidence: { ...base, subskill: best.code } };
  }
  const fromTopic = input.topic_code ? kindFromCode(input.topic_code, input.skill_code) : null;
  if (fromTopic) return { kind: fromTopic, rule: 'topic', evidence: { ...base, subskill: null } };
  const part = /^part(\d+)$/.exec(input.section_code)?.[1];
  const bySection: ErrorKind | null = input.skill_code === 'listening' || (part && Number(part) <= 4) ? 'listening_detail' : part === '5' || part === '6' ? 'grammar' : part === '7' ? 'inference' : null;
  if (bySection) return { kind: bySection, rule: 'section', evidence: { ...base, subskill: null } };
  return { kind: 'other', rule: 'default', evidence: { ...base, subskill: null } };
}
