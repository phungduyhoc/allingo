import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { parse } from 'yaml';
import type { Db } from '../../src/client.js';
import { pricingForAliases } from '@allingo/schemas';
import { aiModelRoutes, aiPromptTemplates, aiPromptVersions } from '../../drizzle/schema/index.js';

/**
 * Seed registry prompt từ docs/spec/allingo-prompts.yaml → ai.prompt_templates / prompt_versions / model_routes.
 * Idempotent: cùng (code, version_no) không tạo trùng; nội dung version 1 được cập nhật theo spec khi còn ở trạng thái draft/active
 * và chưa có ai_tasks (dev). Prod: phiên bản mới tạo qua admin API, không ghi đè.
 */

interface PromptSpec {
  code: string;
  program?: string | null;
  description?: string;
  model_policy: {
    primary: string;
    fallbacks?: string[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    timeout_ms?: number;
  };
  credits_cost?: number;
  cache_key?: string[];
  system_prompt: string;
  user_template: string;
  few_shots?: unknown[];
  rubric_ref?: string;
  output_schema: Record<string, unknown>;
  eval?: Record<string, unknown>;
}
interface Spec {
  shared: { locales: Record<string, string>; common_system: string };
  prompts: PromptSpec[];
  scoring_rules: Record<string, unknown>;
}

/** Tìm docs/spec/allingo-prompts.yaml bằng cách đi ngược từ thư mục hiện tại (chạy được từ src lẫn dist) */
export function resolveSpecPath(file = 'allingo-prompts.yaml'): string {
  if (process.env.ALLINGO_SPEC_DIR) return path.join(process.env.ALLINGO_SPEC_DIR, file);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'docs', 'spec', file);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`Không tìm thấy docs/spec/${file}; đặt ALLINGO_SPEC_DIR`);
}

export function loadPromptSpec(): Spec {
  return parse(fs.readFileSync(resolveSpecPath(), 'utf8')) as Spec;
}

const DEFAULT_TIMEOUT: Record<string, number> = {
  explain_mcq: 20_000,
  tutor_chat: 30_000,
  guard_classify: 5_000,
  segment_translate: 15_000,
  summarize_attempt: 30_000,
  diagnose_rl: 45_000,
  plan_adjust: 45_000,
  upgrade_phrasing: 20_000,
  generate_questions: 90_000,
  check_question: 45_000,
};

export async function seedPrompts(
  db: Db,
  opts: { activate?: boolean } = {},
): Promise<{ templates: number; versions: number; routes: number }> {
  const spec = loadPromptSpec();
  let versions = 0;
  for (const p of spec.prompts) {
    const [tpl] = await db
      .insert(aiPromptTemplates)
      .values({ code: p.code, programCode: p.program ?? null, description: p.description ?? null })
      .onConflictDoUpdate({
        target: [aiPromptTemplates.code, aiPromptTemplates.programCode],
        set: { description: sql`excluded.description` },
      })
      .returning({ id: aiPromptTemplates.id });
    const templateId = tpl!.id;

    const modelPolicy = {
      primary: p.model_policy.primary,
      fallbacks: p.model_policy.fallbacks ?? [],
      temperature: p.model_policy.temperature ?? 0.3,
      top_p: p.model_policy.top_p ?? 0.9,
      max_tokens: p.model_policy.max_tokens ?? 1024,
      cache_key: p.cache_key ?? null,
      eval: p.eval ?? null,
      // partial common_system được lưu kèm để render độc lập với tệp YAML
      partials: { common_system: spec.shared.common_system, locales: spec.shared.locales },
    };
    const rubric = p.rubric_ref ? { ref: p.rubric_ref, scoring_rules: spec.scoring_rules } : null;

    const existing = await db
      .select({ id: aiPromptVersions.id, status: aiPromptVersions.status })
      .from(aiPromptVersions)
      .where(sql`${aiPromptVersions.templateId} = ${templateId} AND ${aiPromptVersions.versionNo} = 1`)
      .limit(1);
    const status = opts.activate === false ? 'draft' : 'active';
    if (existing.length === 0) {
      await db.insert(aiPromptVersions).values({
        templateId,
        versionNo: 1,
        systemPrompt: p.system_prompt,
        userTemplate: p.user_template,
        fewShots: p.few_shots ?? [],
        rubric,
        outputSchema: p.output_schema,
        modelPolicy,
        status,
        canaryPercent: 0,
      });
      versions++;
    } else {
      await db
        .update(aiPromptVersions)
        .set({
          systemPrompt: p.system_prompt,
          userTemplate: p.user_template,
          fewShots: p.few_shots ?? [],
          rubric,
          outputSchema: p.output_schema,
          modelPolicy,
        })
        .where(eq(aiPromptVersions.id, existing[0]!.id));
    }

    await db
      .insert(aiModelRoutes)
      .values({
        taskCode: p.code,
        primaryModel: p.model_policy.primary,
        fallbackModels: p.model_policy.fallbacks ?? [],
        params: {
          temperature: p.model_policy.temperature ?? 0.3,
          top_p: p.model_policy.top_p ?? 0.9,
          max_tokens: p.model_policy.max_tokens ?? 1024,
          // Sprint 5: bảng giá USD/1M token theo alias (nguồn: DEFAULT_MODEL_PRICING) – admin chỉnh trong DB không cần deploy
          pricing: pricingForAliases([p.model_policy.primary, ...(p.model_policy.fallbacks ?? [])]),
        },
        timeoutMs: p.model_policy.timeout_ms ?? DEFAULT_TIMEOUT[p.code] ?? 60_000,
        maxCostUsd: null,
        creditsCost: p.credits_cost ?? 0,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: aiModelRoutes.taskCode,
        set: {
          primaryModel: sql`excluded.primary_model`,
          fallbackModels: sql`excluded.fallback_models`,
          params: sql`excluded.params`,
          timeoutMs: sql`excluded.timeout_ms`,
          creditsCost: sql`excluded.credits_cost`,
          updatedAt: sql`now()`,
        },
      });
  }
  return { templates: spec.prompts.length, versions, routes: spec.prompts.length };
}
