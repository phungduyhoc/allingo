import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { programCodeSchema, questionContentSchema, type CheckQuestionOutput } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { InternalTokenGuard, Public } from '../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../shared/http/zod.js';
import { AiGatewayService } from '../ai-gateway/core/ai-gateway.service.js';
import { ContentPublishService, publishQuestionSchema, publishTestSetSchema, type PublishQuestionInput, type PublishTestSetInput } from './content-publish.service.js';

const checkSchema = z.object({ program: programCodeSchema, section_code: z.string(), content: questionContentSchema, difficulty_target: z.string().optional() });

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
 * API nội bộ cho CMS (ADR-0019) – không nằm trong OpenAPI công khai, bảo vệ bằng X-Internal-Token.
 */
@ApiExcludeController()
@Controller('internal/content')
@Public()
@UseGuards(InternalTokenGuardFactory)
export class InternalContentController {
  constructor(
    private readonly publish: ContentPublishService,
    private readonly gateway: AiGatewayService,
  ) {}

  @Get('reference')
  reference() {
    return this.publish.reference();
  }

  @Post('questions/publish')
  @HttpCode(200)
  publishQuestion(@Body(new ZodValidationPipe(publishQuestionSchema)) body: PublishQuestionInput) {
    return this.publish.publishQuestion(body);
  }

  @Post('test-sets/publish')
  @HttpCode(200)
  publishTestSet(@Body(new ZodValidationPipe(publishTestSetSchema)) body: PublishTestSetInput) {
    return this.publish.publishTestSet(body);
  }

  /** AI kiểm tra câu hỏi (check_question) – mock ở dev */
  @Post('questions/check')
  @HttpCode(200)
  async check(@Body(new ZodValidationPipe(checkSchema)) body: z.infer<typeof checkSchema>) {
    const r = await this.gateway.runTask<CheckQuestionOutput>({
      taskCode: 'check_question',
      userId: null,
      chargeCredits: false,
      program: body.program,
      variables: { program: body.program, section_code: body.section_code, question_type: body.content.type, difficulty_target: { level: body.difficulty_target ?? 'B1', irt_b: 0 }, section_rules: {}, item: body.content },
      inputRef: { purpose: 'cms_check' },
    });
    return {
      verdict: r.data.verdict,
      issues: r.data.issues.map((i) => ({ field: i.area, severity: i.severity === 'major' ? 'error' : 'warning', message: i.detail + (i.fix ? ` → ${i.fix}` : '') })),
      report: r.data,
      ai_task_id: r.aiTaskId,
    };
  }
}
