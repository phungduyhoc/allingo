import type { Endpoint, PayloadRequest } from 'payload';
import { roleOf } from '../lib/access';
import { checkQuestion, describeError, InternalApiError } from '../lib/internal-api';
import { validateQuestionContent } from '../lib/validate';
import type { AiReport } from '../lib/workflow';

/**
 * POST /api/questions/:id/ai-check – gọi task `check_question` qua API nội bộ (AI Gateway, mock ở dev),
 * lưu `aiReport`; verdict pass/needs_change → status `ai_checked`; fail → giữ nguyên trạng thái, chỉ lưu báo cáo.
 * API nội bộ chưa chạy → 503 với thông điệp thân thiện, không đổi dữ liệu.
 */
export const aiCheckEndpoint: Endpoint = {
  path: '/:id/ai-check',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    const role = roleOf(req);
    if (!role) return Response.json({ error: { code: 'unauthorized', message: 'Cần đăng nhập.' } }, { status: 401 });
    const id = typeof req.routeParams?.id === 'string' ? req.routeParams.id : '';
    if (!id) return Response.json({ error: { code: 'validation_failed', message: 'Thiếu id câu hỏi.' } }, { status: 400 });

    const doc = await req.payload.findByID({ collection: 'questions', id, depth: 0, req, overrideAccess: false });
    const status = doc.status;
    if (status !== 'draft' && status !== 'ai_checked' && status !== 'rejected') {
      return Response.json(
        { error: { code: 'conflict', message: `Chỉ kiểm tra AI khi câu hỏi ở trạng thái nháp/AI đã kiểm tra/từ chối (hiện: ${status}).` } },
        { status: 409 },
      );
    }
    const content = validateQuestionContent(doc.questionType, doc.content);
    if (!content.ok) {
      return Response.json({ error: { code: 'validation_failed', message: content.message, details: { issues: content.issues } } }, { status: 422 });
    }

    let report: AiReport;
    try {
      const res = await checkQuestion({ program: doc.program, section_code: doc.sectionCode, content: content.value });
      report = { verdict: res.verdict, issues: res.issues ?? [], ai_task_id: res.ai_task_id ?? null, checked_at: new Date().toISOString(), ...(res.report ? { report: res.report } : {}) };
    } catch (err) {
      const message = describeError(err);
      const httpStatus = err instanceof InternalApiError && err.kind === 'http' ? (err.status ?? 502) : 503;
      req.payload.logger.warn({ msg: 'ai-check failed', questionId: id, err: message });
      return Response.json({ error: { code: 'internal', message: `Không gửi AI kiểm tra được: ${message}` } }, { status: httpStatus >= 400 ? httpStatus : 503 });
    }

    const nextStatus = report.verdict === 'fail' ? status : 'ai_checked';
    const updated = await req.payload.update({
      collection: 'questions',
      id,
      data: { aiReport: report, status: nextStatus },
      depth: 0,
      req,
      overrideAccess: false,
      // draft → ai_checked chỉ hợp lệ qua cờ aiCheck (xem lib/workflow.ts)
      context: { aiCheck: true },
    });
    return Response.json({ status: updated.status, aiReport: report });
  },
};
