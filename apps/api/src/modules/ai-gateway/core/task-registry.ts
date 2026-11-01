import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { modelPolicySchema, type AiTaskCode } from '@allingo/schemas';
import { DbService } from '../../../shared/db/db.module.js';
import type { ResolvedTask } from './types.js';

const { aiPromptTemplates, aiPromptVersions, aiModelRoutes } = schema;
type VersionRow = typeof aiPromptVersions.$inferSelect;
type RouteRow = typeof aiModelRoutes.$inferSelect;

/**
 * Registry prompt: đọc từ DB (seed từ allingo-prompts.yaml), cache 60 giây (invalidate khi admin đổi trạng thái).
 * Chọn version `active`; version `canary` được chọn cho `canary_percent`% người dùng theo hash user_id ỔN ĐỊNH
 * (sha256 → 0..99, cùng người luôn cùng nhóm – S5).
 */
@Injectable()
export class TaskRegistry {
  private cache = new Map<string, { at: number; tasks: ResolvedTask[] }>();
  constructor(private readonly dbs: DbService) {}

  invalidate(): void {
    this.cache.clear();
  }

  private toResolved(taskCode: AiTaskCode, templateId: string, v: VersionRow, route: RouteRow | undefined): ResolvedTask {
    const policy = modelPolicySchema.parse(v.modelPolicy ?? {});
    const extra = (v.modelPolicy ?? {}) as { cache_key?: string[] | null; partials?: Record<string, string>; eval?: { eval_set?: string; thresholds?: Record<string, unknown> } | null };
    return {
      taskCode,
      templateId,
      promptVersionId: v.id,
      versionNo: v.versionNo,
      status: v.status,
      canaryPercent: v.canaryPercent,
      systemPrompt: v.systemPrompt,
      userTemplate: v.userTemplate,
      fewShots: (v.fewShots as unknown[]) ?? [],
      outputSchema: (v.outputSchema as Record<string, unknown>) ?? {},
      modelPolicy: { ...policy, cache_key: extra.cache_key ?? null, partials: extra.partials, eval: extra.eval ?? null },
      route: {
        primaryModel: route?.primaryModel ?? policy.primary,
        fallbackModels: route?.fallbackModels ?? policy.fallbacks,
        params: (route?.params as Record<string, unknown>) ?? {},
        timeoutMs: route?.timeoutMs ?? 60_000,
        creditsCost: route?.creditsCost ?? 0,
      },
    };
  }

  private async load(taskCode: AiTaskCode, program: string | null): Promise<ResolvedTask[]> {
    const key = `${taskCode}:${program ?? '*'}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.tasks;
    const templates = await this.dbs.db
      .select({ id: aiPromptTemplates.id, programCode: aiPromptTemplates.programCode })
      .from(aiPromptTemplates)
      .where(eq(aiPromptTemplates.code, taskCode));
    // Ưu tiên template theo chương trình, rồi template chung
    const tpl = templates.find((t) => t.programCode === program) ?? templates.find((t) => t.programCode === null) ?? templates[0];
    if (!tpl) {
      this.cache.set(key, { at: Date.now(), tasks: [] });
      return [];
    }
    const versions = await this.dbs.db
      .select()
      .from(aiPromptVersions)
      .where(and(eq(aiPromptVersions.templateId, tpl.id), inArray(aiPromptVersions.status, ['active', 'canary'])))
      .orderBy(desc(aiPromptVersions.versionNo));
    const [route] = await this.dbs.db.select().from(aiModelRoutes).where(and(eq(aiModelRoutes.taskCode, taskCode), eq(aiModelRoutes.isActive, true))).limit(1);
    const tasks = versions.map((v) => this.toResolved(taskCode, tpl.id, v, route));
    this.cache.set(key, { at: Date.now(), tasks });
    return tasks;
  }

  /** Chọn version cho người dùng (canary theo hash) */
  async resolve(taskCode: AiTaskCode, program: string | null, userId: string | null): Promise<ResolvedTask | null> {
    const tasks = await this.load(taskCode, program);
    if (tasks.length === 0) return null;
    const canary = tasks.find((t) => t.status === 'canary');
    const active = tasks.find((t) => t.status === 'active');
    if (canary && userId && canary.canaryPercent > 0 && bucket(userId) < canary.canaryPercent) return canary;
    return active ?? canary ?? null;
  }

  /** Nạp đúng một phiên bản (mọi trạng thái) – eval phiên bản draft, admin xem trước */
  async loadVersion(versionId: string): Promise<ResolvedTask | null> {
    const [row] = await this.dbs.db
      .select({ v: aiPromptVersions, code: aiPromptTemplates.code })
      .from(aiPromptVersions)
      .innerJoin(aiPromptTemplates, eq(aiPromptTemplates.id, aiPromptVersions.templateId))
      .where(eq(aiPromptVersions.id, versionId))
      .limit(1);
    if (!row) return null;
    const [route] = await this.dbs.db.select().from(aiModelRoutes).where(and(eq(aiModelRoutes.taskCode, row.code), eq(aiModelRoutes.isActive, true))).limit(1);
    return this.toResolved(row.code as AiTaskCode, row.v.templateId, row.v, route);
  }
}

/** Hash ổn định user_id → 0..99 (sha256, 4 byte đầu) */
export function bucket(userId: string): number {
  return createHash('sha256').update(userId).digest().readUInt32BE(0) % 100;
}
