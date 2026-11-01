import type { Endpoint, PayloadRequest } from 'payload';
import { roleOf } from '../lib/access';
import { aiGenerateBodySchema, importGenerated, type AiGenerateBody, type PayloadQuestionData, type QuestionStore } from '../lib/ai-generate';
import { describeError, generateQuestions, generationStatus, InternalApiError } from '../lib/internal-api';

function apiEmail(req: PayloadRequest): string | null {
  const u = req.user as { email?: string; apiUserEmail?: string | null } | null;
  return u?.apiUserEmail ?? u?.email ?? null;
}

const httpStatusOf = (err: unknown) => (err instanceof InternalApiError && err.kind === 'http' ? (err.status ?? 502) : 503);

/** Kho Payload cho importGenerated: tìm theo externalRef, tạo với skipWorkflow (trạng thái/aiReport đã do API quyết định) */
function payloadStore(req: PayloadRequest): QuestionStore {
  return {
    async findByExternalRef(externalRef) {
      const r = await req.payload.find({ collection: 'questions', where: { externalRef: { equals: externalRef } }, limit: 1, depth: 0, req, overrideAccess: true });
      return r.docs[0] ? { id: r.docs[0].id } : null;
    },
    async create(data: PayloadQuestionData) {
      const doc = await req.payload.create({ collection: 'questions', data: data as never, depth: 0, req, overrideAccess: false, context: { skipWorkflow: true } });
      return { id: doc.id };
    },
  };
}

/**
 * POST /api/questions/ai-generate – bắt đầu job sinh câu (API nội bộ, actor = apiUserEmail của người dùng CMS).
 * Body: { program, sectionCode, questionType, topic?, difficulty?, count } → 202 { jobId }.
 */
export const aiGenerateStartEndpoint: Endpoint = {
  path: '/ai-generate',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!roleOf(req)) return Response.json({ error: { code: 'unauthorized', message: 'Cần đăng nhập.' } }, { status: 401 });
    let raw: unknown;
    try {
      raw = req.json ? await req.json() : {};
    } catch {
      return Response.json({ error: { code: 'validation_failed', message: 'Body phải là JSON.' } }, { status: 400 });
    }
    const parsed = aiGenerateBodySchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: { code: 'validation_failed', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, { status: 400 });
    const email = apiEmail(req);
    if (!email) return Response.json({ error: { code: 'forbidden', message: 'Tài khoản CMS chưa có apiUserEmail.' } }, { status: 403 });
    const b = parsed.data;
    try {
      const r = await generateQuestions({ program: b.program, section: b.sectionCode, question_type: b.questionType, topic: b.topic || undefined, difficulty: b.difficulty || undefined, count: b.count, requested_by_email: email });
      return Response.json({ jobId: r.job_id, status: r.status, mode: r.mode, input: b }, { status: 202 });
    } catch (err) {
      return Response.json({ error: { code: 'internal', message: `Không gửi được yêu cầu sinh câu: ${describeError(err)}` } }, { status: httpStatusOf(err) });
    }
  },
};

/**
 * GET /api/questions/ai-generate/:jobId – trạng thái job; khi xong thì nhập câu vào CMS (idempotent theo externalRef)
 * và trả danh sách kèm verdict AI check + cờ trùng.
 */
export const aiGenerateStatusEndpoint: Endpoint = {
  path: '/ai-generate/:jobId',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    if (!roleOf(req)) return Response.json({ error: { code: 'unauthorized', message: 'Cần đăng nhập.' } }, { status: 401 });
    const jobId = typeof req.routeParams?.jobId === 'string' ? req.routeParams.jobId : '';
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ error: { code: 'validation_failed', message: 'jobId không hợp lệ.' } }, { status: 400 });
    try {
      const job = await generationStatus(jobId);
      if (job.status !== 'completed' || !job.result) return Response.json({ jobId, status: job.status, progress: job.progress, error: job.error });
      const input = (job.input ?? {}) as { program?: string; section?: string; question_type?: string; topic?: string; difficulty?: string; count?: number };
      const body: AiGenerateBody = aiGenerateBodySchema.parse({ program: input.program, sectionCode: input.section, questionType: input.question_type, topic: input.topic, difficulty: input.difficulty, count: input.count });
      const items = await importGenerated(payloadStore(req), job.result.items, body);
      return Response.json({ jobId, status: job.status, summary: job.result.summary, items });
    } catch (err) {
      return Response.json({ error: { code: 'internal', message: `Không đọc được trạng thái: ${describeError(err)}` } }, { status: httpStatusOf(err) });
    }
  },
};
