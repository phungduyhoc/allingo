// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.

import { unique, uuid, text, smallint, timestamp, index, foreignKey, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ops } from './_common.js';
import { iamUsers } from './iam.js';

export const opsNotificationChannel = ops.enum('notification_channel', ['email', 'push', 'zalo', 'sms', 'inapp']);

export const opsNotifications = ops.table(
  'notifications',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    channel: opsNotificationChannel().notNull(),
    templateCode: text('template_code').notNull(),
    payload: jsonb().default({}).notNull(),
    status: text().default('scheduled').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    error: text(),
  },
  (table) => [
    index('ix_notifications_due')
      .using('btree', table.scheduledAt.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'scheduled'::text)`),
    index('ix_notifications_dedupe')
      .using('btree', table.userId.asc().nullsLast(), table.templateCode.asc().nullsLast(), sql`((payload ->> 'dedupe_key'::text))`)
      .where(sql`(payload ? 'dedupe_key'::text)`),
    index('ix_notifications_user_status').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.status.asc().nullsLast().op('timestamptz_ops'),
      table.scheduledAt.desc().nullsFirst().op('text_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'notifications_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const opsNotificationPreferences = ops.table(
  'notification_preferences',
  {
    userId: uuid('user_id').primaryKey().notNull(),
    channels: jsonb().default({ push: true, zalo: false, email: true, inapp: true }).notNull(),
    quietHours: jsonb('quiet_hours').default({ end: '07:00', start: '22:00' }).notNull(),
    reminderTimes: text('reminder_times').array().default(['20:00']).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    // v1.1 – Sprint 8 (migration 0005): tuỳ chọn theo loại × kênh
    categories: jsonb()
      .default({ learning: { email: true, push: true, inapp: true }, billing: { email: true, push: true, inapp: true }, marketing: { email: false, push: false, inapp: true } })
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'notification_preferences_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

// v1.1 – Sprint 6 (migration 0004): đăng ký Web Push (VAPID) theo thiết bị
export const opsPushSubscriptions = ops.table(
  'push_subscriptions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    endpoint: text().notNull(),
    p256Dh: text('p256dh').notNull(),
    auth: text().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    userAgent: text('user_agent'),
    locale: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'date' }),
    failureCount: smallint('failure_count').default(0).notNull(),
  },
  (table) => [
    index('ix_push_subscriptions_user').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'push_subscriptions_user_id_fkey',
    }).onDelete('cascade'),
    unique('push_subscriptions_endpoint_key').on(table.endpoint),
  ],
);

export const opsFeedback = ops.table(
  'feedback',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id'),
    kind: text().notNull(),
    body: text().notNull(),
    page: text(),
    context: jsonb(),
    status: text().default('new').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'feedback_user_id_fkey',
    }).onDelete('set null'),
  ],
);

export const opsContentReports = ops.table(
  'content_reports',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    reason: text().notNull(),
    status: text().default('open').notNull(),
    resolvedBy: uuid('resolved_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_content_reports_entity').using(
      'btree',
      table.entityType.asc().nullsLast().op('text_ops'),
      table.entityId.asc().nullsLast().op('uuid_ops'),
      table.status.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'content_reports_user_id_fkey',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.resolvedBy],
      foreignColumns: [iamUsers.id],
      name: 'content_reports_resolved_by_fkey',
    }),
  ],
);

export const opsSupportTickets = ops.table(
  'support_tickets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id'),
    subject: text().notNull(),
    body: text(),
    channel: text(),
    status: text().default('open').notNull(),
    priority: text().default('normal').notNull(),
    assignedTo: uuid('assigned_to'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'support_tickets_user_id_fkey',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.assignedTo],
      foreignColumns: [iamUsers.id],
      name: 'support_tickets_assigned_to_fkey',
    }),
  ],
);

export const opsJobsDeadletter = ops.table('jobs_deadletter', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  queue: text().notNull(),
  jobId: text('job_id').notNull(),
  payload: jsonb(),
  error: text(),
  attempts: smallint(),
  failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
