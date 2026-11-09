import { isSpokenSection, PROGRAM_LIST } from '../program/registry.js';
import type { QuestionContent } from './content.js';

type Secret = 'answer_key' | 'explanation' | 'evidence';
type FillBlankContent = Extract<QuestionContent, { type: 'fill_blank' }>;
/** fill_blank: C2/S163 – `blanks[].accepted` là đáp án, không trả client (trước đây lộ qua API khi đang làm bài) */
type PublicFillBlank = Omit<FillBlankContent, Secret | 'blanks'> & { blanks: Array<Omit<FillBlankContent['blanks'][number], 'accepted'>> };

/** Nội dung câu hỏi an toàn trả cho client: bỏ answer_key, explanation, evidence (và đáp án điền từ nằm ngoài answer_key). */
export type PublicQuestionContent = {
  [K in QuestionContent['type']]: K extends 'fill_blank' ? PublicFillBlank : Omit<Extract<QuestionContent, { type: K }>, Secret>;
}[QuestionContent['type']];

const SECRET_FIELDS = ['answer_key', 'explanation', 'evidence'] as const;

export function toPublicContent(content: QuestionContent): PublicQuestionContent {
  const copy: Record<string, unknown> = { ...content };
  for (const f of SECRET_FIELDS) delete copy[f];
  if (content.type === 'fill_blank') copy.blanks = content.blanks.map(({ accepted: _accepted, ...rest }) => rest);
  return copy as PublicQuestionContent;
}

/**
 * Phần thi mà đề bài/lựa chọn được ĐỌC trong audio (không in trên đề) – nội dung chữ chính là transcript.
 * TOEIC Part 1 (mô tả tranh: 4 câu A–D đọc) và Part 2 (câu hỏi + 3 đáp lời đọc). Part 3/4: câu hỏi và lựa chọn in trên đề,
 * hội thoại/bài nói nằm ở passage `audio_script`. C1: suy từ registry chương trình (`spoken_sections`).
 */
export const SPOKEN_TEXT_SECTIONS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(PROGRAM_LIST.filter((p) => p.spoken_sections.length).map((p) => [p.code, p.spoken_sections]));

export function isSpokenTextSection(program: string, sectionCode: string): boolean {
  return isSpokenSection(program, sectionCode);
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

/** Kiểm tra một object không còn trường bí mật (dùng trong test & guard API) – cả `blanks[].accepted` của fill_blank (S163) */
export function hasSecretFields(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o.blanks) && (o.blanks as Array<Record<string, unknown>>).some((b) => b && typeof b === 'object' && 'accepted' in b)) return true;
  return SECRET_FIELDS.some((f) => f in o);
}
