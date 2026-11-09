import { gapIdsOf, isTypedGapContent, questionContentSchema, type QuestionContent } from '../question/content.js';
import { expandAccepted, withinWordLimit } from '../question/normalize.js';
import { isSpokenSection } from '../program/registry.js';

/**
 * B2 – kiểm tra tự động (tất định, không gọi AI) cho câu chờ duyệt: chạy ở API khi trả hàng chờ duyệt, ở nhập Excel (dry-run) và
 * AI soạn đề nháp. Bổ sung cho AI check (check_question) – lỗi cấu trúc rõ ràng được báo ngay, reviewer khỏi mở từng câu.
 * Trả mã + mức (error/warning) + tham số; thông điệp hiển thị qua i18n theo mã (web) – API không gửi chuỗi tiếng Việt cứng.
 */

export const AUTO_CHECK_CODES = [
  'content_invalid',
  'type_mismatch',
  'stem_missing',
  'answer_key_missing',
  'answer_key_not_in_options',
  'duplicate_options',
  'empty_option',
  'option_count',
  'passage_missing',
  'audio_missing',
  'image_missing',
  'explanation_missing',
  // C2 – dạng IELTS Reading/Listening
  'word_limit_missing',
  'accepted_exceeds_word_limit',
  'too_few_options',
  'select_count_mismatch',
] as const;
export type AutoCheckCode = (typeof AUTO_CHECK_CODES)[number];

export interface AutoCheckResult {
  code: AutoCheckCode;
  level: 'error' | 'warning';
  params?: Record<string, string | number>;
}

export interface AutoCheckInput {
  program: string;
  section_code: string;
  question_type: string;
  content: unknown;
  /** Câu có passage (catalog.questions.passage_id) */
  has_passage: boolean;
  /** Passage có audio (media_asset_id) – audio nhóm Part 3/4 */
  passage_has_audio?: boolean;
  /** catalog.sections.rules (audio_once, has_image, group_size…) */
  section_rules?: Record<string, unknown> | null;
}

/** Số phương án chuẩn theo Part (TOEIC: Part 2 có 3 đáp lời, các Part trắc nghiệm còn lại 4) */
export const EXPECTED_OPTION_COUNT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  toeic: { part1: 4, part2: 3, part3: 4, part4: 4, part5: 4, part6: 4, part7: 4 },
};

/** Section cần đoạn văn/script chung (có `group_size` trong rules) – Part 3/4/6/7 TOEIC */
export function sectionNeedsPassage(rules: Record<string, unknown> | null | undefined): boolean {
  return !!rules && rules.group_size !== undefined && rules.group_size !== null;
}

/** Section Listening (rules.audio_once) */
export function sectionNeedsAudio(rules: Record<string, unknown> | null | undefined): boolean {
  return !!rules && rules.audio_once === true;
}

export function runAutoChecks(input: AutoCheckInput): AutoCheckResult[] {
  const out: AutoCheckResult[] = [];
  const parsed = questionContentSchema.safeParse(input.content);
  if (!parsed.success) {
    out.push({ code: 'content_invalid', level: 'error', params: { path: parsed.error.issues[0]?.path.join('.') ?? '' } });
    return out;
  }
  const c: QuestionContent = parsed.data;
  if (c.type !== input.question_type) out.push({ code: 'type_mismatch', level: 'error', params: { expected: input.question_type, actual: c.type } });
  const rules = input.section_rules ?? null;
  const needsAudio = sectionNeedsAudio(rules);
  const spoken = isSpokenSection(input.program, input.section_code);
  // Part 1/2: đề bài được đọc trong audio – không bắt buộc stem chữ
  if (!spoken && (!('stem' in c) || !c.stem || !String(c.stem).trim())) out.push({ code: 'stem_missing', level: 'error' });

  if (c.type === 'mcq_single' || c.type === 'mcq_multi') {
    const keys = c.options.map((o) => o.key);
    const correct = c.type === 'mcq_single' ? [c.answer_key.correct] : c.answer_key.correct;
    if (!correct.length || correct.some((k) => !k)) out.push({ code: 'answer_key_missing', level: 'error' });
    else if (correct.some((k) => !keys.includes(k))) out.push({ code: 'answer_key_not_in_options', level: 'error', params: { key: correct.filter((k) => !keys.includes(k)).join(',') } });
    const texts = c.options.map((o) => (o.text ?? '').replace(/\s+/g, ' ').trim().toLowerCase());
    if (!spoken && texts.some((t, i) => !t && !c.options[i]?.image_asset_id)) out.push({ code: 'empty_option', level: 'error' });
    const nonEmpty = texts.filter(Boolean);
    if (new Set(nonEmpty).size !== nonEmpty.length) out.push({ code: 'duplicate_options', level: 'error' });
    const expected = EXPECTED_OPTION_COUNT[input.program]?.[input.section_code];
    if (expected !== undefined && c.options.length !== expected) out.push({ code: 'option_count', level: 'warning', params: { expected, actual: c.options.length } });
  }
  if (c.type === 'mcq_multi' && c.select_count !== undefined && c.select_count !== c.answer_key.correct.length) out.push({ code: 'select_count_mismatch', level: 'error', params: { expected: c.select_count, actual: c.answer_key.correct.length } });
  // C2: dạng gõ đáp án – IELTS luôn ghi giới hạn từ; đáp án chấp nhận vượt giới hạn thì không ai làm đúng được
  if (isTypedGapContent(c)) {
    const meta = new Map(c.gaps.map((g) => [g.id, g.word_limit]));
    const ids = gapIdsOf(c);
    if (!c.word_limit && ids.some((id) => !meta.get(id))) out.push({ code: 'word_limit_missing', level: 'warning' });
    const over = ids.filter((id) => (c.answer_key.gaps[id]?.accepted ?? []).some((acc) => expandAccepted(acc).every((v) => !withinWordLimit(v, meta.get(id) ?? c.word_limit))));
    if (over.length) out.push({ code: 'accepted_exceeds_word_limit', level: 'error', params: { gaps: over.join(',') } });
  }
  // Nối không dùng lại lựa chọn: cần nhiều lựa chọn hơn số mục (có lựa chọn nhiễu)
  if ((c.type === 'matching_headings' || c.type === 'matching_sentence_endings' || c.type === 'summary_word_bank') && !c.allow_reuse) {
    const needed = c.type === 'summary_word_bank' ? gapIdsOf(c).length : c.items.length;
    const have = c.type === 'summary_word_bank' ? c.bank.length : c.options.length;
    if (have <= needed) out.push({ code: 'too_few_options', level: 'warning', params: { items: needed, options: have } });
  }
  if (sectionNeedsPassage(rules) && !input.has_passage) out.push({ code: 'passage_missing', level: 'error' });
  if (needsAudio && !c.media?.audio_asset_id && !input.passage_has_audio) out.push({ code: 'audio_missing', level: 'warning' });
  if (rules?.has_image === true && !c.media?.image_asset_id && !('image_asset_id' in c && c.image_asset_id)) out.push({ code: 'image_missing', level: 'warning' });
  const ex = (c as { explanation?: Record<string, string | undefined> }).explanation;
  if (!ex || !Object.values(ex).some((v) => typeof v === 'string' && v.trim().length > 0)) out.push({ code: 'explanation_missing', level: 'warning' });
  return out;
}

/** Có lỗi chặn (error) – dùng để tô đỏ trong hàng chờ và từ chối dòng nhập */
export const hasBlockingCheck = (r: readonly AutoCheckResult[]) => r.some((x) => x.level === 'error');
