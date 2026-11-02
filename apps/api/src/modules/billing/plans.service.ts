import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { ValidationFailed } from '../../shared/http/errors.js';

const { billingPlans, billingPrices } = schema;
export type PlanRow = typeof billingPlans.$inferSelect;
export type PriceRow = typeof billingPrices.$inferSelect;

/** Giá đang hiệu lực: valid_from ≤ now < valid_to (hoặc không hạn), khu vực VN */
const priceValidNow = (region = 'VN') => and(eq(billingPrices.region, region), sql`${billingPrices.validFrom} <= now()`, or(isNull(billingPrices.validTo), sql`${billingPrices.validTo} > now()`));

export function enabledFeatures(plan: Pick<PlanRow, 'features'>): string[] {
  return Object.entries((plan.features ?? {}) as Record<string, unknown>)
    .filter(([, v]) => v === true || (typeof v === 'object' && v !== null))
    .map(([k]) => k);
}

export function planSummary(p: PlanRow) {
  return { id: p.id, code: p.code, kind: p.kind, programs: p.programCodes.filter(Boolean), name: p.name, credits_included: p.creditsIncluded, credits_period: p.creditsPeriod ?? null, duration_days: p.durationDays ?? null };
}

/** Catalog gói & giá (GET /plans) + chốt giá phía server cho POST /orders */
@Injectable()
export class PlansService {
  constructor(private readonly dbs: DbService) {}

  async list(program?: string, region = 'VN') {
    const rows = await this.dbs.db
      .select({ plan: billingPlans, price: billingPrices })
      .from(billingPlans)
      .leftJoin(billingPrices, and(eq(billingPrices.planId, billingPlans.id), priceValidNow(region)))
      .where(eq(billingPlans.isActive, true))
      .orderBy(asc(billingPlans.sortOrder), desc(billingPrices.validFrom));
    const seen = new Set<string>();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.plan.id)) continue; // một giá hiện hành / gói (mới nhất)
      seen.add(r.plan.id);
      const programs = r.plan.programCodes.filter(Boolean);
      if (program && programs.length > 0 && !programs.includes(program)) continue;
      out.push({
        id: r.plan.id,
        code: r.plan.code,
        kind: r.plan.kind,
        programs,
        name: r.plan.name,
        description: r.plan.description ?? null,
        price: r.price ? { id: r.price.id, amount: Number(r.price.amount), currency: r.price.currency.trim(), compare_at: r.price.compareAt ? Number(r.price.compareAt) : null, valid_to: r.price.validTo?.toISOString() ?? null } : null,
        credits_included: r.plan.creditsIncluded,
        credits_period: r.plan.creditsPeriod ?? null,
        duration_days: r.plan.durationDays ?? null,
        features: (r.plan.features as Record<string, unknown>) ?? {},
      });
    }
    return out;
  }

  /** Chốt giá: price_id hợp lệ ngay lúc này (hoặc giá hiện hành của plan_id) của gói đang bán, có thể mua */
  async resolve(input: { priceId?: string; planId?: string }, db: DbOrTx = this.dbs.db): Promise<{ plan: PlanRow; price: PriceRow }> {
    const where = input.priceId ? eq(billingPrices.id, input.priceId) : eq(billingPrices.planId, input.planId!);
    const [row] = await db
      .select({ plan: billingPlans, price: billingPrices })
      .from(billingPrices)
      .innerJoin(billingPlans, eq(billingPlans.id, billingPrices.planId))
      .where(and(where, priceValidNow(), eq(billingPlans.isActive, true)))
      .orderBy(desc(billingPrices.validFrom))
      .limit(1);
    if (!row) throw new ValidationFailed({ issues: [{ path: input.priceId ? 'price_id' : 'plan_id', message: 'price not found or not currently valid', code: 'price_unavailable' }] });
    if (input.priceId && input.planId && row.plan.id !== input.planId) throw new ValidationFailed({ issues: [{ path: 'plan_id', message: 'price does not belong to plan', code: 'price_plan_mismatch' }] });
    if (row.plan.kind === 'free' || row.plan.kind === 'b2b_seat') throw new ValidationFailed({ issues: [{ path: 'price_id', message: `plan kind ${row.plan.kind} cannot be purchased here`, code: 'plan_not_purchasable' }] });
    if (row.price.currency.trim() !== 'VND') throw new ValidationFailed({ issues: [{ path: 'price_id', message: 'only VND prices are supported', code: 'currency_unsupported' }] });
    return { plan: row.plan, price: row.price };
  }

  async byId(planId: string, db: DbOrTx = this.dbs.db): Promise<PlanRow | null> {
    const [p] = await db.select().from(billingPlans).where(eq(billingPlans.id, planId)).limit(1);
    return p ?? null;
  }
}
