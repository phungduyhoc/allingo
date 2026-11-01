import type { CollectionBeforeChangeHook, CollectionBeforeValidateHook, CollectionConfig, PayloadRequest } from 'payload';
import { ValidationError } from 'payload';
import type { QuestionContent } from '@allingo/schemas';
import { aiCheckEndpoint } from '../endpoints/ai-check';
import type { Question } from '../payload-types';
import { importQuestionsEndpoint } from '../endpoints/import-questions';
import { referenceEndpoint } from '../endpoints/reference';
import { isAdmin, isLoggedIn, roleOf } from '../lib/access';
import { describeError, syncQuestion, type SyncQuestionRequest } from '../lib/internal-api';
import { DIFFICULTY_CODES, PROGRAM_OPTIONS, QUESTION_TYPE_OPTIONS } from '../lib/reference';
import { validateMcqAnswerKeys, validateQuestionContent } from '../lib/validate';
import {
  EDITABLE_CONTENT_STATUSES,
  evaluateTransition,
  isQuestionStatus,
  QUESTION_STATUSES,
  REVIEW_DECISIONS,
  STATUS_LABELS,
  type AiReport,
  type QuestionStatus,
} from '../lib/workflow';

/**
 * Câu hỏi soạn thảo trong CMS (schema `cms`). Mọi lần đổi trạng thái/nội dung được đồng bộ sang catalog qua
 * `POST /internal/content/questions/sync` (ADR-0024 – catalog là nguồn sự thật vòng đời + content_reviews);
 * `publishedRef` lưu id/version bên catalog khi phát hành.
 */

/** Dữ liệu hook: `data` là Partial<Question>, `originalDoc` là Question (payload-types.ts sinh bởi `payload generate:types`) */
type QuestionData = Partial<Question>;
type ReviewEntry = NonNullable<Question['reviews']>[number];

function fail(path: string, message: string, req: PayloadRequest): never {
  throw new ValidationError({ collection: 'questions', errors: [{ path, message }], req });
}

function userEmail(req: PayloadRequest): string {
  const u = req.user as { email?: string; apiUserEmail?: string | null } | null;
  return u?.apiUserEmail ?? u?.email ?? 'system';
}

/** So sánh JSON không phụ thuộc thứ tự khoá (JSONB của Postgres sắp xếp lại khoá khi lưu) */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** Chuẩn hoá: ép content.type = questionType, parse qua Zod để lưu giá trị có default; sinh title nếu trống */
const normalizeBeforeValidate: CollectionBeforeValidateHook<Question> = ({ data, originalDoc }) => {
  if (!data) return data;
  const questionType = data.questionType ?? originalDoc?.questionType;
  const rawContent = data.content ?? originalDoc?.content;
  if (questionType && rawContent && typeof rawContent === 'object') {
    const res = validateQuestionContent(questionType, rawContent);
    if (res.ok) data.content = res.value;
  }
  if (!data.title || data.title.trim() === '') {
    const c = (data.content ?? originalDoc?.content) as Partial<QuestionContent> | undefined;
    const stem = typeof c?.stem === 'string' ? c.stem.trim() : '';
    const evidence = typeof c?.evidence === 'string' ? c.evidence.trim() : '';
    const base = stem || evidence;
    const prefix = `${(data.program ?? originalDoc?.program ?? '').toUpperCase()} ${data.sectionCode ?? originalDoc?.sectionCode ?? ''}`.trim();
    data.title = base ? `${prefix ? `[${prefix}] ` : ''}${base.slice(0, 90)}` : `${prefix || 'Câu hỏi'} – ${new Date().toISOString().slice(0, 16)}`;
  }
  return data;
};

/** Máy trạng thái + phát hành (xem lib/workflow.ts) */
const workflowBeforeChange: CollectionBeforeChangeHook<Question> = async ({ data, operation, originalDoc, req }) => {
  const ctx = req.context as { skipWorkflow?: boolean; aiCheck?: boolean };
  const role = roleOf(req) ?? (ctx.skipWorkflow ? 'admin' : null);
  if (!role) fail('status', 'Cần đăng nhập với vai trò editor/teacher/admin.', req);

  const original = originalDoc;
  const from: QuestionStatus = isQuestionStatus(original?.status) ? original.status : 'draft';
  let to: QuestionStatus = isQuestionStatus(data.status) ? data.status : from;

  const prevContent = original?.content;
  const contentChanged = operation === 'update' && data.content !== undefined && !sameJson(data.content, prevContent);

  if (ctx.skipWorkflow) {
    // Seed/import hệ thống: chỉ kiểm tra content, không áp máy trạng thái
    data.status = to;
    return data;
  }

  if (operation === 'create') {
    if (to !== 'draft') fail('status', 'Câu hỏi mới luôn bắt đầu ở trạng thái "Nháp".', req);
    data.status = 'draft';
    data.reviews = [];
    data.publishedRef = {};
    return data;
  }

  // Editor không sửa nội dung khi đang duyệt/đã phát hành
  if (contentChanged && role === 'editor' && !EDITABLE_CONTENT_STATUSES.has(from)) {
    fail('content', `Không thể sửa nội dung khi câu hỏi đang ở "${STATUS_LABELS[from].vi}". Hãy nhờ giáo viên/admin trả về nháp.`, req);
  }

  // Sửa nội dung sau khi AI đã kiểm tra → quay về nháp để kiểm tra lại
  if (contentChanged && from === 'ai_checked' && to === 'ai_checked') to = 'draft';

  const note = data.reviewNote ?? null;
  const aiReport = (data.aiReport ?? original?.aiReport ?? null) as AiReport | null;
  const prevReviews: ReviewEntry[] = [...(original?.reviews ?? [])];
  const review1Approver = [...prevReviews].reverse().find((r) => r.stage === 'review1' && r.decision === 'approve')?.reviewer ?? null;
  const result = evaluateTransition({ from, to, role, aiReport, note, viaAiCheck: ctx.aiCheck === true, actorId: userEmail(req), review1ApproverId: review1Approver });
  if (!result.ok) fail('status', result.message, req);

  const reviews: ReviewEntry[] = prevReviews;
  const now = new Date().toISOString();
  // Quyết định ghi sang catalog.content_reviews: AI kiểm tra ghi đúng verdict (pass→approve, needs_change, fail→reject)
  let catalogReview: SyncQuestionRequest['review'] = null;
  if (ctx.aiCheck === true && aiReport?.verdict) {
    const decision = aiReport.verdict === 'pass' ? 'approve' : aiReport.verdict === 'fail' ? 'reject' : 'needs_change';
    catalogReview = { stage: 'ai_check', decision, notes: (aiReport.issues ?? []).map((i) => i.message).join('\n') || null, reviewer_email: null, ai_report: aiReport };
    if (from === to) reviews.push({ stage: 'ai_check', decision, reviewer: 'ai', note: null, at: now });
  }
  if (result.effect.review) {
    const autoNote = contentChanged && from === 'ai_checked' && to === 'draft' ? 'Nội dung thay đổi sau khi AI kiểm tra – cần kiểm tra lại.' : null;
    reviews.push({ stage: result.effect.review.stage, decision: result.effect.review.decision, reviewer: userEmail(req), note: note || autoNote, at: now });
    if (!catalogReview) catalogReview = { stage: result.effect.review.stage, decision: result.effect.review.decision, notes: note || autoNote, reviewer_email: userEmail(req) };
  }

  // Đồng bộ sang catalog khi trạng thái hoặc nội dung đổi (cả sửa nhanh câu đã phát hành của teacher/admin → phiên bản mới)
  const statusChanged = from !== to;
  if (statusChanged || contentChanged || catalogReview) {
    const merged: QuestionData = { ...original, ...data };
    const content = validateQuestionContent(merged.questionType, merged.content);
    if (!content.ok) {
      if (to === 'published' || statusChanged) fail('content', content.message, req);
    } else {
      const externalRef = merged.externalRef ?? (original?.id ? String(original.id) : null);
      if (!externalRef) fail('status', 'Thiếu externalRef – lưu câu hỏi trước khi đổi trạng thái.', req);
      try {
        const res = await syncQuestion({
          external_ref: externalRef,
          program: merged.program ?? 'toeic',
          section_code: merged.sectionCode ?? '',
          question_type: merged.questionType ?? content.value.type,
          content: content.value,
          status: to,
          difficulty: merged.difficulty ?? undefined,
          topic_code: merged.topicCode ?? undefined,
          subskill_codes: (merged.subskillCodes ?? []).map((s) => s.code).filter(Boolean),
          source: merged.source === 'ai' ? 'ai' : 'human',
          change_note: note ?? undefined,
          created_by_email: userEmail(req),
          review: catalogReview,
        });
        if (to === 'published') data.publishedRef = { questionId: res.question_id, questionVersionId: res.question_version_id, versionNo: res.version_no, publishedAt: now };
      } catch (err) {
        // Đổi trạng thái phải được ghi nhận ở catalog (nguồn sự thật); chỉ sửa nháp mới cho lưu tạm khi API chưa chạy
        if (statusChanged || to === 'published' || catalogReview) fail('status', `Đồng bộ catalog thất bại, giữ nguyên trạng thái "${STATUS_LABELS[from].vi}". ${describeError(err)}`, req);
        req.payload.logger.warn({ msg: 'catalog sync deferred (draft edit)', err: describeError(err) });
      }
    }
  }

  data.status = to;
  data.reviews = reviews;
  data.reviewNote = '';
  return data;
};

export const Questions: CollectionConfig = {
  slug: 'questions',
  labels: { singular: { vi: 'Câu hỏi', en: 'Question' }, plural: { vi: 'Câu hỏi', en: 'Questions' } },
  admin: {
    useAsTitle: 'title',
    group: { vi: 'Nội dung', en: 'Content' },
    defaultColumns: ['title', 'program', 'sectionCode', 'questionType', 'status', 'updatedAt'],
    listSearchableFields: ['title', 'sectionCode', 'topicCode', 'externalRef'],
    description: {
      vi: 'Quy trình: Nháp → (AI kiểm tra) → Duyệt vòng 1 → Duyệt vòng 2 → Phát hành (đồng bộ sang catalog qua API nội bộ).',
      en: 'Workflow: draft → (AI check) → review1 → review2 → published (synced to catalog via internal API).',
    },
    components: {
      edit: { beforeDocumentControls: ['/components/ai-check-button#AiCheckButton'] },
    },
  },
  access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  endpoints: [aiCheckEndpoint, importQuestionsEndpoint, referenceEndpoint],
  hooks: {
    beforeValidate: [normalizeBeforeValidate],
    beforeChange: [workflowBeforeChange],
    afterChange: [
      // externalRef = id (ổn định, dùng làm khoá idempotent khi phát hành)
      async ({ doc, operation, req }) => {
        if (operation === 'create' && !doc.externalRef) {
          const content = validateQuestionContent(doc.questionType, doc.content);
          if (content.ok && !(req.context as { skipWorkflow?: boolean }).skipWorkflow) {
            try {
              await syncQuestion({
                external_ref: String(doc.id),
                program: doc.program ?? 'toeic',
                section_code: doc.sectionCode ?? '',
                question_type: doc.questionType ?? content.value.type,
                content: content.value,
                status: 'draft',
                difficulty: doc.difficulty ?? undefined,
                topic_code: doc.topicCode ?? undefined,
                subskill_codes: (doc.subskillCodes ?? []).map((s: { code: string }) => s.code).filter(Boolean),
                source: doc.source === 'ai' ? 'ai' : 'human',
                created_by_email: userEmail(req),
              });
            } catch (err) {
              req.payload.logger.warn({ msg: 'catalog sync deferred (new draft)', err: describeError(err) });
            }
          }
          await req.payload.update({
            collection: 'questions',
            id: doc.id,
            data: { externalRef: String(doc.id) },
            req,
            depth: 0,
            overrideAccess: true,
            context: { skipWorkflow: true },
          });
          return { ...doc, externalRef: String(doc.id) };
        }
        return doc;
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', label: { vi: 'Tiêu đề (tự sinh từ đề bài nếu trống)', en: 'Title (auto from stem)' } },
    {
      type: 'row',
      fields: [
        { name: 'program', type: 'select', required: true, defaultValue: 'toeic', options: [...PROGRAM_OPTIONS], label: { vi: 'Chương trình', en: 'Program' } },
        {
          name: 'sectionCode',
          type: 'text',
          required: true,
          label: { vi: 'Phần (section_code)', en: 'Section code' },
          admin: { components: { Field: '/components/section-code-field#SectionCodeField' } },
        },
        {
          name: 'questionType',
          type: 'select',
          required: true,
          defaultValue: 'mcq_single',
          options: QUESTION_TYPE_OPTIONS,
          label: { vi: 'Dạng câu', en: 'Question type' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'difficulty', type: 'select', options: DIFFICULTY_CODES.map((d) => ({ label: d, value: d })), label: { vi: 'Độ khó', en: 'Difficulty' } },
        { name: 'topicCode', type: 'text', label: { vi: 'Chủ đề (topic_code)', en: 'Topic code' } },
        {
          name: 'source',
          type: 'select',
          required: true,
          defaultValue: 'human',
          options: [
            { label: { vi: 'Tự soạn (human)', en: 'Human' }, value: 'human' },
            { label: { vi: 'AI sinh', en: 'AI' }, value: 'ai' },
            { label: { vi: 'Có bản quyền (licensed)', en: 'Licensed' }, value: 'licensed' },
          ],
          label: { vi: 'Nguồn', en: 'Source' },
        },
      ],
    },
    {
      name: 'subskillCodes',
      type: 'array',
      label: { vi: 'Kỹ năng con (subskill_codes)', en: 'Subskill codes' },
      fields: [{ name: 'code', type: 'text', required: true }],
      admin: { initCollapsed: true },
    },
    { name: 'passage', type: 'relationship', relationTo: 'passages', label: { vi: 'Đoạn văn / script', en: 'Passage' } },
    {
      name: 'content',
      type: 'json',
      required: true,
      label: { vi: 'Nội dung câu hỏi (JSON theo dạng)', en: 'Question content' },
      admin: { components: { Field: '/components/question-content-field#QuestionContentField' } },
      validate: (value: unknown, { siblingData }: { siblingData: QuestionData }) => {
        const res = validateQuestionContent(siblingData.questionType, value);
        if (!res.ok) return res.message;
        const keyErr = validateMcqAnswerKeys(res.value);
        return keyErr ?? true;
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: QUESTION_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
      label: { vi: 'Trạng thái', en: 'Status' },
      admin: {
        position: 'sidebar',
        description: {
          vi: 'Editor: nháp → gửi duyệt vòng 1. Teacher/Admin: vòng 1 → vòng 2 → phát hành; trả về nháp cần ghi chú.',
          en: 'Editor: draft → review1. Teacher/Admin: review1 → review2 → published; returning to draft requires a note.',
        },
      },
    },
    {
      name: 'reviewNote',
      type: 'textarea',
      label: { vi: 'Ghi chú duyệt (bắt buộc khi trả lại/từ chối)', en: 'Review note' },
      admin: { position: 'sidebar', rows: 3 },
    },
    { name: 'externalRef', type: 'text', label: 'externalRef', admin: { position: 'sidebar', readOnly: true }, index: true },
    {
      name: 'publishedRef',
      type: 'group',
      label: { vi: 'Tham chiếu catalog (sau phát hành)', en: 'Catalog reference' },
      admin: { position: 'sidebar', readOnly: true },
      fields: [
        { name: 'questionId', type: 'text', label: 'question_id' },
        { name: 'questionVersionId', type: 'text', label: 'question_version_id' },
        { name: 'versionNo', type: 'number', label: 'version_no' },
        { name: 'publishedAt', type: 'date', label: 'published_at' },
      ],
    },
    {
      name: 'aiReport',
      type: 'json',
      label: { vi: 'Kết quả AI kiểm tra', en: 'AI check report' },
      admin: { readOnly: true, description: { vi: 'Ghi bởi nút "Gửi AI kiểm tra" (task check_question).', en: 'Written by the "AI check" button.' } },
    },
    {
      name: 'reviews',
      type: 'array',
      label: { vi: 'Lịch sử duyệt', en: 'Review history' },
      admin: { readOnly: true, initCollapsed: true },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'stage', type: 'select', options: ['ai_check', 'review1', 'review2'], required: true },
            { name: 'decision', type: 'select', options: [...REVIEW_DECISIONS], required: true },
            { name: 'reviewer', type: 'text' },
            { name: 'at', type: 'date', required: true },
          ],
        },
        { name: 'note', type: 'textarea' },
      ],
    },
    { name: 'importKey', type: 'text', label: 'importKey', index: true, admin: { hidden: true } },
  ],
};
