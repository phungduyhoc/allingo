import { Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  creditBalanceSchema,
  cursorQuerySchema,
  entitlementsSchema,
  ledgerEntrySchema,
  pageSchema,
  paymentProvidersSchema,
  planSchema,
  programCodeSchema,
  promotionValidateInputSchema,
  promotionValidateResultSchema,
  subscriptionSchema,
} from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { CurrentUser, Public, type AuthUser } from '../../shared/auth/auth.guard.js';
import { DbService } from '../../shared/db/db.module.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { FeatureFlagService } from './feature-flags.service.js';
import { CHECKOUT_FLAG } from './orders.service.js';
import { PaymentProviderRegistry } from './payments/provider-registry.js';
import { PlansService } from './plans.service.js';
import { toVnd } from './pricing.js';
import { PromotionsService } from './promotions.service.js';
import { QuotaService } from './quota.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

const programQuery = z.object({ program: programCodeSchema.default('toeic') });
const plansQuery = z.object({ program: programCodeSchema.optional(), region: z.string().max(8).default('VN') });
const subParam = z.object({ subscriptionId: z.uuid() });

const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });

@ApiTags('Billing')
@Controller()
export class BillingController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly credits: CreditService,
    private readonly plansSvc: PlansService,
    private readonly promotions: PromotionsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly providers: PaymentProviderRegistry,
    private readonly flags: FeatureFlagService,
  ) {}

  @Get('me/entitlements')
  @ApiZod({ query: programQuery, responses: { 200: entitlementsSchema } })
  async myEntitlements(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    const ctx = await this.entitlements.getContext(user.id, q.program);
    const [quotas, credits] = await Promise.all([this.quotas.statusFor(user.id, ctx.planKind), this.credits.balance(user.id)]);
    return { program: q.program, is_pro: ctx.isPro, plan_kind: ctx.planKind, features: [...ctx.features], quotas, credits };
  }

  @Get('me/credits')
  @ApiZod({ responses: { 200: creditBalanceSchema } })
  async myCredits(@CurrentUser() user: AuthUser) {
    const [balance, expiring, routes] = await Promise.all([
      this.credits.balance(user.id),
      this.credits.expiringSoon(user.id),
      this.dbs.db.select({ task: schema.aiModelRoutes.taskCode, cost: schema.aiModelRoutes.creditsCost }).from(schema.aiModelRoutes).where(eq(schema.aiModelRoutes.isActive, true)),
    ]);
    return { balance, expiring_soon: expiring, costs: Object.fromEntries(routes.map((r) => [r.task, r.cost])) };
  }

  /** Lịch sử credit (nạp/tiêu/hoàn/hết hạn) – cursor theo id giảm dần (v1.1 – S7) */
  @Get('me/credits/ledger')
  @ApiZod({ query: cursorQuerySchema, responses: { 200: pageSchema(ledgerEntrySchema) } })
  ledger(@CurrentUser() user: AuthUser, @ZodQuery(cursorQuerySchema) q: z.infer<typeof cursorQuerySchema>) {
    return this.credits.ledgerPage(user.id, q.cursor, q.limit);
  }

  /** Gói & giá hiện hành (VND) theo chương trình – gói của chương trình + combo + gói credit + Free; `price.id` dùng cho POST /orders */
  @Public()
  @Get('plans')
  @ApiZod({ query: plansQuery, responses: { 200: z.array(planSchema) } })
  plans(@ZodQuery(plansQuery) q: z.infer<typeof plansQuery>) {
    return this.plansSvc.list(q.program, q.region);
  }

  /** Cổng thanh toán khả dụng (thiếu credential → không liệt kê) + cờ ff.billing.checkout (v1.1 – S7) */
  @Public()
  @Get('payments/providers')
  @ApiZod({ responses: { 200: paymentProvidersSchema } })
  async paymentProviders(@Req() req: FastifyRequest & { user?: AuthUser }) {
    return {
      checkout_enabled: await this.flags.isEnabled(CHECKOUT_FLAG, { userId: req.user?.id ?? null }, true),
      providers: this.providers.listAvailable().map((p) => ({ code: p.code, methods: [...p.methods], sandbox: p.sandbox })),
    };
  }

  /** Kiểm tra mã giảm giá cho gói (S7: mã cố định từ seed) – luôn 200, `valid=false` kèm `reason` */
  @Post('promotions/validate')
  @HttpCode(200)
  @ApiZod({ body: promotionValidateInputSchema, responses: { 200: promotionValidateResultSchema } })
  async validatePromotion(@CurrentUser() user: AuthUser, @ZodBody(promotionValidateInputSchema) body: z.infer<typeof promotionValidateInputSchema>) {
    const { plan, price } = await this.plansSvc.resolve({ priceId: body.price_id, planId: body.plan_id });
    return this.promotions.validate(user.id, body.code, plan.id, toVnd(price.amount), new Date(this.clock.now()));
  }

  @Get('me/subscriptions')
  @ApiZod({ responses: { 200: z.array(subscriptionSchema) } })
  mySubscriptions(@CurrentUser() user: AuthUser) {
    return this.subscriptions.listMine(user.id);
  }

  /** Huỷ gia hạn: giữ quyền tới hết kỳ, ngừng cấp credit tháng; lifetime/đã hết hạn → 409 */
  @Post('me/subscriptions/:subscriptionId/cancel')
  @HttpCode(200)
  @ApiZod({ responses: { 200: subscriptionSchema } })
  cancel(@CurrentUser() user: AuthUser, @ZodParams(subParam) p: z.infer<typeof subParam>, @Req() req: FastifyRequest) {
    return this.subscriptions.cancel(user, p.subscriptionId, meta(req));
  }
}
