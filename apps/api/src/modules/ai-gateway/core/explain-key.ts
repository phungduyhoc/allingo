import { createHash } from 'node:crypto';
import type { AnswerInput } from '@allingo/schemas';

/** Dạng câu chỉ có một lựa chọn – khoá cache theo mã lựa chọn như S5 */
const SINGLE_CHOICE = new Set(['mcq_single']);

/** Chuỗi JSON ổn định (khoá sắp xếp) để băm câu trả lời */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(typeof v === 'string' ? v.trim().toLowerCase() : v);
}

/**
 * C2 – khoá "lựa chọn" của cache giải thích: MCQ một đáp án = mã lựa chọn (S5); dạng nhiều mục = `a:` + 16 hex sha256 của câu trả lời
 * (chuẩn hoá: khoá sắp xếp, chuỗi viết thường) – vừa cột `chosen_option` (≤ 32), không lưu nội dung câu trả lời trong khoá.
 */
export function explainChoiceKey(type: string, chosen: string | null, answer: AnswerInput | null | undefined): string | null {
  if (SINGLE_CHOICE.has(type)) return chosen;
  if (!answer || answer.type !== type) return chosen;
  return `a:${createHash('sha256').update(stableJson(answer)).digest('hex').slice(0, 16)}`;
}

