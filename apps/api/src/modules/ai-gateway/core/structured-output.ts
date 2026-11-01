import type { ZodType } from 'zod';
import { AI_OUTPUT_SCHEMAS, type AiTaskCode } from '@allingo/schemas';

/** Trích JSON từ văn bản model trả về (bỏ ```json, văn bản thừa trước/sau) */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export interface ValidationOutcome<T> {
  ok: boolean;
  data?: T;
  issues?: Array<{ path: string; message: string }>;
}

/** Validate đầu ra theo Zod sinh từ JSON Schema của task (CLAUDE.md §5.3) */
export function validateOutput<K extends AiTaskCode>(taskCode: K, text: string): ValidationOutcome<unknown> {
  const schema = AI_OUTPUT_SCHEMAS[taskCode] as ZodType;
  const json = extractJson(text);
  if (json === undefined) return { ok: false, issues: [{ path: '', message: 'Output is not valid JSON' }] };
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, issues: r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

/** Thông điệp yêu cầu model sửa lại (repair 1 lần) */
export function repairPrompt(issues: Array<{ path: string; message: string }>, previous: string): string {
  const list = issues.map((i) => `- ${i.path || '(root)'}: ${i.message}`).join('\n');
  return `Your previous output did not match the required JSON schema:\n${list}\n\nPrevious output (truncated):\n${previous.slice(0, 1500)}\n\nReturn ONLY the corrected JSON object, no prose, no code fences.`;
}
