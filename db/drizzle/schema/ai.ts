// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.

import {
  unique,
  uuid,
  text,
  boolean,
  smallint,
  timestamp,
  index,
  foreignKey,
  jsonb,
  integer,
  numeric,
  vector,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ai } from './_common.js';
import { catalogPrograms, catalogQuestionVersions } from './catalog.js';
import { iamUsers } from './iam.js';

export const aiPromptStatus = ai.enum('prompt_status', ['draft', 'canary', 'active', 'retired']);

export const aiTaskStatus = ai.enum('task_status', ['queued', 'running', 'succeeded', 'failed', 'timeout', 'refused']);

export const aiPromptTemplates = ai.table(
  'prompt_templates',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: text().notNull(),
    programCode: text('program_code'),
    description: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'prompt_templates_program_code_fkey',
    }),
    unique('prompt_templates_code_program_code_key').on(table.code, table.programCode),
  ],
);

export const aiPromptVersions = ai.table(
  'prompt_versions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    templateId: uuid('template_id').notNull(),
    versionNo: integer('version_no').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    userTemplate: text('user_template').notNull(),
    fewShots: jsonb('few_shots').default([]).notNull(),
    rubric: jsonb(),
    outputSchema: jsonb('output_schema').notNull(),
    modelPolicy: jsonb('model_policy').notNull(),
    status: aiPromptStatus().default('draft').notNull(),
    canaryPercent: smallint('canary_percent').default(0).notNull(),
    evalRunId: uuid('eval_run_id'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_prompt_versions_active')
      .using('btree', table.templateId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(status = ANY (ARRAY['active'::ai.prompt_status, 'canary'::ai.prompt_status]))`),
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [aiPromptTemplates.id],
      name: 'prompt_versions_template_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [iamUsers.id],
      name: 'prompt_versions_created_by_fkey',
    }),
    unique('prompt_versions_template_id_version_no_key').on(table.templateId, table.versionNo),
  ],
);

export const aiModelRoutes = ai.table(
  'model_routes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    taskCode: text('task_code').notNull(),
    primaryModel: text('primary_model').notNull(),
    fallbackModels: text('fallback_models').array().default(['']).notNull(),
    params: jsonb().default({}).notNull(),
    timeoutMs: integer('timeout_ms').default(30000).notNull(),
    maxCostUsd: numeric('max_cost_usd', { precision: 8, scale: 4 }),
    creditsCost: integer('credits_cost').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [unique('model_routes_task_code_key').on(table.taskCode)],
);

export const aiExplanationCache = ai.table(
  'explanation_cache',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    questionVersionId: uuid('question_version_id').notNull(),
    chosenOption: text('chosen_option').notNull(),
    locale: text().notNull(),
    content: jsonb().notNull(),
    promptVersionId: uuid('prompt_version_id'),
    hitCount: integer('hit_count').default(0).notNull(),
    qualityScore: numeric('quality_score', { precision: 3, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionVersionId],
      foreignColumns: [catalogQuestionVersions.id],
      name: 'explanation_cache_question_version_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.promptVersionId],
      foreignColumns: [aiPromptVersions.id],
      name: 'explanation_cache_prompt_version_id_fkey',
    }),
    unique('explanation_cache_question_version_id_chosen_option_locale_key').on(
      table.questionVersionId,
      table.chosenOption,
      table.locale,
    ),
  ],
);

export const aiTranslationCache = ai.table(
  'translation_cache',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    sourceHash: text('source_hash').notNull(),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    text: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    unique('translation_cache_source_hash_source_lang_target_lang_key').on(
      table.sourceHash,
      table.sourceLang,
      table.targetLang,
    ),
  ],
);

export const aiTtsCache = ai.table(
  'tts_cache',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    textHash: text('text_hash').notNull(),
    voice: text().notNull(),
    storageKey: text('storage_key').notNull(),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [unique('tts_cache_text_hash_voice_key').on(table.textHash, table.voice)],
);

export const aiEvalSets = ai.table(
  'eval_sets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    taskCode: text('task_code').notNull(),
    programCode: text('program_code'),
    name: text().notNull(),
    description: text(),
    thresholds: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'eval_sets_program_code_fkey',
    }),
  ],
);

export const aiEvalItems = ai.table(
  'eval_items',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    evalSetId: uuid('eval_set_id').notNull(),
    input: jsonb().notNull(),
    gold: jsonb().notNull(),
    notes: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.evalSetId],
      foreignColumns: [aiEvalSets.id],
      name: 'eval_items_eval_set_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const aiEvalRuns = ai.table(
  'eval_runs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    evalSetId: uuid('eval_set_id').notNull(),
    promptVersionId: uuid('prompt_version_id').notNull(),
    model: text().notNull(),
    metrics: jsonb().notNull(),
    passed: boolean().notNull(),
    runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    triggeredBy: text('triggered_by'),
  },
  (table) => [
    foreignKey({
      columns: [table.evalSetId],
      foreignColumns: [aiEvalSets.id],
      name: 'eval_runs_eval_set_id_fkey',
    }),
    foreignKey({
      columns: [table.promptVersionId],
      foreignColumns: [aiPromptVersions.id],
      name: 'eval_runs_prompt_version_id_fkey',
    }),
  ],
);

export const aiFeedback = ai.table(
  'feedback',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    aiTaskId: uuid('ai_task_id').notNull(),
    rating: text().notNull(),
    comment: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'feedback_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const aiEmbeddings = ai.table(
  'embeddings',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    model: text().notNull(),
    embedding: vector({ dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_embeddings_hnsw').using('hnsw', table.embedding.asc().nullsLast().op('vector_cosine_ops')),
    unique('embeddings_entity_type_entity_id_model_key').on(table.entityType, table.entityId, table.model),
  ],
);

export const aiEvalRunItems = ai.table(
  'eval_run_items',
  {
    runId: uuid('run_id').notNull(),
    evalItemId: uuid('eval_item_id').notNull(),
    output: jsonb().notNull(),
    diff: numeric({ precision: 6, scale: 3 }),
  },
  (table) => [
    foreignKey({
      columns: [table.runId],
      foreignColumns: [aiEvalRuns.id],
      name: 'eval_run_items_run_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.evalItemId],
      foreignColumns: [aiEvalItems.id],
      name: 'eval_run_items_eval_item_id_fkey',
    }),
    primaryKey({ columns: [table.runId, table.evalItemId], name: 'eval_run_items_pkey' }),
  ],
);
