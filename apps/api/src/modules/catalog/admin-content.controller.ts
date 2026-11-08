import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CONTENT_ENTITY_TYPES,
  CONTENT_STATUSES,
  contentImportInputSchema,
  draftTestInputSchema,
  programCodeSchema,
  reviewAssignInputSchema,
  reviewBulkInputSchema,
  reviewQueueQuerySchema,
  type ContentImportInput,
  type DraftTestInput,
  type ReviewAssignInput,
  type ReviewBulkInput,
  type ReviewQueueQuery,
} from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { ContentAiCheckService } from './content-ai-check.service.js';
import { ContentDraftTestService } from './content-draft-test.service.js';
import { ContentGenerationService, generateQuestionsInputSchema, type GenerateQuestionsInput } from './content-generation.service.js';
import { ContentImportService, XLSX_MIME } from './content-import.service.js';
import { ContentReviewQueueService } from './content-review-queue.service.js';
import { ContentWorkflowService, adminQuestionInputSchema, newVersionInputSchema, reviewInputSchema, type AdminQuestionInput, type NewVersionInput, type ReviewInput } from './content-workflow.service.js';

const listQuery = z.object({
  program: programCodeSchema.optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
  section: z.string().max(32).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const questionParam = z.object({ questionId: z.uuid() });
const jobParam = z.object({ jobId: z.uuid() });
const reviewParam = z.object({ entityType: z.enum(CONTENT_ENTITY_TYPES), entityId: z.uuid() });

const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });

/**
 * Quản trị nội dung (OpenAPI nhóm Admin): tạo câu/phiên bản, duyệt 2 lớp, AI kiểm tra. Quyền: editor/teacher/admin
 * (kiểm tra chi tiết theo máy trạng thái dùng chung – packages/schemas/content/workflow.ts).
 */
@ApiTags('Admin')
@Controller('admin')
@Roles('editor', 'teacher', 'admin', 'superadmin')
export class AdminContentController {
  constructor(
    private readonly workflow: ContentWorkflowService,
    private readonly aiCheck: ContentAiCheckService,
    private readonly generation: ContentGenerationService,
    private readonly queue: ContentReviewQueueService,
    private readonly imports: ContentImportService,
    private readonly drafts: ContentDraftTestService,
  ) {}

  // ------------------------------------------------------------------ B2: hàng chờ duyệt
  /** Hàng chờ duyệt: lọc/sắp xếp + nội dung + AI check + kiểm tra tự động + cờ nghi trùng (cursor) */
  @Get('content/review-queue')
  @ApiZod({ query: reviewQueueQuerySchema, responses: { 200: z.record(z.string(), z.unknown()) } })
  reviewQueue(@CurrentUser() user: AuthUser, @ZodQuery(reviewQueueQuerySchema) q: ReviewQueueQuery) {
    return this.queue.list({ id: user.id, roles: user.roles }, q);
  }

  /** Duyệt/từ chối/yêu cầu sửa/gửi duyệt hàng loạt (máy trạng thái dùng chung, lý do bắt buộc khi từ chối/yêu cầu sửa) */
  @Post('content/review-queue/bulk')
  @HttpCode(200)
  @ApiZod({ body: reviewBulkInputSchema, responses: { 200: z.record(z.string(), z.unknown()) } })
  reviewBulk(@CurrentUser() user: AuthUser, @ZodBody(reviewBulkInputSchema) body: ReviewBulkInput, @Req() req: FastifyRequest) {
    return this.queue.bulk({ id: user.id, roles: user.roles }, body, meta(req));
  }

  /** Phân công reviewer (teacher/admin) cho các câu */
  @Post('content/review-queue/assign')
  @HttpCode(200)
  @ApiZod({ body: reviewAssignInputSchema, responses: { 200: z.record(z.string(), z.unknown()), 403: 'empty' } })
  reviewAssign(@CurrentUser() user: AuthUser, @ZodBody(reviewAssignInputSchema) body: ReviewAssignInput, @Req() req: FastifyRequest) {
    return this.queue.assign({ id: user.id, roles: user.roles }, body.question_ids, body.assignee_id, meta(req));
  }

  /** Nhân sự nội dung (phân công reviewer, lọc người tạo) – email che */
  @Get('content/reviewers')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()) } })
  reviewers(@CurrentUser() user: AuthUser) {
    return this.queue.reviewers({ id: user.id, roles: user.roles });
  }

  /** Kiểm trùng lại một câu (embedding → pg_trgm) và trả câu tương tự */
  @Post('content/questions/:questionId/duplicate-check')
  @HttpCode(200)
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()), 404: 'empty' } })
  duplicateCheck(@CurrentUser() user: AuthUser, @ZodParams(questionParam) p: z.infer<typeof questionParam>) {
    return this.queue.similar({ id: user.id, roles: user.roles }, p.questionId);
  }

  // ------------------------------------------------------------------ B2: nhập Excel
  /** Tệp mẫu .xlsx (Arial, header #0B3BA7, dòng ví dụ, chú thích cột) */
  @Get('content/imports/template')
  @ApiZod({ responses: { 200: 'empty' } })
  importTemplate(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('content-type', XLSX_MIME).header('content-disposition', 'attachment; filename="allingo-mau-nhap-cau-hoi.xlsx"').header('cache-control', 'no-store');
    return this.imports.template();
  }

  /** Tải tệp lên: dry-run (mặc định) hoặc xác nhận ghi (fingerprint của dry-run) → 202 + job */
  @Post('content/imports')
  @HttpCode(202)
  @ApiZod({ body: contentImportInputSchema, responses: { 202: z.record(z.string(), z.unknown()), 409: 'empty' } })
  importStart(@CurrentUser() user: AuthUser, @ZodBody(contentImportInputSchema) body: ContentImportInput) {
    return this.imports.start({ id: user.id, roles: user.roles }, body);
  }

  @Get('content/imports/:jobId')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()), 404: 'empty' } })
  importStatus(@CurrentUser() user: AuthUser, @ZodParams(jobParam) p: z.infer<typeof jobParam>) {
    return this.imports.status({ id: user.id, roles: user.roles }, p.jobId);
  }

  // ------------------------------------------------------------------ B2: AI soạn nháp cả đề
  /** AI soạn nháp cả đề theo blueprint → test set nháp + câu draft source=ai vào hàng chờ duyệt (job content.draft_test) */
  @Post('generate/test-sets')
  @HttpCode(202)
  @ApiZod({ body: draftTestInputSchema, responses: { 202: z.record(z.string(), z.unknown()), 403: 'empty' } })
  draftTest(@CurrentUser() user: AuthUser, @ZodBody(draftTestInputSchema) body: DraftTestInput) {
    return this.drafts.start({ id: user.id, roles: user.roles }, body);
  }

  @Get('generate/test-sets/:jobId')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()), 404: 'empty' } })
  draftTestStatus(@CurrentUser() user: AuthUser, @ZodParams(jobParam) p: z.infer<typeof jobParam>) {
    return this.drafts.status({ id: user.id, roles: user.roles }, p.jobId);
  }

  /** Sinh lô câu hỏi AI → draft source=ai + AI check + cờ trùng (job content.generate) – 202 { job_id } (S5) */
  @Post('generate/questions')
  @HttpCode(202)
  @ApiZod({ body: generateQuestionsInputSchema, responses: { 202: z.record(z.string(), z.unknown()) } })
  generate(@CurrentUser() user: AuthUser, @ZodBody(generateQuestionsInputSchema) body: GenerateQuestionsInput) {
    return this.generation.start({ id: user.id, roles: user.roles }, body);
  }

  /** Trạng thái/kết quả job sinh câu (v1.1 – Sprint 5) */
  @Get('generate/questions/:jobId')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()), 404: 'empty' } })
  generationStatus(@ZodParams(jobParam) p: z.infer<typeof jobParam>) {
    return this.generation.status(p.jobId);
  }

  @Get('questions')
  @ApiZod({ query: listQuery, responses: { 200: z.record(z.string(), z.unknown()) } })
  list(@ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.workflow.list(q);
  }

  @Post('questions')
  @HttpCode(201)
  @ApiZod({ body: adminQuestionInputSchema, responses: { 201: z.record(z.string(), z.unknown()) } })
  create(@CurrentUser() user: AuthUser, @ZodBody(adminQuestionInputSchema) body: AdminQuestionInput) {
    return this.workflow.create({ id: user.id, roles: user.roles }, body);
  }

  @Get('questions/:questionId/versions')
  @ApiZod({ responses: { 200: z.array(z.record(z.string(), z.unknown())) } })
  versions(@ZodParams(questionParam) p: z.infer<typeof questionParam>) {
    return this.workflow.versions(p.questionId);
  }

  @Post('questions/:questionId/versions')
  @HttpCode(201)
  @ApiZod({ body: newVersionInputSchema, responses: { 201: z.record(z.string(), z.unknown()) } })
  newVersion(@CurrentUser() user: AuthUser, @ZodParams(questionParam) p: z.infer<typeof questionParam>, @ZodBody(newVersionInputSchema) body: NewVersionInput) {
    return this.workflow.newVersion({ id: user.id, roles: user.roles }, p.questionId, body);
  }

  @Post('questions/:questionId/ai-check')
  @HttpCode(200)
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()) } })
  runAiCheck(@CurrentUser() user: AuthUser, @ZodParams(questionParam) p: z.infer<typeof questionParam>, @Req() req: FastifyRequest) {
    return this.aiCheck.runForQuestion({ id: user.id, roles: user.roles }, p.questionId, meta(req));
  }

  @Post('content/:entityType/:entityId/review')
  @HttpCode(200)
  @ApiZod({ body: reviewInputSchema, responses: { 200: z.record(z.string(), z.unknown()) } })
  review(@CurrentUser() user: AuthUser, @ZodParams(reviewParam) p: z.infer<typeof reviewParam>, @ZodBody(reviewInputSchema) body: ReviewInput, @Req() req: FastifyRequest) {
    return this.workflow.review({ id: user.id, roles: user.roles }, p.entityType, p.entityId, body, meta(req));
  }
}
