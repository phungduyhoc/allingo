import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CACHE_METRICS, OPS_METRICS } from '../../shared/telemetry/metrics.js';

const { billingFeatureFlags } = schema;

export interface FlagRules {
  percent?: number;
  user_ids?: string[];
  plan_kinds?: string[];
  programs?: string[];
  /** S8: cấu hình tính năng gắn với cờ (vd ff.growth.referral → rewards, monthly_cap…) */
  config?: Record<string, unknown>;
}

export interface FlagValue {
  enabled: boolean;
  rules: FlagRules;
}

/**
 * Cờ client được đọc qua `GET /flags` (S11) – chỉ trả boolean đã đánh giá cho người gọi, KHÔNG trả `rules` (user_ids, config).
 * Cờ không có trong danh sách (vd `ff.growth.beta_gate` chứa danh sách mời) chỉ đọc được qua /admin/flags.
 */
export const PUBLIC_FLAG_KEYS = [
  'ff.ai.explain',
  'ff.ai.tutor',
  'ff.ai.diagnose',
  'ff.billing.checkout',
  'ff.growth.referral',
  'ff.learning.study_plan',
  'ff.catalog.program.ielts',
  'ff.catalog.program.jlpt',
  'ff.catalog.program.hsk',
] as const;

/** Giá trị mặc định khi cờ chưa có trong DB (kill-switch mặc định BẬT tính năng) */
export const FLAG_FALLBACKS: Record<string, boolean> = {
  'ff.ai.explain': true,
  'ff.ai.tutor': true,
  'ff.ai.diagnose': true,
  'ff.billing.checkout': true,
  'ff.growth.referral': true,
  'ff.learning.study_plan': true,
  'ff.catalog.program.ielts': false,
  'ff.catalog.program.jlpt': false,
  'ff.catalog.program.hsk': false,
};

const INVALIDATE_CHANNEL = 'ff:invalidate';
/** Cache trong process ngắn hơn Redis – PUT xoá cả hai + pub/sub tới replica khác (hiệu lực ≈ tức thì, tối đa LOCAL_TTL + Redis TTL) */
const LOCAL_TTL_MS = 5_000;

/** Bucket 0–99 ổn định theo (key, user) cho rollout theo % */
export function flagBucket(key: string, userId: string): number {
  return createHash('sha256').update(`${key}:${userId}`).digest().readUInt16BE(0) % 100;
}

/**
 * Quyết định cờ (thuần): tắt → chỉ người trong `user_ids` (tester); bật → mọi người thoả các luật có khai báo
 * (`percent` theo bucket, `plan_kinds`, `programs`; `user_ids` luôn được bật).
 */
export function evaluateFlag(flag: FlagValue | null, ctx: { userId?: string | null; planKind?: string; program?: string }, fallback: boolean, key = 'ff'): boolean {
  if (!flag) return fallback;
  const r = flag.rules ?? {};
  if (ctx.userId && r.user_ids?.includes(ctx.userId)) return true;
  if (!flag.enabled) return false;
  if (r.plan_kinds?.length && (!ctx.planKind || !r.plan_kinds.includes(ctx.planKind))) return false;
  if (r.programs?.length && (!ctx.program || !r.programs.includes(ctx.program))) return false;
  if (typeof r.percent === 'number' && r.percent < 100) {
    if (!ctx.userId) return false;
    return flagBucket(key, ctx.userId) < Math.max(0, r.percent);
  }
  return true;
}

/**
 * Feature flag SDK phía server `billing.feature_flags` (`ff.<module>.<feature>`, S7 – SPEC-ISSUES S51; S11 nâng):
 * 3 tầng: process (5 s) → Redis (`ff:<key>`, FLAGS_CACHE_TTL_SECONDS) → DB. PUT /admin/flags/{key} ghi DB + audit, xoá Redis,
 * publish `ff:invalidate` → mọi replica (API/worker) xoá cache process → kill-switch (vd `ff.ai.explain`) hiệu lực < 1 s
 * khi pub/sub hoạt động, ≤ 5 s + TTL Redis khi không (mặc định ≤ 20 s – tiêu chí < 60 s). Redis mất → đọc DB (cache process).
 */
@Injectable()
export class FeatureFlagService implements OnModuleInit, OnModuleDestroy {
  private cache = new Map<string, { at: number; value: FlagValue | null }>();
  private sub: Redis | null = null;
  private readonly logger = getLogger({ component: 'flags' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    try {
      this.sub = this.redis.client.duplicate({ lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: null });
      this.sub.on('error', () => undefined);
      this.sub.on('message', (_ch: string, key: string) => {
        if (key === '*') this.cache.clear();
        else this.cache.delete(key);
      });
      void this.sub
        .connect()
        .then(() => this.sub?.subscribe(this.channel))
        .catch((err: Error) => this.logger.warn({ err: err.message }, 'flag invalidation subscriber unavailable (TTL fallback)'));
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'flag subscriber init failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sub?.quit().catch(() => undefined);
  }

  private get channel(): string {
    return `${this.env.QUEUE_PREFIX}:${INVALIDATE_CHANNEL}`;
  }
  private rkey(key: string): string {
    return `${this.env.QUEUE_PREFIX}:ff:${key}`;
  }

  async get(key: string): Promise<FlagValue | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < Math.min(LOCAL_TTL_MS, this.env.FLAGS_CACHE_TTL_SECONDS * 1000)) {
      CACHE_METRICS.requests.inc({ cache: 'flags_local', result: 'hit' });
      return hit.value;
    }
    const cached = await this.redis.safe((r) => r.get(this.rkey(key)));
    if (cached !== null) {
      CACHE_METRICS.requests.inc({ cache: 'flags', result: 'hit' });
      const value = cached === 'null' ? null : (JSON.parse(cached) as FlagValue);
      this.cache.set(key, { at: Date.now(), value });
      return value;
    }
    CACHE_METRICS.requests.inc({ cache: 'flags', result: 'miss' });
    const [row] = await this.dbs.db.select().from(billingFeatureFlags).where(eq(billingFeatureFlags.key, key)).limit(1);
    const value = row ? { enabled: row.enabled, rules: (row.rules ?? {}) as FlagRules } : null;
    this.cache.set(key, { at: Date.now(), value });
    await this.redis.safe((r) => r.set(this.rkey(key), JSON.stringify(value), 'EX', this.env.FLAGS_CACHE_TTL_SECONDS));
    return value;
  }

  async isEnabled(key: string, ctx: { userId?: string | null; planKind?: string; program?: string } = {}, fallback = FLAG_FALLBACKS[key] ?? true): Promise<boolean> {
    const on = evaluateFlag(await this.get(key), ctx, fallback, key);
    OPS_METRICS.flagEvaluations.inc({ key, result: on ? 'on' : 'off' });
    return on;
  }

  /** Danh sách cờ (admin) – đọc thẳng DB */
  async list(): Promise<Array<{ key: string; enabled: boolean; rules: FlagRules; updated_at: string; public: boolean }>> {
    const rows = await this.dbs.db.select().from(billingFeatureFlags).orderBy(asc(billingFeatureFlags.key));
    return rows.map((r) => ({ key: r.key, enabled: r.enabled, rules: r.rules ?? {}, updated_at: r.updatedAt.toISOString(), public: (PUBLIC_FLAG_KEYS as readonly string[]).includes(r.key) }));
  }

  async getOne(key: string): Promise<{ key: string; enabled: boolean; rules: FlagRules; updated_at: string; public: boolean } | null> {
    const [r] = await this.dbs.db.select().from(billingFeatureFlags).where(eq(billingFeatureFlags.key, key)).limit(1);
    return r ? { key: r.key, enabled: r.enabled, rules: r.rules ?? {}, updated_at: r.updatedAt.toISOString(), public: (PUBLIC_FLAG_KEYS as readonly string[]).includes(r.key) } : null;
  }

  /** Cờ công khai đã đánh giá cho người gọi (GET /flags) */
  async publicFlags(ctx: { userId?: string | null }): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const k of PUBLIC_FLAG_KEYS) out[k] = await this.isEnabled(k, ctx);
    return out;
  }

  async set(key: string, input: { enabled?: boolean; rules?: FlagRules }, actor: { id: string; roles: string[] }, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    this.cache.delete(key);
    await this.redis.safe((r) => r.del(this.rkey(key)));
    const before = await this.getOne(key);
    const enabled = input.enabled ?? before?.enabled ?? false;
    const rules = input.rules ?? before?.rules ?? {};
    const [row] = await this.dbs.db
      .insert(billingFeatureFlags)
      .values({ key, enabled, rules, updatedAt: new Date() })
      .onConflictDoUpdate({ target: billingFeatureFlags.key, set: { enabled, rules, updatedAt: new Date() } })
      .returning();
    await this.audit.log({ action: 'flag.update', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'feature_flag', after: { key, enabled, rules, before: before ? { enabled: before.enabled } : null }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    await this.invalidate(key);
    return { key: row!.key, enabled: row!.enabled, rules: row!.rules as FlagRules, updated_at: row!.updatedAt.toISOString() };
  }

  /** Xoá cache process + Redis và báo các replica khác (pub/sub) */
  async invalidate(key: string): Promise<void> {
    this.cache.delete(key);
    await this.redis.safe((r) => r.del(this.rkey(key)));
    await this.redis.safe((r) => r.publish(this.channel, key));
  }

  clearCache(): void {
    this.cache.clear();
  }
}
