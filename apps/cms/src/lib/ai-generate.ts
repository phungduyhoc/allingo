import { z } from 'zod';
import type { GeneratedItem } from './internal-api';
import type { AiReport } from './workflow';

/**
 * "Sinh câu hỏi bằng AI" (S5): CMS gọi API nội bộ → job content.generate tạo draft source=ai trong catalog (nguồn sự thật, ADR-0024),
 * chạy check_question và gắn cờ trùng. Khi job xong, CMS nhập các câu vào collection `questions` với CÙNG externalRef
 * (`ai-gen:<job>:<n>`) để lần lưu sau đồng bộ đúng câu bên catalog; trạng thái/aiReport lấy theo kết quả API (không chạy lại máy trạng thái).
 */
export const aiGenerateBodySchema = z.object({
  program: z.enum(['toeic', 'ielts', 'jlpt', 'hsk']).default('toeic'),
  sectionCode: z.string().min(1).max(32),
  questionType: z.string().min(1).max(32).default('mcq_single'),
  topic: z.string().trim().max(64).optional(),
  difficulty: z.string().max(10).optional(),
  count: z.coerce.number().int().min(1).max(50).default(10),
});
export type AiGenerateBody = z.infer<typeof aiGenerateBodySchema>;

/** Báo cáo AI lưu ở field aiReport của câu (kèm cờ trùng để reviewer thấy ngay) */
export function aiReportOf(item: GeneratedItem): AiReport & { duplicate: GeneratedItem['duplicate']; source: 'ai_generate' } {
  return {
    verdict: item.verdict ?? 'needs_change',
    issues: item.issues.map((i) => ({ field: i.field, severity: i.severity === 'error' ? 'error' : 'warning', message: i.message })),
    ai_task_id: item.ai_check_task_id,
    checked_at: new Date().toISOString(),
    duplicate: item.duplicate,
    source: 'ai_generate',
  };
}

export interface PayloadQuestionData {
  program: string;
  sectionCode: string;
  questionType: string;
  difficulty: string | null;
  topicCode: string | null;
  source: 'ai';
  status: 'draft' | 'ai_checked';
  content: unknown;
  externalRef: string;
  aiReport: unknown;
  reviewNote: string;
}

/** Dữ liệu tạo document Payload cho một câu API đã tạo (null nếu câu không hợp lệ/không có external_ref) */
export function toPayloadQuestion(item: GeneratedItem, body: AiGenerateBody): PayloadQuestionData | null {
  if (item.status !== 'created' || !item.external_ref || !item.content) return null;
  const dup = item.duplicate.flagged ? `⚠ Nghi trùng (${item.duplicate.method}, độ giống ${item.duplicate.similarity ?? '?'})${item.duplicate.of_question_id ? ` với câu ${item.duplicate.of_question_id}` : ''}` : '';
  return {
    program: body.program,
    sectionCode: body.sectionCode,
    questionType: body.questionType,
    difficulty: body.difficulty ?? null,
    topicCode: body.topic ?? null,
    source: 'ai',
    status: item.workflow_status === 'ai_checked' ? 'ai_checked' : 'draft',
    content: item.content,
    externalRef: item.external_ref,
    aiReport: aiReportOf(item),
    reviewNote: dup,
  };
}

/** Kho tối thiểu (Payload Local API hoặc giả lập trong test) */
export interface QuestionStore {
  findByExternalRef(externalRef: string): Promise<{ id: string | number } | null>;
  create(data: PayloadQuestionData): Promise<{ id: string | number }>;
}

export interface ImportedItem {
  index: number;
  cmsId: string | null;
  externalRef: string | null;
  questionId: string | null;
  status: GeneratedItem['status'];
  workflowStatus: string | null;
  verdict: GeneratedItem['verdict'];
  duplicate: GeneratedItem['duplicate'];
  stem: string;
  imported: boolean;
  errors: string[];
}

/** Nhập kết quả job vào CMS – idempotent theo externalRef (polling nhiều lần không tạo trùng) */
export async function importGenerated(store: QuestionStore, items: GeneratedItem[], body: AiGenerateBody): Promise<ImportedItem[]> {
  const out: ImportedItem[] = [];
  for (const item of items) {
    const data = toPayloadQuestion(item, body);
    const stem = typeof (item.content as { stem?: unknown } | null)?.stem === 'string' ? (item.content as { stem: string }).stem : '';
    const base = { index: item.index, externalRef: item.external_ref, questionId: item.question_id, status: item.status, workflowStatus: item.workflow_status, verdict: item.verdict, duplicate: item.duplicate, stem: stem.slice(0, 200), errors: item.errors ?? [] };
    if (!data) {
      out.push({ ...base, cmsId: null, imported: false });
      continue;
    }
    const existing = await store.findByExternalRef(data.externalRef);
    if (existing) {
      out.push({ ...base, cmsId: String(existing.id), imported: false });
      continue;
    }
    try {
      const created = await store.create(data);
      out.push({ ...base, cmsId: String(created.id), imported: true });
    } catch (err) {
      out.push({ ...base, cmsId: null, imported: false, errors: [...base.errors, err instanceof Error ? err.message : String(err)] });
    }
  }
  return out;
}
