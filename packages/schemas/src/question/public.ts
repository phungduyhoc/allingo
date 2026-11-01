import type { QuestionContent } from './content.js';

/** Nội dung câu hỏi an toàn trả cho client: bỏ answer_key, explanation, evidence. */
export type PublicQuestionContent = {
  [K in QuestionContent['type']]: Omit<Extract<QuestionContent, { type: K }>, 'answer_key' | 'explanation' | 'evidence'>;
}[QuestionContent['type']];

const SECRET_FIELDS = ['answer_key', 'explanation', 'evidence'] as const;

export function toPublicContent(content: QuestionContent): PublicQuestionContent {
  const copy: Record<string, unknown> = { ...content };
  for (const f of SECRET_FIELDS) delete copy[f];
  return copy as PublicQuestionContent;
}

/**
 * Phần thi mà đề bài/lựa chọn được ĐỌC trong audio (không in trên đề) – nội dung chữ chính là transcript.
 * TOEIC Part 1 (mô tả tranh: 4 câu A–D đọc) và Part 2 (câu hỏi + 3 đáp lời đọc). Part 3/4: câu hỏi và lựa chọn in trên đề,
 * hội thoại/bài nói nằm ở passage `audio_script`.
 */
export const SPOKEN_TEXT_SECTIONS: Readonly<Record<string, readonly string[]>> = { toeic: ['part1', 'part2'] };

export function isSpokenTextSection(program: string, sectionCode: string): boolean {
  return SPOKEN_TEXT_SECTIONS[program]?.includes(sectionCode) ?? false;
}

/**
 * Ẩn transcript trong nội dung công khai khi đang làm bài (Sprint 4): với phần thi "đọc trong audio" (SPOKEN_TEXT_SECTIONS)
 * xoá chữ của đề bài, đề bài đa ngôn ngữ và lựa chọn (giữ key + media). Chỉ Review sau khi nộp mới trả lại chữ.
 */
export function redactSpokenText(content: PublicQuestionContent): PublicQuestionContent {
  const copy: Record<string, unknown> = { ...content, stem: '' };
  delete copy.stem_i18n;
  if (Array.isArray(copy.options)) copy.options = (copy.options as Array<Record<string, unknown>>).map((o) => ({ ...o, text: '' }));
  return copy as PublicQuestionContent;
}

/** Kiểm tra một object không còn trường bí mật (dùng trong test & guard API) */
export function hasSecretFields(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return SECRET_FIELDS.some((f) => f in o);
}
