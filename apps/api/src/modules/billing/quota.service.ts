import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { FeatureCode } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { QuotaExceeded } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import type { PlanKind } from './entitlement.service.js';

const { billingQuotas, billingUsageCounters } = schema;

export type QuotaPeriod = 'day' | 'month' | 'lifetime';

export interface QuotaStatus {
  feature: string;
  period: QuotaPeriod;
  limit: number | null;
  used: number;
  reset_at: string;
}

const TZ = 'Asia/Ho_Chi_Minh';

/** Khoá kỳ theo múi giờ VN: day → 2026-11-01, month → 2026-11, lifetime → all */
export function periodKey(period: QuotaPeriod, now = new Date()): string {
  if (period === 'lifetime') return 'all';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return period === 'day' ? `${y}-${m}-${d}` : `${y}-${m}`;
}

/** Thời điểm reset kỳ (UTC ISO) */
export function periodResetAt(period: QuotaPeriod, now = new Date()): Date {
  if (period === 'lifetime') return new Date('2099-01-01T00:00:00Z');
  const key = periodKey(period, now);
  // 00:00 giờ VN = 17:00 UTC hôm trước
  if (period === 'day') {
    const next = new Date(`${key}T00:00:00+07:00`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, -7, 0, 0));
}

/**
 * Quota ngày/tháng đếm trong Redis (INCR + TTL), chốt DB hằng đêm (ADR-0010). Redis mất → đếm trực tiếp DB (degraded).
 * Không có dòng quota cho (plan_kind, feature) = không giới hạn.
 */
@Injectable()
export class QuotaService {
  private readonly logger = getLogger({ component: 'quota' });
  private limitsCache: { at: number; rows: Array<{ planKind: PlanKind; feature: string; period: QuotaPeriod; limit: number }> } | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  private async limits() {
    if (this.limitsCache && Date.now() - this.limitsCache.at < 60_000) return this.limitsCache.rows;
    const rows = await this.dbs.db.select().from(billingQuotas);
    this.limitsCache = { at: Date.now(), rows: rows.map((r) => ({ planKind: r.planKind, feature: r.featureCode, period: r.period, limit: r.limitValue })) };
    return this.limitsCache.rows;
  }

  async limitFor(planKind: PlanKind, feature: FeatureCode): Promise<{ period: QuotaPeriod; limit: number } | null> {
    const rows = await this.limits();
    const row = rows.find((r) => r.planKind === planKind && r.feature === feature);
    return row ? { period: row.period, limit: row.limit } : null;
  }

  private redisKey(userId: string, feature: string, period: QuotaPeriod) {
    return `quota:${userId}:${feature}:${periodKey(period)}`;
  }

  async used(userId: string, feature: string, period: QuotaPeriod): Promise<number> {
    const v = await this.redis.safe((r) => r.get(this.redisKey(userId, feature, period)));
    if (v !== null) return Number(v) || 0;
    const [row] = await this.dbs.db
      .select({ used: billingUsageCounters.used })
      .from(billingUsageCounters)
      .where(and(eq(billingUsageCounters.userId, userId), eq(billingUsageCounters.featureCode, feature), eq(billingUsageCounters.periodKey, `${period}:${periodKey(period)}`)))
      .limit(1);
    return row?.used ?? 0;
  }

  /**
   * Tiêu 1 đơn vị quota. Vượt hạn → QuotaExceeded (429). Trả trạng thái sau khi tiêu.
   */
  async consume(userId: string, planKind: PlanKind, feature: FeatureCode, amount = 1): Promise<QuotaStatus | null> {
    const lim = await this.limitFor(planKind, feature);
    if (!lim) return null;
    const key = this.redisKey(userId, feature, lim.period);
    const resetAt = periodResetAt(lim.period);
    const ttl = Math.max(60, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    const next = await this.redis.safe(async (r) => {
      const v = await r.incrby(key, amount);
      if (v === amount) await r.expire(key, ttl);
      return v;
    });
    if (next !== null) {
      if (next > lim.limit) {
        await this.redis.safe((r) => r.decrby(key, amount));
        throw new QuotaExceeded({ feature, period: lim.period, limit: lim.limit, used: next - amount, reset_at: resetAt.toISOString() });
      }
      return { feature, period: lim.period, limit: lim.limit, used: next, reset_at: resetAt.toISOString() };
    }
    // Degraded: đếm trong DB (chậm hơn nhưng đúng)
    this.logger.warn({ feature }, 'redis unavailable, counting quota in DB');
    const pk = `${lim.period}:${periodKey(lim.period)}`;
    const [row] = await this.dbs.db
      .insert(billingUsageCounters)
      .values({ userId, featureCode: feature, periodKey: pk, used: amount })
      .onConflictDoUpdate({ target: [billingUsageCounters.userId, billingUsageCounters.featureCode, billingUsageCounters.periodKey], set: { used: sql`${billingUsageCounters.used} + ${amount}`, updatedAt: new Date() } })
      .returning({ used: billingUsageCounters.used });
    const used = row?.used ?? amount;
    if (used > lim.limit) {
      await this.dbs.db.update(billingUsageCounters).set({ used: sql`${billingUsageCounters.used} - ${amount}` }).where(and(eq(billingUsageCounters.userId, userId), eq(billingUsageCounters.featureCode, feature), eq(billingUsageCounters.periodKey, pk)));
      throw new QuotaExceeded({ feature, period: lim.period, limit: lim.limit, used: used - amount, reset_at: resetAt.toISOString() });
    }
    return { feature, period: lim.period, limit: lim.limit, used, reset_at: resetAt.toISOString() };
  }

  /** Hoàn lại 1 đơn vị (khi nghiệp vụ thất bại sau khi đã tiêu) */
  async refund(userId: string, planKind: PlanKind, feature: FeatureCode, amount = 1): Promise<void> {
    const lim = await this.limitFor(planKind, feature);
    if (!lim) return;
    await this.redis.safe((r) => r.decrby(this.redisKey(userId, feature, lim.period), amount));
  }

  /** Trạng thái các quota áp dụng cho gói (cho GET /me/entitlements) */
  async statusFor(userId: string, planKind: PlanKind): Promise<QuotaStatus[]> {
    const rows = (await this.limits()).filter((r) => r.planKind === planKind);
    return Promise.all(
      rows.map(async (r) => ({ feature: r.feature, period: r.period, limit: r.limit, used: await this.used(userId, r.feature, r.period), reset_at: periodResetAt(r.period).toISOString() })),
    );
  }

  /** Chốt bộ đếm Redis về DB (job đêm). Trả số khoá đã chốt. */
  async flushToDb(): Promise<number> {
    const keys = (await this.redis.safe((r) => r.keys('quota:*'))) ?? [];
    let n = 0;
    for (const key of keys) {
      const [, userId, feature, pk] = key.split(':');
      if (!userId || !feature || !pk) continue;
      const used = Number((await this.redis.safe((r) => r.get(key))) ?? 0);
      const period: QuotaPeriod = pk === 'all' ? 'lifetime' : pk.length === 7 ? 'month' : 'day';
      await this.dbs.db
        .insert(billingUsageCounters)
        .values({ userId, featureCode: feature, periodKey: `${period}:${pk}`, used })
        .onConflictDoUpdate({ target: [billingUsageCounters.userId, billingUsageCounters.featureCode, billingUsageCounters.periodKey], set: { used, updatedAt: new Date() } });
      n++;
    }
    return n;
  }
}
