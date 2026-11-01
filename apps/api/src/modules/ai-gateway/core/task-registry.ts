import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { modelPolicySchema, type AiTaskCode } from '@allingo/schemas';
import { DbService } from '../../../shared/db/db.module.js';
import type { ResolvedTask } from './types.js';

const { aiPromptTemplates, aiPromptVersions, aiModelRoutes } = schema;

/**
 * Registry prompt: đọc từ DB (seed từ allingo-prompts.yaml), cache 60 giây. Chọn version `active`;
 * version `canary` được chọn cho x% người dùng theo hash user_id (canary_percent).
 */
@Injectable()
export class TaskRegistry {
  private cache = new Map<string, { at: number; tasks: ResolvedTask[] }>();
  constructor(private readonly dbs: DbService) {}

  invalidate(): void {
    this.cache.clear();
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
    const tasks: ResolvedTask[] = versions.map((v) => {
      const policy = modelPolicySchema.parse(v.modelPolicy ?? {});
      const extra = (v.modelPolicy ?? {}) as { cache_key?: string[] | null; partials?: Record<string, string> };
      return {
        taskCode,
        templateId: tpl.id,
        promptVersionId: v.id,
        versionNo: v.versionNo,
        status: v.status,
        systemPrompt: v.systemPrompt,
        userTemplate: v.userTemplate,
        fewShots: (v.fewShots as unknown[]) ?? [],
        outputSchema: (v.outputSchema as Record<string, unknown>) ?? {},
        modelPolicy: { ...policy, cache_key: extra.cache_key ?? null, partials: extra.partials },
        route: {
          primaryModel: route?.primaryModel ?? policy.primary,
          fallbackModels: route?.fallbackModels ?? policy.fallbacks,
          params: (route?.params as Record<string, unknown>) ?? {},
          timeoutMs: route?.timeoutMs ?? 60_000,
          creditsCost: route?.creditsCost ?? 0,
        },
        canaryPercent: v.canaryPercent,
      };
    });
    this.cache.set(key, { at: Date.now(), tasks });
    return tasks;
  }

  /** Chọn version cho người dùng (canary theo hash) */
  async resolve(taskCode: AiTaskCode, program: string | null, userId: string | null): Promise<ResolvedTask | null> {
    const tasks = (await this.load(taskCode, program)) as Array<ResolvedTask & { canaryPercent: number }>;
    if (tasks.length === 0) return null;
    const canary = tasks.find((t) => t.status === 'canary');
    const active = tasks.find((t) => t.status === 'active');
    if (canary && userId && canary.canaryPercent > 0 && bucket(userId) < canary.canaryPercent) return canary;
    return active ?? canary ?? null;
  }
}

/** Hash ổn định user_id → 0..99 */
export function bucket(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % 100;
}
