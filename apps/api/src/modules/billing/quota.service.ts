import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { SCOPED_QUOTA_FEATURES, type FeatureCode } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
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
  /** limit − used (không âm); null = không giới hạn */
  remaining: number | null;
  reset_at: string;
}

const TZ = 'Asia/Ho_Chi_Minh';
/** Giữ khoá Redis thêm 2 ngày sau kỳ để job chốt đêm (00:05 giờ VN) còn đọc được số của kỳ vừa kết thúc */
const FLUSH_GRACE_SECONDS = 2 * 86_400;

/** Khoá kỳ theo múi giờ VN: day → 2026-11-01, month → 2026-11, lifetime → all */
export function periodKey(period: QuotaPeriod, now: Date | number = new Date()): string {
  if (period === 'lifetime') return 'all';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(typeof now === 'number' ? new Date(now) : now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return period === 'day' ? `${y}-${m}-${d}` : `${y}-${m}`;
}

/** Thời điểm reset kỳ = 00:00 giờ VN của ngày/tháng kế tiếp (UTC) */
export function periodResetAt(period: QuotaPeriod, now: Date | number = new Date()): Date {
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

/** Khoá kỳ trước (cho chốt đêm) */
export function previousPeriodKey(period: QuotaPeriod, now: Date | number = new Date()): string {
  const t = typeof now === 'number' ? now : now.getTime();
  if (period === 'lifetime') return 'all';
  if (period === 'day') return periodKey('day', t - 86_400_000);
  const [y, m] = periodKey('month', t).split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Quota ngày/tháng (ADR-0010, CLAUDE.md §5.7): đọc giới hạn từ `billing.quotas` (seed, không hard-code), đếm Redis INCRBY + TTL
 * theo kỳ giờ Asia/Ho_Chi_Minh (00:00 VN reset), chốt `billing.usage_counters` hằng đêm. Redis mất → đếm trực tiếp DB (degraded).
 * Khoá Redis chưa có nhưng DB đã có số (Redis khởi động lại) → nạp số DB trước khi tăng. Không có dòng quota = không giới hạn.
 * Vượt hạn → 429 `quota_exceeded` với `details.quota = {feature, period, limit, used, remaining: 0, resets_at}`.
 */
@Injectable()
export class QuotaService {
  private readonly logger = getLogger({ component: 'quota' });
  private limitsCache: { at: number; rows: Array<{ planKind: PlanKind; feature: string; period: QuotaPeriod; limit: number }> } | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private now(): number {
    return this.clock.now();
  }

  invalidateLimits(): void {
    this.limitsCache = null;
  }

  private async limits() {
    if (this.limitsCache && Date.now() - this.limitsCache.at < 60_000) return this.limitsCache.rows;
    const rows = await this.dbs.db.select().from(billingQuotas);
    this.limitsCache = { at: Date.now(), rows: rows.map((r) => ({ planKind: r.planKind, feature: r.featureCode, period: r.period, limit: r.limitValue })) };
    return this.limitsCache.rows;
  }

  async limitFor(planKind: PlanKind, feature: string): Promise<{ period: QuotaPeriod; limit: number } | null> {
    const rows = await this.limits();
    const row = rows.find((r) => r.planKind === planKind && r.feature === feature);
    return row ? { period: row.period, limit: row.limit } : null;
  }

  private redisKey(userId: string, feature: string, period: QuotaPeriod, at = this.now()) {
    return `quota:${userId}:${feature}:${periodKey(period, at)}`;
  }

  private dbKey(period: QuotaPeriod, at = this.now()) {
    return `${period}:${periodKey(period, at)}`;
  }

  private async dbUsed(userId: string, feature: string, period: QuotaPeriod): Promise<number> {
    const [row] = await this.dbs.db
      .select({ used: billingUsageCounters.used })
      .from(billingUsageCounters)
      .where(and(eq(billingUsageCounters.userId, userId), eq(billingUsageCounters.featureCode, feature), eq(billingUsageCounters.periodKey, this.dbKey(period))))
      .limit(1);
    return row?.used ?? 0;
  }

  async used(userId: string, feature: string, period: QuotaPeriod): Promise<number> {
    const v = await this.redis.safe((r) => r.get(this.redisKey(userId, feature, period)));
    if (v !== null) return Math.max(0, Number(v) || 0);
    return this.dbUsed(userId, feature, period);
  }

  private exceeded(feature: string, period: QuotaPeriod, limit: number, used: number, resetAt: Date): QuotaExceeded {
    return new QuotaExceeded({ feature, period, limit, used: Math.min(used, limit), remaining: 0, resets_at: resetAt.toISOString(), reset_at: resetAt.toISOString() });
  }

  /**
   * Tiêu `amount` đơn vị quota. Vượt hạn → QuotaExceeded (429). Trả trạng thái sau khi tiêu (null = không giới hạn).
   */
  async consume(userId: string, planKind: PlanKind, feature: FeatureCode, amount = 1): Promise<QuotaStatus | null> {
    if ((SCOPED_QUOTA_FEATURES as readonly string[]).includes(feature)) throw new Error(`${feature} is a scoped quota – count it in the owning table`);
    const lim = await this.limitFor(planKind, feature);
    if (!lim) return null;
    const now = this.now();
    const key = this.redisKey(userId, feature, lim.period, now);
    const resetAt = periodResetAt(lim.period, now);
    const ttl = Math.max(60, Math.ceil((resetAt.getTime() - now) / 1000) + FLUSH_GRACE_SECONDS);
    const fromDb = await this.redis.safe((r) => r.exists(key)).then(async (exists) => (exists === 0 ? this.dbUsed(userId, feature, lim.period) : 0));
    const next = await this.redis.safe(async (r) => {
      if (fromDb > 0) await r.set(key, String(fromDb), 'EX', ttl, 'NX');
      const v = await r.incrby(key, amount);
      if (v === amount + fromDb) await r.expire(key, ttl);
      return v;
    });
    if (next !== null) {
      if (next > lim.limit) {
        await this.redis.safe((r) => r.decrby(key, amount));
        throw this.exceeded(feature, lim.period, lim.limit, next - amount, resetAt);
      }
      return { feature, period: lim.period, limit: lim.limit, used: next, remaining: Math.max(0, lim.limit - next), reset_at: resetAt.toISOString() };
    }
    // Degraded: đếm trong DB (chậm hơn nhưng đúng)
    this.logger.warn({ feature }, 'redis unavailable, counting quota in DB');
    const pk = this.dbKey(lim.period, now);
    const [row] = await this.dbs.db
      .insert(billingUsageCounters)
      .values({ userId, featureCode: feature, periodKey: pk, used: amount })
      .onConflictDoUpdate({ target: [billingUsageCounters.userId, billingUsageCounters.featureCode, billingUsageCounters.periodKey], set: { used: sql`${billingUsageCounters.used} + ${amount}`, updatedAt: new Date() } })
      .returning({ used: billingUsageCounters.used });
    const used = row?.used ?? amount;
    if (used > lim.limit) {
      await this.dbs.db.update(billingUsageCounters).set({ used: sql`greatest(${billingUsageCounters.used} - ${amount}, 0)` }).where(and(eq(billingUsageCounters.userId, userId), eq(billingUsageCounters.featureCode, feature), eq(billingUsageCounters.periodKey, pk)));
      throw this.exceeded(feature, lim.period, lim.limit, used - amount, resetAt);
    }
    return { feature, period: lim.period, limit: lim.limit, used, remaining: Math.max(0, lim.limit - used), reset_at: resetAt.toISOString() };
  }

  /** Hoàn lại đơn vị (khi nghiệp vụ thất bại sau khi đã tiêu); không xuống dưới 0 */
  async refund(userId: string, planKind: PlanKind, feature: FeatureCode, amount = 1): Promise<void> {
    const lim = await this.limitFor(planKind, feature);
    if (!lim) return;
    const key = this.redisKey(userId, feature, lim.period);
    const done = await this.redis.safe(async (r) => {
      const v = await r.decrby(key, amount);
      if (v < 0) await r.set(key, '0', 'KEEPTTL');
      return v;
    });
    if (done === null) {
      await this.dbs.db
        .update(billingUsageCounters)
        .set({ used: sql`greatest(${billingUsageCounters.used} - ${amount}, 0)`, updatedAt: new Date() })
        .where(and(eq(billingUsageCounters.userId, userId), eq(billingUsageCounters.featureCode, feature), eq(billingUsageCounters.periodKey, this.dbKey(lim.period))));
    }
  }

  /** Trạng thái các quota áp dụng cho gói (GET /me/entitlements – UI hiển thị "còn N lượt") */
  async statusFor(userId: string, planKind: PlanKind): Promise<QuotaStatus[]> {
    // Quota theo phạm vi (vd lượt/thread gia sư) đếm ở bảng nghiệp vụ – không liệt kê ở đây (S6)
    const rows = (await this.limits()).filter((r) => r.planKind === planKind && !(SCOPED_QUOTA_FEATURES as readonly string[]).includes(r.feature));
    const now = this.now();
    return Promise.all(
      rows.map(async (r) => {
        const used = await this.used(userId, r.feature, r.period);
        return { feature: r.feature, period: r.period, limit: r.limit, used, remaining: Math.max(0, r.limit - used), reset_at: periodResetAt(r.period, now).toISOString() };
      }),
    );
  }

  /**
   * Chốt bộ đếm Redis về DB (job đêm 00:05 giờ VN + có thể chạy bất kỳ lúc nào – idempotent vì ghi đè giá trị).
   * Quét bằng SCAN (không KEYS); khoá kỳ đã qua vẫn còn nhờ FLUSH_GRACE_SECONDS. Trả số khoá đã chốt.
   */
  async flushToDb(opts: { userIds?: string[] } = {}): Promise<number> {
    const keys: string[] = [];
    const patterns = opts.userIds?.length ? opts.userIds.map((u) => `quota:${u}:*`) : ['quota:*'];
    for (const pattern of patterns) {
      await this.redis.safe(async (r) => {
        let cursor = '0';
        do {
          const [next, batch] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
          cursor = next;
          keys.push(...batch);
        } while (cursor !== '0');
        return null;
      });
    }
    let n = 0;
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const values = (await this.redis.safe((r) => r.mget(...chunk))) ?? [];
      const rows: Array<typeof billingUsageCounters.$inferInsert> = [];
      chunk.forEach((key, j) => {
        const [, userId, feature, pk] = key.split(':');
        if (!userId || !feature || !pk || !/^[0-9a-f-]{36}$/i.test(userId)) return;
        const period: QuotaPeriod = pk === 'all' ? 'lifetime' : pk.length === 7 ? 'month' : 'day';
        rows.push({ userId, featureCode: feature, periodKey: `${period}:${pk}`, used: Math.max(0, Number(values[j] ?? 0) || 0), updatedAt: new Date() });
      });
      if (!rows.length) continue;
      // Người dùng đã bị xoá (FK) → bỏ qua hàng đó thay vì làm hỏng cả lô
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const existing = new Set((await this.dbs.db.select({ id: schema.iamUsers.id }).from(schema.iamUsers).where(inArray(schema.iamUsers.id, userIds))).map((u) => u.id));
      const valid = rows.filter((r) => existing.has(r.userId));
      if (!valid.length) continue;
      await this.dbs.db
        .insert(billingUsageCounters)
        .values(valid)
        .onConflictDoUpdate({ target: [billingUsageCounters.userId, billingUsageCounters.featureCode, billingUsageCounters.periodKey], set: { used: sql`excluded.used`, updatedAt: sql`excluded.updated_at` } });
      n += valid.length;
    }
    return n;
  }
}
