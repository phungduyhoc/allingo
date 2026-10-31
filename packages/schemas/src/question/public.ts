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

/** Kiểm tra một object không còn trường bí mật (dùng trong test & guard API) */
export function hasSecretFields(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return SECRET_FIELDS.some((f) => f in o);
}
