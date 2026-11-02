import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { FeatureCode } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { Forbidden } from '../../shared/http/errors.js';

const { billingPlans, billingSubscriptions, billingVActiveEntitlements } = schema;

export type PlanKind = 'free' | 'monthly' | 'yearly' | 'lifetime' | 'combo' | 'credit_pack' | 'b2b_seat';

export interface EntitlementContext {
  userId: string;
  program: string;
  isPro: boolean;
  planKind: PlanKind;
  features: Set<string>;
}

/**
 * Entitlement vật chất hoá (ADR-0010): đọc billing.v_active_entitlements; Free lấy features từ plan 'free'.
 * Cache Redis 60 giây; invalidate khi billing thay đổi (thanh toán, hoàn tiền, huỷ, hết hạn – S7).
 * `planKind` = gói của subscription đang hiệu lực ưu tiên combo > lifetime > yearly > monthly (quyết định quota áp dụng).
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  private key(userId: string, program: string) {
    return `ent:${userId}:${program}`;
  }

  async getContext(userId: string, program: string): Promise<EntitlementContext> {
    const cached = await this.redis.safe((r) => r.get(this.key(userId, program)));
    if (cached) {
      const parsed = JSON.parse(cached) as { isPro: boolean; planKind: PlanKind; features: string[] };
      return { userId, program, isPro: parsed.isPro, planKind: parsed.planKind, features: new Set(parsed.features) };
    }
    const rows = await this.dbs.db
      .select({ feature: billingVActiveEntitlements.featureCode })
      .from(billingVActiveEntitlements)
      .where(and(eq(billingVActiveEntitlements.userId, userId), or(isNull(billingVActiveEntitlements.programCode), eq(billingVActiveEntitlements.programCode, program))));
    let isPro = rows.length > 0;
    let planKind: PlanKind = 'free';
    const features = new Set<string>(rows.map((r) => r.feature).filter((f): f is string => !!f));
    if (isPro) {
      const [sub] = await this.dbs.db
        .select({ kind: billingPlans.kind })
        .from(billingSubscriptions)
        .innerJoin(billingPlans, eq(billingPlans.id, billingSubscriptions.planId))
        .where(
          and(
            eq(billingSubscriptions.userId, userId),
            inArray(billingSubscriptions.status, ['active', 'trialing', 'lifetime']),
            or(isNull(billingSubscriptions.programCode), eq(billingSubscriptions.programCode, program)),
            // Kỳ đang hiệu lực (S7: gia hạn nối tiếp tạo subscription bắt đầu trong tương lai – chưa tính)
            sql`${billingSubscriptions.currentPeriodStart} <= now()`,
            or(isNull(billingSubscriptions.currentPeriodEnd), sql`${billingSubscriptions.currentPeriodEnd} > now()`),
          ),
        )
        .orderBy(sql`case ${billingPlans.kind} when 'combo' then 0 when 'lifetime' then 1 when 'yearly' then 2 else 3 end`)
        .limit(1);
      planKind = (sub?.kind) ?? 'monthly';
      if (!sub) isPro = features.size > 0;
    } else {
      const [free] = await this.dbs.db.select({ features: billingPlans.features }).from(billingPlans).where(eq(billingPlans.code, 'free')).limit(1);
      for (const [k, v] of Object.entries((free?.features ?? {}) as Record<string, unknown>)) if (v) features.add(k);
    }
    await this.redis.safe((r) => r.set(this.key(userId, program), JSON.stringify({ isPro, planKind, features: [...features] }), 'EX', 60));
    return { userId, program, isPro, planKind, features };
  }

  /** Ném Forbidden nếu không có quyền tính năng (kiểm tra ở server – CLAUDE.md §5.7) */
  async require(userId: string, program: string, feature: FeatureCode): Promise<EntitlementContext> {
    const ctx = await this.getContext(userId, program);
    if (!ctx.features.has(feature)) throw new Forbidden('Feature requires an upgrade', { feature, program, upgrade: true });
    return ctx;
  }

  async invalidate(userId: string): Promise<void> {
    await this.redis.safe(async (r) => {
      const keys = await r.keys(`ent:${userId}:*`);
      if (keys.length) await r.del(...keys);
      return null;
    });
  }
}
