import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { roleOf } from '../lib/access';
import { findBatchDuplicates } from '@allingo/schemas';
import { detectImportFormat, parseImport, type ParsedImportRow } from '../lib/import-questions';
import { describeError, findDuplicates } from '../lib/internal-api';

/**
 * POST /api/questions/import – nhập hàng loạt từ JSON hoặc CSV (nội dung tệp gửi dạng text trong JSON body,
 * tránh multipart). Mỗi dòng hợp lệ → một câu hỏi `draft`; lỗi trả theo dòng. Trùng `import_key` → bỏ qua.
 * Phát hiện trùng nội dung (Sprint 2): đề bài giống ≥ 0,85 (trigram) với dòng trước trong tệp hoặc câu đã có trong catalog
 * → báo lỗi đúng dòng, không nhập. API chưa chạy → chỉ kiểm tra trùng trong tệp (cảnh báo trong `warnings`).
 * Body: { format?: 'json'|'csv', fileName?: string, text: string, dryRun?: boolean }
 */
const bodySchema = z.object({
  format: z.enum(['json', 'csv']).optional(),
  fileName: z.string().max(200).optional(),
  text: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().optional(),
});

export interface ImportReport {
  format: 'json' | 'csv';
  total: number;
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  insertedIds: string[];
  dryRun: boolean;
  duplicates: Array<{ row: number; duplicate_of_row?: number; question_id?: string; similarity: number }>;
  warnings: string[];
}

/** Đánh dấu dòng trùng (trong lô + với catalog) – trả các dòng còn lại để nhập */
export async function detectDuplicates(rows: ParsedImportRow[]): Promise<{ keep: ParsedImportRow[]; duplicates: ImportReport['duplicates']; errors: ImportReport['errors']; warnings: string[] }> {
  const warnings: string[] = [];
  const duplicates: ImportReport['duplicates'] = [];
  const dupIndex = new Set<number>();
  const stems = rows.map((r) => (typeof (r.content as { stem?: unknown }).stem === 'string' ? (r.content as { stem: string }).stem : ''));
  const byProgram = new Map<string, number[]>();
  rows.forEach((r, i) => byProgram.set(r.program, [...(byProgram.get(r.program) ?? []), i]));
  for (const [program, idxs] of byProgram) {
    const sub = idxs.map((i) => stems[i]!);
    try {
      const res = await findDuplicates({ program, stems: sub });
      for (const d of res.in_batch) {
        dupIndex.add(idxs[d.index]!);
        duplicates.push({ row: rows[idxs[d.index]!]!.row, duplicate_of_row: rows[idxs[d.duplicate_of]!]!.row, similarity: d.similarity });
      }
      for (const d of res.existing) {
        dupIndex.add(idxs[d.index]!);
        duplicates.push({ row: rows[idxs[d.index]!]!.row, question_id: d.question_id, similarity: d.similarity });
      }
    } catch (err) {
      warnings.push(`Không kiểm tra trùng với catalog được (${describeError(err)}); chỉ kiểm tra trùng trong tệp.`);
      for (const d of findBatchDuplicates(sub)) {
        dupIndex.add(idxs[d.index]!);
        duplicates.push({ row: rows[idxs[d.index]!]!.row, duplicate_of_row: rows[idxs[d.duplicate_of]!]!.row, similarity: d.similarity });
      }
    }
  }
  const errors = duplicates.map((d) => ({
    row: d.row,
    message: d.question_id ? `Trùng câu đã có trong catalog (${d.question_id}, độ giống ${d.similarity}).` : `Trùng dòng ${d.duplicate_of_row} trong tệp (độ giống ${d.similarity}).`,
  }));
  return { keep: rows.filter((_, i) => !dupIndex.has(i)), duplicates: duplicates.sort((a, b) => a.row - b.row), errors, warnings };
}

export async function runImport(req: PayloadRequest, rows: ParsedImportRow[], dryRun: boolean): Promise<Pick<ImportReport, 'inserted' | 'skipped' | 'errors' | 'insertedIds'>> {
  const errors: ImportReport['errors'] = [];
  const insertedIds: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    try {
      if (r.importKey) {
        const existing = await req.payload.find({ collection: 'questions', where: { importKey: { equals: r.importKey } }, limit: 1, depth: 0, req, overrideAccess: true });
        if (existing.totalDocs > 0) {
          skipped += 1;
          continue;
        }
      }
      if (dryRun) {
        insertedIds.push('(dry-run)');
        continue;
      }
      const created = await req.payload.create({
        collection: 'questions',
        data: {
          program: r.program,
          sectionCode: r.sectionCode,
          questionType: r.questionType,
          difficulty: r.difficulty ?? null,
          topicCode: r.topicCode ?? null,
          subskillCodes: r.subskillCodes.map((code) => ({ code })),
          source: r.source,
          status: 'draft',
          content: r.content,
          importKey: r.importKey ?? null,
        },
        depth: 0,
        req,
        overrideAccess: false,
      });
      insertedIds.push(String(created.id));
    } catch (err) {
      errors.push({ row: r.row, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { inserted: insertedIds.length, skipped, errors, insertedIds };
}

export const importQuestionsEndpoint: Endpoint = {
  path: '/import',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!roleOf(req)) return Response.json({ error: { code: 'unauthorized', message: 'Cần đăng nhập.' } }, { status: 401 });
    let body: unknown;
    try {
      body = req.json ? await req.json() : {};
    } catch {
      return Response.json({ error: { code: 'validation_failed', message: 'Body phải là JSON.' } }, { status: 400 });
    }
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return Response.json({ error: { code: 'validation_failed', message: parsedBody.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, { status: 400 });
    }
    const { text, fileName, dryRun = false } = parsedBody.data;
    const format = parsedBody.data.format ?? detectImportFormat(fileName, text);
    const parsed = parseImport(text, format);
    const dup = await detectDuplicates(parsed.rows);
    const run = await runImport(req, dup.keep, dryRun);
    const report: ImportReport = {
      format,
      total: parsed.rows.length + parsed.errors.length,
      inserted: run.inserted,
      skipped: run.skipped,
      errors: [...parsed.errors, ...dup.errors, ...run.errors].sort((a, b) => a.row - b.row),
      insertedIds: run.insertedIds,
      dryRun,
      duplicates: dup.duplicates,
      warnings: dup.warnings,
    };
    return Response.json(report);
  },
};
