import { Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminOrdersQuerySchema, BILLING_JOBS, isoDateSchema, paymentProviderCodeSchema, reconciliationRunInputSchema, reconciliationRunSchema, refundInputSchema, type BillingJob, type RefundInput, type ReconciliationRunInput } from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { BillingAdminService } from './billing-admin.service.js';
import { FeatureFlagService } from './feature-flags.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const orderParam = z.object({ orderId: z.uuid() });
const runParam = z.object({ runId: z.uuid() });
const runQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });
const runsQuery = z.object({ provider: paymentProviderCodeSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
const jobParam = z.object({ job: z.enum(BILLING_JOBS) });
const flagParam = z.object({ key: z.string().regex(/^ff\.[a-z0-9_]+(\.[a-z0-9_]+)+$/) });
const flagBody = z.object({ enabled: z.boolean().optional(), rules: z.object({ percent: z.number().min(0).max(100).optional(), user_ids: z.array(z.uuid()).max(500).optional(), plan_kinds: z.array(z.string()).max(10).optional(), programs: z.array(z.string()).max(10).optional() }).optional() });
const summaryQuery = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });

const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });

/** Màn admin billing (v1.1 – S7; giao diện web làm sau): đơn, hoàn tiền thủ công, đối soát, chạy job, feature flag */
@ApiTags('Admin')
@Controller('admin')
@Roles('admin', 'superadmin')
export class BillingAdminController {
  constructor(
    private readonly admin: BillingAdminService,
    private readonly reconciliation: ReconciliationService,
    private readonly flags: FeatureFlagService,
    private readonly jobs: JobsService,
  ) {}

  /** Hoàn tiền thủ công: paid → refunded, thu hồi entitlement + credit còn lại, ledger `refund`, audit. TODO(S8) API refund cổng */
  @Post('orders/:orderId/refund')
  @HttpCode(200)
  @ApiZod({ body: refundInputSchema, responses: { 200: z.record(z.string(), z.unknown()) } })
  refund(@CurrentUser() user: AuthUser, @ZodParams(orderParam) p: z.infer<typeof orderParam>, @ZodBody(refundInputSchema) body: RefundInput, @Req() req: FastifyRequest) {
    return this.admin.refund(user, p.orderId, body, meta(req));
  }

  @Get('billing/orders')
  @ApiZod({ query: adminOrdersQuerySchema, responses: { 200: z.record(z.string(), z.unknown()) } })
  orders(@ZodQuery(adminOrdersQuerySchema) q: z.infer<typeof adminOrdersQuerySchema>) {
    return this.admin.listOrders(q);
  }

  @Get('billing/summary')
  @ApiZod({ query: summaryQuery, responses: { 200: z.record(z.string(), z.unknown()) } })
  summary(@ZodQuery(summaryQuery) q: z.infer<typeof summaryQuery>) {
    return this.admin.summary(q);
  }

  @Get('billing/reconciliations')
  @ApiZod({ query: runsQuery, responses: { 200: z.array(reconciliationRunSchema) } })
  runs(@ZodQuery(runsQuery) q: z.infer<typeof runsQuery>) {
    return this.reconciliation.list(q);
  }

  /** Đối soát một cổng × ngày: CSV sao kê (JSON `{ csv }`) hoặc queryStatus; chạy lại ghi đè (UNIQUE provider × ngày) */
  @Post('billing/reconciliations')
  @HttpCode(201)
  @ApiZod({ body: reconciliationRunInputSchema, responses: { 201: reconciliationRunSchema } })
  run(@CurrentUser() user: AuthUser, @ZodBody(reconciliationRunInputSchema) body: ReconciliationRunInput) {
    return this.reconciliation.run(body, user);
  }

  /** Báo cáo một lần đối soát; `format=csv` → tải danh sách lệch */
  @Get('billing/reconciliations/:runId')
  @ApiZod({ query: runQuery, responses: { 200: reconciliationRunSchema } })
  async getRun(@ZodParams(runParam) p: z.infer<typeof runParam>, @ZodQuery(runQuery) q: z.infer<typeof runQuery>, @Res({ passthrough: true }) reply: FastifyReply) {
    if (q.format === 'csv') {
      const csv = await this.reconciliation.csv(p.runId);
      void reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="reconciliation-${p.runId}.csv"`);
      return csv;
    }
    return this.reconciliation.get(p.runId);
  }

  /** Chạy ngay một job billing (đơn kẹt, đối soát…) – inline xong trong 10 s → 200 + kết quả, nếu không 202 */
  @Post('billing/jobs/:job')
  @HttpCode(202)
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()), 202: z.record(z.string(), z.unknown()) } })
  async runJob(@ZodParams(jobParam) p: z.infer<typeof jobParam>, @Res({ passthrough: true }) reply: FastifyReply) {
    const job: BillingJob = p.job;
    const d = await this.jobs.dispatch('maintenance', job, `manual-${Date.now()}`, {});
    if (d.done) {
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([d.done, new Promise((r) => (timer = setTimeout(() => r(undefined), 10_000)))]).finally(() => clearTimeout(timer));
      if (result !== undefined) {
        void reply.status(200);
        return { job, job_id: d.jobId, mode: d.mode, status: 'completed', result };
      }
    }
    return { job, job_id: d.jobId, mode: d.mode, status: 'queued' };
  }

  /** Bật/tắt feature flag theo quy tắc (`ff.billing.checkout`…) – audit `flag.update` */
  @Put('flags/:key')
  @ApiZod({ body: flagBody, responses: { 200: z.record(z.string(), z.unknown()) } })
  setFlag(@CurrentUser() user: AuthUser, @ZodParams(flagParam) p: z.infer<typeof flagParam>, @ZodBody(flagBody) body: z.infer<typeof flagBody>, @Req() req: FastifyRequest) {
    return this.flags.set(p.key, body, user, meta(req));
  }
}
