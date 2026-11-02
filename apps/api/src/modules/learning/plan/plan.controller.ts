import { Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  planAdjustApplyResultSchema,
  planAdjustInstructionSchema,
  planAdjustListQuerySchema,
  planAdjustListSchema,
  planAdjustProposalSchema,
  planCheckinInputSchema,
  planCheckinResultSchema,
  planCreateInputSchema,
  planQuerySchema,
  planRegenerateInputSchema,
  planRegenerateResultSchema,
  planTaskPatchSchema,
  planTaskSchema,
  planTodaySchema,
  studyPlanSchema,
  type PlanCheckinInput,
  type PlanCreateInput,
  type PlanTaskPatch,
} from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../../shared/http/zod.js';
import { PlanAdjustService } from './plan-adjust.service.js';
import { PlanService } from './plan.service.js';

const proposalParam = z.object({ proposalId: z.uuid() });
const taskParam = z.object({ taskId: z.uuid() });

/** Lộ trình học S9: /me/plan*, /plan-tasks/{taskId} (docs/spec/allingo-openapi.yaml v1.1) */
@ApiTags('Learning')
@Controller()
export class PlanController {
  constructor(
    private readonly plans: PlanService,
    private readonly adjust: PlanAdjustService,
  ) {}

  @Get('me/plan')
  @ApiZod({ query: planQuerySchema, responses: { 200: studyPlanSchema, 404: 'empty' } })
  get(@CurrentUser() user: AuthUser, @ZodQuery(planQuerySchema) q: z.infer<typeof planQuerySchema>) {
    return this.plans.get(user.id, q.program);
  }

  @Post('me/plan')
  @HttpCode(201)
  @ApiZod({ body: planCreateInputSchema, responses: { 201: studyPlanSchema, 400: 'empty', 403: 'empty', 503: 'empty' } })
  create(@CurrentUser() user: AuthUser, @ZodBody(planCreateInputSchema) body: PlanCreateInput) {
    return this.plans.create(user.id, body);
  }

  @Post('me/plan/regenerate')
  @HttpCode(202)
  @ApiZod({ body: planRegenerateInputSchema, responses: { 202: planRegenerateResultSchema, 404: 'empty', 503: 'empty' } })
  regenerate(@CurrentUser() user: AuthUser, @ZodBody(planRegenerateInputSchema) body: z.infer<typeof planRegenerateInputSchema>) {
    return this.plans.regenerate(user.id, body.program);
  }

  @Get('me/plan/today')
  @ApiZod({ query: planQuerySchema, responses: { 200: planTodaySchema } })
  today(@CurrentUser() user: AuthUser, @ZodQuery(planQuerySchema) q: z.infer<typeof planQuerySchema>) {
    return this.plans.today(user.id, q.program);
  }

  @Post('me/plan/checkin')
  @HttpCode(200)
  @ApiZod({ body: planCheckinInputSchema, responses: { 200: planCheckinResultSchema, 404: 'empty' } })
  checkin(@CurrentUser() user: AuthUser, @ZodBody(planCheckinInputSchema) body: PlanCheckinInput) {
    return this.adjust.checkin(user.id, body);
  }

  @Get('me/plan/adjust')
  @ApiZod({ query: planAdjustListQuerySchema, responses: { 200: planAdjustListSchema } })
  proposals(@CurrentUser() user: AuthUser, @ZodQuery(planAdjustListQuerySchema) q: z.infer<typeof planAdjustListQuerySchema>) {
    return this.adjust.list(user.id, q.program, q.limit);
  }

  /** Câu lệnh tự nhiên → đề xuất; 200 khi đã có kết quả (inline), 202 khi job còn chạy (status pending) */
  @Post('me/plan/adjust')
  @HttpCode(200)
  @ApiZod({ body: planAdjustInstructionSchema, responses: { 200: planAdjustProposalSchema, 202: planAdjustProposalSchema, 400: 'empty', 402: 'empty', 404: 'empty' } })
  async instruct(@CurrentUser() user: AuthUser, @ZodBody(planAdjustInstructionSchema) body: z.infer<typeof planAdjustInstructionSchema>, @Res({ passthrough: true }) reply: FastifyReply) {
    const p = await this.adjust.instruct(user.id, body);
    if (p.status === 'pending') void reply.status(202);
    return p;
  }

  @Post('me/plan/adjust/:proposalId/apply')
  @HttpCode(200)
  @ApiZod({ responses: { 200: planAdjustApplyResultSchema, 403: 'empty', 404: 'empty', 409: 'empty' } })
  apply(@CurrentUser() user: AuthUser, @ZodParams(proposalParam) p: z.infer<typeof proposalParam>) {
    return this.adjust.apply(user.id, p.proposalId);
  }

  @Patch('plan-tasks/:taskId')
  @ApiZod({ body: planTaskPatchSchema, responses: { 200: planTaskSchema, 400: 'empty', 403: 'empty', 404: 'empty' } })
  patchTask(@CurrentUser() user: AuthUser, @ZodParams(taskParam) p: z.infer<typeof taskParam>, @ZodBody(planTaskPatchSchema) body: PlanTaskPatch) {
    return this.plans.patchTask(user.id, p.taskId, body);
  }
}
