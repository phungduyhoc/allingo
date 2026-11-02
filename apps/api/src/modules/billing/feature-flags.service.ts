import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';

const { billingFeatureFlags } = schema;

export interface FlagRules {
  percent?: number;
  user_ids?: string[];
  plan_kinds?: string[];
  programs?: string[];
}

/** Bucket 0–99 ổn định theo (key, user) cho rollout theo % */
export function flagBucket(key: string, userId: string): number {
  return createHash('sha256').update(`${key}:${userId}`).digest().readUInt16BE(0) % 100;
}

/**
 * Quyết định cờ (thuần): tắt → chỉ người trong `user_ids` (tester); bật → mọi người thoả các luật có khai báo
 * (`percent` theo bucket, `plan_kinds`, `programs`; `user_ids` luôn được bật).
 */
export function evaluateFlag(flag: { enabled: boolean; rules: FlagRules } | null, ctx: { userId?: string | null; planKind?: string; program?: string }, fallback: boolean, key = 'ff'): boolean {
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
 * Feature flag `billing.feature_flags` (`ff.<module>.<feature>`, S7 – SPEC-ISSUES S51). Cache trong process 30 giây;
 * PUT /admin/flags/{key} ghi audit và xoá cache. S7 dùng `ff.billing.checkout` cho POST /orders và /pay.
 */
@Injectable()
export class FeatureFlagService {
  private cache = new Map<string, { at: number; value: { enabled: boolean; rules: FlagRules } | null }>();

  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  async get(key: string): Promise<{ enabled: boolean; rules: FlagRules } | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const [row] = await this.dbs.db.select().from(billingFeatureFlags).where(eq(billingFeatureFlags.key, key)).limit(1);
    const value = row ? { enabled: row.enabled, rules: (row.rules ?? {}) as FlagRules } : null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async isEnabled(key: string, ctx: { userId?: string | null; planKind?: string; program?: string } = {}, fallback = true): Promise<boolean> {
    return evaluateFlag(await this.get(key), ctx, fallback, key);
  }

  async set(key: string, input: { enabled?: boolean; rules?: FlagRules }, actor: { id: string; roles: string[] }, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const before = await this.get(key);
    const enabled = input.enabled ?? before?.enabled ?? false;
    const rules = input.rules ?? before?.rules ?? {};
    const [row] = await this.dbs.db
      .insert(billingFeatureFlags)
      .values({ key, enabled, rules, updatedAt: new Date() })
      .onConflictDoUpdate({ target: billingFeatureFlags.key, set: { enabled, rules, updatedAt: new Date() } })
      .returning();
    await this.audit.log({ action: 'flag.update', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'feature_flag', after: { key, enabled, rules, before: before ? { enabled: before.enabled } : null }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    this.cache.delete(key);
    return { key: row!.key, enabled: row!.enabled, rules: row!.rules as FlagRules, updated_at: row!.updatedAt.toISOString() };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
