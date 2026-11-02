import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { PromotionValidateResult } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { evaluatePromotion, normalizePromoCode, toVnd, type PromotionRow } from './pricing.js';

const { billingPromotions, billingOrders } = schema;

/**
 * Mã khuyến mãi (S7: mã cố định từ seed, điều kiện cơ bản – S8 đầy đủ). Lượt dùng chỉ tính đơn ĐÃ THANH TOÁN
 * (`orders.promotion_id`, trạng thái paid/refunded); `used_count` tăng trong transaction xác nhận thanh toán.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly dbs: DbService) {}

  async findByCode(code: string, db: DbOrTx = this.dbs.db): Promise<PromotionRow | null> {
    const [p] = await db.select().from(billingPromotions).where(eq(billingPromotions.code, normalizePromoCode(code))).limit(1);
    if (!p) return null;
    return { id: p.id, code: p.code, kind: p.kind, value: Number(p.value), planIds: p.planIds ?? null, validFrom: p.validFrom, validTo: p.validTo, maxUses: p.maxUses ?? null, usedCount: p.usedCount, perUserLimit: p.perUserLimit, isActive: p.isActive };
  }

  async userPaidUses(userId: string, promotionId: string, db: DbOrTx = this.dbs.db): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(billingOrders)
      .where(and(eq(billingOrders.userId, userId), eq(billingOrders.promotionId, promotionId), inArray(billingOrders.status, ['paid', 'refunded'])));
    return r?.n ?? 0;
  }

  async evaluate(userId: string, code: string, planId: string, subtotal: number, now: Date, db: DbOrTx = this.dbs.db) {
    const promo = await this.findByCode(code, db);
    const uses = promo ? await this.userPaidUses(userId, promo.id, db) : 0;
    return { promo, result: evaluatePromotion(promo, { planId, subtotal: toVnd(subtotal), now, userPaidUses: uses }) };
  }

  async validate(userId: string, code: string, planId: string, subtotal: number, now: Date): Promise<PromotionValidateResult> {
    const { promo, result } = await this.evaluate(userId, code, planId, subtotal, now);
    return {
      valid: result.ok,
      code: normalizePromoCode(code),
      reason: result.ok ? null : result.reason,
      kind: promo && (promo.kind === 'percent' || promo.kind === 'amount') ? promo.kind : null,
      value: promo ? promo.value : null,
      subtotal: result.computation.subtotal,
      discount: result.computation.discount,
      total: result.computation.total,
      currency: 'VND',
    };
  }

  /** Tăng lượt dùng khi đơn được thanh toán (trong transaction xác nhận) */
  async markUsed(tx: DbOrTx, promotionId: string): Promise<void> {
    await tx.update(billingPromotions).set({ usedCount: sql`${billingPromotions.usedCount} + 1` }).where(eq(billingPromotions.id, promotionId));
  }
}
