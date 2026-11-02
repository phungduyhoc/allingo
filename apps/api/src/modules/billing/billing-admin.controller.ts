import { Controller, Get, HttpCode, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  adminCreditAdjustInputSchema,
  adminCreditAdjustResultSchema,
  adminDeadLettersQuerySchema,
  adminInvoiceSchema,
  adminInvoicesQuerySchema,
  adminOrdersQuerySchema,
  adminPaymentSchema,
  adminPaymentsQuerySchema,
  adminPromotionsQuerySchema,
  adminSubscriptionsQuerySchema,
  BILLING_JOBS,
  cursorQuerySchema,
  deadLetterSchema,
  invoiceReconciliationSchema,
  isoDateSchema,
  ledgerEntrySchema,
  pageSchema,
  paymentProviderCodeSchema,
  promotionAdminSchema,
  promotionCreateInputSchema,
  promotionPatchInputSchema,
  reconciliationRunInputSchema,
  reconciliationRunSchema,
  refundInputSchema,
  subscriptionSchema,
  type AdminCreditAdjustInput,
  type BillingJob,
  type PromotionCreateInput,
  type PromotionPatchInput,
  type RefundInput,
  type ReconciliationRunInput,
} from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { BillingAdminService } from './billing-admin.service.js';
import { FeatureFlagService } from './feature-flags.service.js';
import { InvoicesService } from './invoices/invoices.service.js';
import { PromotionsService } from './promotions.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const orderParam = z.object({ orderId: z.uuid() });
const runParam = z.object({ runId: z.uuid() });
const runQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });
const runsQuery = z.object({ provider: paymentProviderCodeSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
const jobParam = z.object({ job: z.enum(BILLING_JOBS) });
/** v1.1 – S10: tham số chạy tay (chỉ admin) – `min_age_minutes` bỏ ngưỡng PAYMENT_RECONCILE_AFTER_MINUTES của payment.reconcile */
const jobBody = z.object({ min_age_minutes: z.number().int().min(0).max(1440).optional() }).strict();
const flagParam = z.object({ key: z.string().regex(/^ff\.[a-z0-9_]+(\.[a-z0-9_]+)+$/) });
// S8: `rules.config` – cấu hình tính năng (vd ff.growth.referral: rewards, monthly_cap…)
const flagBody = z.object({ enabled: z.boolean().optional(), rules: z.object({ percent: z.number().min(0).max(100).optional(), user_ids: z.array(z.uuid()).max(500).optional(), plan_kinds: z.array(z.string()).max(10).optional(), programs: z.array(z.string()).max(10).optional(), config: z.record(z.string(), z.unknown()).optional() }).optional() });
const userParam = z.object({ userId: z.uuid() });
const deadLetterParam = z.object({ deadLetterId: z.uuid() });
const promotionParam = z.object({ promotionId: z.uuid() });
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM') });
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
    private readonly invoices: InvoicesService,
    private readonly promotions: PromotionsService,
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
  @ApiZod({ body: jobBody, responses: { 200: z.record(z.string(), z.unknown()), 202: z.record(z.string(), z.unknown()), 400: 'empty' } })
  async runJob(@ZodParams(jobParam) p: z.infer<typeof jobParam>, @ZodBody(jobBody) body: z.infer<typeof jobBody>, @Res({ passthrough: true }) reply: FastifyReply) {
    const job: BillingJob = p.job;
    const params = body.min_age_minutes !== undefined ? { min_age_minutes: body.min_age_minutes } : {};
    const d = await this.jobs.dispatch('maintenance', job, `manual-${Date.now()}`, params);
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

  // ------------------------------------------------------------------ S8: credit thủ công, ledger, danh sách, hoá đơn, khuyến mãi
  /** Cấp/trừ credit thủ công – ledger `admin_adjust` (note = lý do bắt buộc), audit `user.grant_credits` có admin id; trừ quá số dư → 409 */
  @Post('users/:userId/credits')
  @HttpCode(200)
  @ApiZod({ body: adminCreditAdjustInputSchema, responses: { 200: adminCreditAdjustResultSchema } })
  adjustCredits(@CurrentUser() user: AuthUser, @ZodParams(userParam) p: z.infer<typeof userParam>, @ZodBody(adminCreditAdjustInputSchema) body: AdminCreditAdjustInput, @Req() req: FastifyRequest) {
    return this.admin.adjustCredits(user, p.userId, body, meta(req));
  }

  @Get('users/:userId/credits/ledger')
  @ApiZod({ query: cursorQuerySchema, responses: { 200: pageSchema(ledgerEntrySchema).extend({ user_id: z.uuid(), balance: z.number().int() }) } })
  userLedger(@ZodParams(userParam) p: z.infer<typeof userParam>, @ZodQuery(cursorQuerySchema) q: z.infer<typeof cursorQuerySchema>) {
    return this.admin.userLedger(p.userId, q.cursor, q.limit);
  }

  @Get('billing/payments')
  @ApiZod({ query: adminPaymentsQuerySchema, responses: { 200: pageSchema(adminPaymentSchema) } })
  payments(@ZodQuery(adminPaymentsQuerySchema) q: z.infer<typeof adminPaymentsQuerySchema>) {
    return this.admin.listPayments(q);
  }

  @Get('billing/subscriptions')
  @ApiZod({ query: adminSubscriptionsQuerySchema, responses: { 200: pageSchema(subscriptionSchema.extend({ user_id: z.uuid().nullable(), user_email: z.string().nullable().optional(), created_at: z.string() })) } })
  subscriptionsList(@ZodQuery(adminSubscriptionsQuerySchema) q: z.infer<typeof adminSubscriptionsQuerySchema>) {
    return this.admin.listSubscriptions(q);
  }

  @Get('billing/invoices')
  @ApiZod({ query: adminInvoicesQuerySchema, responses: { 200: pageSchema(adminInvoiceSchema) } })
  invoicesList(@ZodQuery(adminInvoicesQuerySchema) q: z.infer<typeof adminInvoicesQuerySchema>) {
    return this.invoices.list(q);
  }

  /** Đối chiếu hoá đơn tháng: hoá đơn hiệu lực = đơn paid − refunded (theo paid_at, giờ VN) */
  @Get('billing/invoices/reconciliation')
  @ApiZod({ query: monthQuery, responses: { 200: invoiceReconciliationSchema } })
  invoiceReconciliation(@ZodQuery(monthQuery) q: z.infer<typeof monthQuery>) {
    return this.invoices.reconcileMonth(q.month);
  }

  @Get('billing/dead-letters')
  @ApiZod({ query: adminDeadLettersQuerySchema, responses: { 200: pageSchema(deadLetterSchema) } })
  deadLetters(@ZodQuery(adminDeadLettersQuerySchema) q: z.infer<typeof adminDeadLettersQuerySchema>) {
    return this.invoices.deadLetters(q);
  }

  /** Thử lại job hoá đơn trong dead-letter (đặt lại số lần thử; inline ≤ 10 s trả kết quả) */
  @Post('billing/dead-letters/:deadLetterId/retry')
  @HttpCode(200)
  @ApiZod({ responses: { 200: z.object({ dead_letter: deadLetterSchema, outcome: z.record(z.string(), z.unknown()).nullable(), mode: z.enum(['inline', 'queued']) }) } })
  retryDeadLetter(@CurrentUser() user: AuthUser, @ZodParams(deadLetterParam) p: z.infer<typeof deadLetterParam>, @Req() req: FastifyRequest) {
    return this.invoices.retryDeadLetter(p.deadLetterId, user, meta(req));
  }

  @Get('promotions')
  @ApiZod({ query: adminPromotionsQuerySchema, responses: { 200: pageSchema(promotionAdminSchema) } })
  promotionsList(@ZodQuery(adminPromotionsQuerySchema) q: z.infer<typeof adminPromotionsQuerySchema>) {
    return this.promotions.adminList(q);
  }

  @Post('promotions')
  @HttpCode(201)
  @ApiZod({ body: promotionCreateInputSchema, responses: { 201: promotionAdminSchema } })
  promotionCreate(@CurrentUser() user: AuthUser, @ZodBody(promotionCreateInputSchema) body: PromotionCreateInput, @Req() req: FastifyRequest) {
    return this.promotions.adminCreate(body, user, meta(req));
  }

  @Get('promotions/:promotionId')
  @ApiZod({ responses: { 200: promotionAdminSchema } })
  promotionGet(@ZodParams(promotionParam) p: z.infer<typeof promotionParam>) {
    return this.promotions.adminGet(p.promotionId);
  }

  @Patch('promotions/:promotionId')
  @ApiZod({ body: promotionPatchInputSchema, responses: { 200: promotionAdminSchema } })
  promotionPatch(@CurrentUser() user: AuthUser, @ZodParams(promotionParam) p: z.infer<typeof promotionParam>, @ZodBody(promotionPatchInputSchema) body: PromotionPatchInput, @Req() req: FastifyRequest) {
    return this.promotions.adminPatch(p.promotionId, body, user, meta(req));
  }
}
