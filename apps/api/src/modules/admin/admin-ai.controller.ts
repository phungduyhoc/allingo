import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { EvalService, PromptAdminService, evalRunCreateSchema, promptStatusInputSchema, promptTemplateCreateSchema, promptVersionInputSchema, type PromptStatusInput, type PromptTemplateCreate, type PromptVersionInput } from '../ai-gateway/index.js';

const templateParam = z.object({ templateId: z.uuid() });
const versionParam = z.object({ versionId: z.uuid() });
const evalRunsQuery = z.object({
  task_code: z.string().max(64).optional(),
  prompt_version_id: z.uuid().optional(),
  eval_set_id: z.uuid().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Admin AI (S5, OpenAPI nhóm Admin): vòng đời prompt (draft → canary → active → retired, cổng eval 409) và eval run.
 * Logic nằm ở ai-gateway (PromptAdminService, EvalService); controller chỉ kiểm tra quyền admin/superadmin.
 */
@ApiTags('Admin')
@Controller('admin')
@Roles('admin', 'superadmin')
export class AdminAiController {
  constructor(
    private readonly prompts: PromptAdminService,
    private readonly evals: EvalService,
  ) {}

  @Get('prompts')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()) } })
  listPrompts() {
    return this.prompts.list();
  }

  @Post('prompts')
  @HttpCode(201)
  @ApiZod({ body: promptTemplateCreateSchema, responses: { 201: z.record(z.string(), z.unknown()), 409: 'empty' } })
  createTemplate(@CurrentUser() user: AuthUser, @ZodBody(promptTemplateCreateSchema) body: PromptTemplateCreate) {
    return this.prompts.createTemplate({ id: user.id, roles: user.roles }, body);
  }

  @Post('prompts/:templateId/versions')
  @HttpCode(201)
  @ApiZod({ body: promptVersionInputSchema, responses: { 201: z.record(z.string(), z.unknown()) } })
  createVersion(@CurrentUser() user: AuthUser, @ZodParams(templateParam) p: z.infer<typeof templateParam>, @ZodBody(promptVersionInputSchema) body: PromptVersionInput) {
    return this.prompts.createVersion({ id: user.id, roles: user.roles }, p.templateId, body);
  }

  /** draft → canary(x%) → active → retired; canary/active cần eval (không mock) đạt ngưỡng, thiếu → 409 reason=eval_required */
  @Patch('prompts/versions/:versionId/status')
  @HttpCode(200)
  @ApiZod({ body: promptStatusInputSchema, responses: { 200: z.record(z.string(), z.unknown()), 409: 'empty' } })
  setStatus(@CurrentUser() user: AuthUser, @ZodParams(versionParam) p: z.infer<typeof versionParam>, @ZodBody(promptStatusInputSchema) body: PromptStatusInput) {
    return this.prompts.setStatus({ id: user.id, roles: user.roles }, p.versionId, body);
  }

  @Get('eval-runs')
  @ApiZod({ query: evalRunsQuery, responses: { 200: z.record(z.string(), z.unknown()) } })
  listEvalRuns(@ZodQuery(evalRunsQuery) q: z.infer<typeof evalRunsQuery>) {
    return this.evals.listRuns(q);
  }

  /** Chạy eval set với phiên bản prompt (job eval.run) → 202 { run_id } */
  @Post('eval-runs')
  @HttpCode(202)
  @ApiZod({ body: evalRunCreateSchema, responses: { 202: z.record(z.string(), z.unknown()) } })
  startEvalRun(@CurrentUser() user: AuthUser, @ZodBody(evalRunCreateSchema) body: z.infer<typeof evalRunCreateSchema>) {
    return this.evals.startRun(body, user.id);
  }
}
