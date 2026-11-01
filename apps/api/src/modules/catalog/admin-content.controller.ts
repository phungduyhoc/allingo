import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CONTENT_ENTITY_TYPES, CONTENT_STATUSES, programCodeSchema } from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { ContentAiCheckService } from './content-ai-check.service.js';
import { ContentGenerationService, generateQuestionsInputSchema, type GenerateQuestionsInput } from './content-generation.service.js';
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
  ) {}

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
