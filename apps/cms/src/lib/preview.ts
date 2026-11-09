import { describeQuestion, keyAnswerOf, markCount, questionContentSchemasByType, type QuestionContent, type QuestionDescription } from '@allingo/schemas';
import type { z } from 'zod';
import { isQuestionTypeCode } from './validate';

/**
 * C2 – xem trước nội dung câu (mọi dạng, nhất là 14 dạng IELTS nhập JSON) trong CMS: kiểm tra Zod theo dạng câu (gồm kiểm tra tham
 * chiếu đáp án ↔ chỗ trống/mục/lựa chọn) rồi dựng bản mô tả phẳng (hướng dẫn, đề, lựa chọn, từng mục + đáp án). Hàm thuần – test ở
 * test/preview.test.ts; component `question-content-field.tsx` chỉ hiển thị.
 */

export type ContentPreview =
  | { ok: true; content: QuestionContent; description: QuestionDescription; marks: number }
  | { ok: false; issues: string[] };

export function buildContentPreview(questionType: unknown, value: unknown): ContentPreview {
  if (!isQuestionTypeCode(questionType)) return { ok: false, issues: ['Chưa chọn dạng câu hợp lệ'] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, issues: ['Nội dung trống'] };
  const schema = questionContentSchemasByType[questionType] as z.ZodType<QuestionContent>;
  const parsed = schema.safeParse({ ...(value as Record<string, unknown>), type: questionType });
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.length ? i.path.join('.') : '(gốc)'}: ${i.message}`) };
  const content = parsed.data;
  return { ok: true, content, description: describeQuestion(content, keyAnswerOf(content)), marks: markCount(content) };
}
