// Bốn bảng PARTITION BY RANGE (created_at) – drizzle-kit pull bỏ qua bảng cha partition nên khai báo tay ở đây.
// Cấu trúc phải khớp docs/spec/allingo-schema.sql (được kiểm bằng pnpm db:diff mục [2]). Partition con tạo bởi ops.ensure_month_partition().
import {
  bigserial,
  boolean,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnswerInput } from '@allingo/schemas';
import { ai, learn, ops } from './_common.js';
import { aiTaskStatus, aiPromptVersions } from './ai.js';
import { catalogQuestionVersions, catalogQuestions } from './catalog.js';
import { learnAttempts } from './learn.js';

export const learnAttemptAnswers = learn.table(
  'attempt_answers',
  {
    id: uuid().defaultRandom().notNull(),
    attemptId: uuid('attempt_id').notNull(),
    questionId: uuid('question_id').notNull(),
    questionVersionId: uuid('question_version_id').notNull(),
    answer: jsonb().$type<AnswerInput>(),
    isCorrect: boolean('is_correct'),
    score: numeric({ precision: 5, scale: 2 }),
    timeSpentMs: integer('time_spent_ms'),
    flagged: boolean().default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt], name: 'attempt_answers_pkey' }),
    index('ix_attempt_answers_attempt').using('btree', table.attemptId.asc().nullsLast().op('uuid_ops')),
    index('ix_attempt_answers_question').using(
      'btree',
      table.questionId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.attemptId],
      foreignColumns: [learnAttempts.id],
      name: 'attempt_answers_attempt_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [catalogQuestions.id],
      name: 'attempt_answers_question_id_fkey',
    }),
    foreignKey({
      columns: [table.questionVersionId],
      foreignColumns: [catalogQuestionVersions.id],
      name: 'attempt_answers_question_version_id_fkey',
    }),
  ],
);

export const aiAiTasks = ai.table(
  'ai_tasks',
  {
    id: uuid().defaultRandom().notNull(),
    userId: uuid('user_id'),
    taskCode: text('task_code').notNull(),
    promptVersionId: uuid('prompt_version_id'),
    modelUsed: text('model_used'),
    provider: text(),
    status: aiTaskStatus().default('queued').notNull(),
    inputRef: jsonb('input_ref'),
    inputHash: text('input_hash'),
    output: jsonb(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    audioSeconds: numeric('audio_seconds', { precision: 8, scale: 2 }),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    creditsCharged: integer('credits_charged').default(0).notNull(),
    latencyMs: integer('latency_ms'),
    traceId: text('trace_id'),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    // v1.1 – Sprint 5 (migration 0003): đo lường AI Gateway
    cacheHit: boolean('cache_hit').default(false).notNull(),
    fallbackUsed: boolean('fallback_used').default(false).notNull(),
    errorCode: text('error_code'),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt], name: 'ai_tasks_pkey' }),
    index('ix_ai_tasks_user_created').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('ix_ai_tasks_task_created').using(
      'btree',
      table.taskCode.asc().nullsLast().op('text_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('ix_ai_tasks_trace').using('btree', table.traceId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.promptVersionId],
      foreignColumns: [aiPromptVersions.id],
      name: 'ai_tasks_prompt_version_id_fkey',
    }),
  ],
);

export const opsAuditLogs = ops.table(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text().notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt], name: 'audit_logs_pkey' }),
    index('ix_audit_logs_entity').using(
      'btree',
      table.entityType.asc().nullsLast().op('text_ops'),
      table.entityId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    index('ix_audit_logs_actor').using(
      'btree',
      table.actorUserId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
  ],
);

export const opsOutbox = ops.table(
  'outbox',
  {
    id: bigserial({ mode: 'number' }).notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id'),
    eventType: text('event_type').notNull(),
    payload: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt], name: 'outbox_pkey' }),
    index('ix_outbox_unpublished')
      .using('btree', table.createdAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(published_at IS NULL)`),
  ],
);
