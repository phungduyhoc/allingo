import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { roleOf } from '../lib/access';
import { describeError, InternalApiError, validateTestSet } from '../lib/internal-api';

const bodySchema = z.object({
  program: z.enum(['toeic', 'ielts', 'jlpt', 'hsk']),
  kind: z.enum(['full', 'mini', 'part_drill', 'diagnostic', 'topic_pack']),
  items: z.array(z.object({ question: z.string().min(1), sectionCode: z.string().min(1), sortOrder: z.number().int(), groupKey: z.string().nullable().optional() })).max(400),
});

/**
 * A26 – POST /api/test_sets/validate-structure: kiểm tra cấu trúc bộ đề đang dựng (chưa lưu) bằng API nội bộ
 * (`/internal/content/test-sets/validate` – cùng luật khi phát hành): id câu CMS → externalRef.
 */
export const testSetStructureEndpoint: Endpoint = {
  path: '/validate-structure',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!roleOf(req)) return Response.json({ error: { code: 'unauthorized', message: 'Cần đăng nhập.' } }, { status: 401 });
    let raw: unknown;
    try {
      raw = req.json ? await req.json() : {};
    } catch {
      return Response.json({ error: { code: 'validation_failed', message: 'Body phải là JSON.' } }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: { code: 'validation_failed', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, { status: 400 });
    const ids = [...new Set(parsed.data.items.map((i) => i.question))];
    const found = ids.length ? await req.payload.find({ collection: 'questions', where: { id: { in: ids } }, limit: ids.length, depth: 0, req, overrideAccess: true, pagination: false }) : { docs: [] };
    const refById = new Map(found.docs.map((q) => [String(q.id), q.externalRef ? String(q.externalRef) : String(q.id)]));
    try {
      const report = await validateTestSet({
        program: parsed.data.program,
        kind: parsed.data.kind,
        items: parsed.data.items.map((i) => ({ question_external_ref: refById.get(i.question) ?? i.question, section_code: i.sectionCode, sort_order: i.sortOrder, group_key: i.groupKey ?? null, points: 1 })),
      });
      return Response.json(report);
    } catch (err) {
      const status = err instanceof InternalApiError && err.kind === 'http' ? (err.status ?? 502) : 503;
      return Response.json({ error: { code: 'internal', message: `Không kiểm tra được cấu trúc: ${describeError(err)}` } }, { status });
    }
  },
};
