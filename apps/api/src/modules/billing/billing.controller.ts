import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { creditBalanceSchema, entitlementsSchema, planSchema, programCodeSchema } from '@allingo/schemas';
import { CurrentUser, Public, type AuthUser } from '../../shared/auth/auth.guard.js';
import { DbService } from '../../shared/db/db.module.js';
import { ApiZod, ZodQuery } from '../../shared/http/zod.js';
import { CreditService } from './credit.service.js';
import { EntitlementService } from './entitlement.service.js';
import { QuotaService } from './quota.service.js';

const programQuery = z.object({ program: programCodeSchema.default('toeic') });
const plansQuery = z.object({ program: programCodeSchema.optional() });

@ApiTags('Billing')
@Controller()
export class BillingController {
  constructor(
    private readonly dbs: DbService,
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly credits: CreditService,
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

  @Public()
  @Get('plans')
  @ApiZod({ query: plansQuery, responses: { 200: z.array(planSchema) } })
  async plans(@ZodQuery(plansQuery) q: z.infer<typeof plansQuery>) {
    const rows = await this.dbs.db
      .select({ plan: schema.billingPlans, price: schema.billingPrices })
      .from(schema.billingPlans)
      .leftJoin(schema.billingPrices, and(eq(schema.billingPrices.planId, schema.billingPlans.id), eq(schema.billingPrices.region, 'VN'), or(isNull(schema.billingPrices.validTo), sql`${schema.billingPrices.validTo} > now()`)))
      .where(eq(schema.billingPlans.isActive, true))
      .orderBy(schema.billingPlans.sortOrder);
    return rows
      .filter((r) => !q.program || r.plan.programCodes.length === 0 || r.plan.programCodes.includes(q.program))
      .map((r) => ({
        id: r.plan.id,
        code: r.plan.code,
        kind: r.plan.kind,
        programs: r.plan.programCodes,
        name: r.plan.name,
        description: (r.plan.description) ?? null,
        price: r.price ? { amount: Number(r.price.amount), currency: r.price.currency.trim(), compare_at: r.price.compareAt ? Number(r.price.compareAt) : null } : null,
        credits_included: r.plan.creditsIncluded,
        credits_period: r.plan.creditsPeriod ?? null,
        duration_days: r.plan.durationDays ?? null,
        features: (r.plan.features as Record<string, unknown>) ?? {},
      }));
  }
}
