import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { roleOf } from '../lib/access';
import { detectImportFormat, parseImport, type ParsedImportRow } from '../lib/import-questions';

/**
 * POST /api/questions/import – nhập hàng loạt từ JSON hoặc CSV (nội dung tệp gửi dạng text trong JSON body,
 * tránh multipart). Mỗi dòng hợp lệ → một câu hỏi `draft`; lỗi trả theo dòng. Trùng `import_key` → bỏ qua.
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
    const run = await runImport(req, parsed.rows, dryRun);
    const report: ImportReport = {
      format,
      total: parsed.rows.length + parsed.errors.length,
      inserted: run.inserted,
      skipped: run.skipped,
      errors: [...parsed.errors, ...run.errors].sort((a, b) => a.row - b.row),
      insertedIds: run.insertedIds,
      dryRun,
    };
    return Response.json(report);
  },
};
