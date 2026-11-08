import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JOB_NAMES, PROGRAM_CODES, adminJobRunResultSchema, adminSystemStatusSchema, aiQualityReportSchema, aiRefusalsPageSchema, auditLogsPageSchema, betaReportSchema, deadLetterReplayResultSchema, deadLettersPageSchema, questionStatsPageSchema } from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { AiQualityService } from '../ai-gateway/index.js';
import { BetaReportService } from '../analytics/index.js';
import { QuestionStatsService } from '../catalog/index.js';
import { AdminOpsService } from './admin-ops.service.js';

const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());
const page = { cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) };
const statsQuery = z.object({ program: z.enum(PROGRAM_CODES).optional(), section: z.string().max(32).optional(), recommendation: z.enum(['retire', 'review', 'ok', 'insufficient_data']).optional(), sort: z.enum(['p_value', 'discrimination', 'reports', 'n', 'avg_time']).optional(), min_n: z.coerce.number().int().min(0).optional(), ...page });
const rangeQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), task_code: z.string().max(64).optional() });
const refusalsQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), ...page });
const dlQuery = z.object({ queue: z.string().max(32).optional(), job: z.string().max(64).optional(), replayed: boolish, ...page });
const dlParam = z.object({ deadLetterId: z.uuid() });
const auditQuery = z.object({ actor: z.uuid().optional(), action: z.string().max(100).optional(), entity_type: z.string().max(64).optional(), entity_id: z.uuid().optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), ...page });
const betaQuery = z.object({ week: z.string().regex(/^\d{4}-W\d{2}$/).optional() });

function vnRange(q: { from?: string; to?: string }, days = 30): { from: Date; to: Date } {
  const to = q.to ? new Date(`${q.to}T23:59:59.999+07:00`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00+07:00`) : new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

/** Admin tổng hợp (S12): nội dung (thống kê câu), AI (chất lượng/refused), hệ thống (hàng đợi, DLQ, partition), audit, KPI beta */
@ApiTags('Admin')
@Controller('admin')
@Roles('admin', 'superadmin')
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly stats: QuestionStatsService,
    private readonly ai: AiQualityService,
    private readonly jobs: JobsService,
    private readonly betaReport: BetaReportService,
  ) {}

  @Get('content/questions/stats')
  @ApiZod({ query: statsQuery, responses: { 200: questionStatsPageSchema } })
  questionStats(@ZodQuery(statsQuery) q: z.infer<typeof statsQuery>) {
    return this.stats.list(q);
  }

  @Post('content/questions/stats/recompute')
  @HttpCode(202)
  @ApiZod({ responses: { 202: adminJobRunResultSchema } })
  async recompute() {
    const r = await this.jobs.dispatch('maintenance', JOB_NAMES.CONTENT_STATS_NIGHTLY, `manual-${Date.now()}`, {});
    const result = r.done ? await Promise.race([r.done, new Promise((res) => setTimeout(() => res(null), 15_000))]).catch(() => null) : null;
    return { job_id: r.jobId, mode: r.mode, result: (result as Record<string, unknown> | null) ?? null };
  }

  @Get('ai/quality')
  @ApiZod({ query: rangeQuery, responses: { 200: aiQualityReportSchema } })
  quality(@ZodQuery(rangeQuery) q: z.infer<typeof rangeQuery>) {
    const { from, to } = vnRange(q);
    return this.ai.quality(from, to, q.task_code);
  }

  @Get('ai/refusals')
  @ApiZod({ query: refusalsQuery, responses: { 200: aiRefusalsPageSchema } })
  refusals(@ZodQuery(refusalsQuery) q: z.infer<typeof refusalsQuery>) {
    const { from, to } = vnRange(q);
    return this.ai.refusals(from, to, q.cursor, q.limit);
  }

  @Get('system/status')
  @ApiZod({ responses: { 200: adminSystemStatusSchema } })
  system() {
    return this.ops.systemStatus();
  }

  @Get('jobs/dead-letters')
  @ApiZod({ query: dlQuery, responses: { 200: deadLettersPageSchema } })
  deadLetters(@ZodQuery(dlQuery) q: z.infer<typeof dlQuery>) {
    return this.ops.deadLetters(q);
  }

  @Post('jobs/dead-letters/:deadLetterId/replay')
  @HttpCode(200)
  @ApiZod({ responses: { 200: deadLetterReplayResultSchema, 404: 'empty', 409: 'empty' } })
  replay(@CurrentUser() user: AuthUser, @ZodParams(dlParam) p: z.infer<typeof dlParam>) {
    return this.ops.replay(user, p.deadLetterId);
  }

  @Get('audit-logs')
  @ApiZod({ query: auditQuery, responses: { 200: auditLogsPageSchema, 400: 'empty' } })
  audit(@ZodQuery(auditQuery) q: z.infer<typeof auditQuery>) {
    return this.ops.auditLogs(q);
  }

  @Get('reports/beta')
  @ApiZod({ query: betaQuery, responses: { 200: betaReportSchema } })
  beta(@ZodQuery(betaQuery) q: z.infer<typeof betaQuery>) {
    return this.betaReport.weekly(q.week);
  }
}
