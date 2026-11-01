import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { DEFAULT_DUPLICATE_THRESHOLD, programCodeSchema, questionContentSchema } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { InternalTokenGuard, Public } from '../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../shared/http/zod.js';
import { ValidationFailed } from '../../shared/http/errors.js';
import { ContentAiCheckService } from './content-ai-check.service.js';
import { ContentGenerationService, generateQuestionsInputSchema } from './content-generation.service.js';
import { ContentPublishService, publishTestSetSchema, type PublishTestSetInput } from './content-publish.service.js';
import { ContentWorkflowService, syncQuestionSchema, type SyncQuestionInput } from './content-workflow.service.js';

const checkSchema = z.object({ program: programCodeSchema, section_code: z.string(), content: questionContentSchema, difficulty_target: z.string().optional() });
const duplicatesSchema = z.object({
  program: programCodeSchema,
  stems: z.array(z.string().max(4000)).min(1).max(2000),
  threshold: z.number().min(0.5).max(1).default(DEFAULT_DUPLICATE_THRESHOLD),
  exclude_external_refs: z.array(z.string().max(128)).max(2000).default([]),
});
const validateTestSetSchema = publishTestSetSchema.pick({ program: true, kind: true, items: true });
const internalGenerateSchema = generateQuestionsInputSchema.extend({ requested_by_email: z.string().max(254) });

/** Guard X-Internal-Token (token từ env) */
@Injectable()
export class InternalTokenGuardFactory implements CanActivate {
  private readonly inner: InternalTokenGuard;
  constructor(@Inject(ENV) env: Env) {
    this.inner = new InternalTokenGuard(env.INTERNAL_API_TOKEN);
  }
  canActivate(ctx: ExecutionContext): boolean {
    return this.inner.canActivate(ctx);
  }
}

/**
 * API nội bộ cho CMS (ADR-0019/0024) – không nằm trong OpenAPI công khai, bảo vệ bằng X-Internal-Token.
 * CMS đồng bộ mọi lần lưu/chuyển trạng thái câu hỏi qua `questions/sync`; catalog là nguồn sự thật vòng đời nội dung.
 */
@ApiExcludeController()
@Controller('internal/content')
@Public()
@UseGuards(InternalTokenGuardFactory)
export class InternalContentController {
  constructor(
    private readonly publish: ContentPublishService,
    private readonly workflow: ContentWorkflowService,
    private readonly aiCheck: ContentAiCheckService,
    private readonly generation: ContentGenerationService,
  ) {}

  /** CMS "Sinh câu hỏi bằng AI" (S5): actor = tài khoản API của biên tập viên (apiUserEmail) – 202 { job_id } */
  @Post('questions/generate')
  @HttpCode(202)
  async generate(@Body(new ZodValidationPipe(internalGenerateSchema)) body: z.infer<typeof internalGenerateSchema>) {
    const { requested_by_email, ...input } = body;
    const actor = await this.generation.actorByEmail(requested_by_email);
    return this.generation.start(actor, input);
  }

  @Get('questions/generate/:jobId')
  generationStatus(@Param('jobId') jobId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new ValidationFailed({ issues: [{ path: 'jobId', message: 'invalid uuid' }] });
    return this.generation.status(jobId);
  }

  @Get('reference')
  reference() {
    return this.publish.reference();
  }

  /** Đồng bộ câu hỏi + trạng thái + quyết định duyệt (idempotent theo external_ref) */
  @Post('questions/sync')
  @HttpCode(200)
  syncQuestion(@Body(new ZodValidationPipe(syncQuestionSchema)) body: SyncQuestionInput) {
    return this.workflow.syncFromCms(body);
  }

  /** Tương thích Sprint 0: phát hành = sync với status published */
  @Post('questions/publish')
  @HttpCode(200)
  publishQuestion(@Body(new ZodValidationPipe(syncQuestionSchema)) body: SyncQuestionInput) {
    return this.workflow.syncFromCms({ ...body, status: 'published' });
  }

  @Get('questions/:questionId/reviews')
  reviews(@Param('questionId') questionId: string) {
    return this.workflow.reviews('question', questionId);
  }

  /** Phát hiện trùng khi nhập hàng loạt (trong lô + với catalog, pg_trgm) */
  @Post('questions/duplicates')
  @HttpCode(200)
  duplicates(@Body(new ZodValidationPipe(duplicatesSchema)) body: z.infer<typeof duplicatesSchema>) {
    return this.workflow.findDuplicates(body.program, body.stems, body.threshold, body.exclude_external_refs);
  }

  @Post('test-sets/validate')
  @HttpCode(200)
  validateTestSet(@Body(new ZodValidationPipe(validateTestSetSchema)) body: z.infer<typeof validateTestSetSchema>) {
    return this.publish.validateTestSet(body);
  }

  @Post('test-sets/publish')
  @HttpCode(200)
  publishTestSet(@Body(new ZodValidationPipe(publishTestSetSchema)) body: PublishTestSetInput) {
    return this.publish.publishTestSet(body);
  }

  /** AI kiểm tra nội dung (check_question qua AiGateway, mock ở dev) – CMS gọi trước khi đặt ai_checked */
  @Post('questions/check')
  @HttpCode(200)
  check(@Body(new ZodValidationPipe(checkSchema)) body: z.infer<typeof checkSchema>) {
    return this.aiCheck.check(body);
  }
}
