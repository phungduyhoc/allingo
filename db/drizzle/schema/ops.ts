// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.

import { unique, uuid, text, smallint, timestamp, index, foreignKey, jsonb, boolean, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { citext } from './_types.js';
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
    // v1.1 – Sprint 12: hàng đợi admin
    index('ix_feedback_status').using('btree', table.status.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
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
    // v1.1 – Sprint 12 (migration 0009)
    message: text(),
    resolutionNote: text('resolution_note'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_content_reports_status_due').using('btree', table.status.asc().nullsLast(), table.slaDueAt.asc().nullsLast()),
    uniqueIndex('ux_content_reports_open_per_user')
      .using('btree', table.userId.asc().nullsLast(), table.entityType.asc().nullsLast(), table.entityId.asc().nullsLast())
      .where(sql`(status = 'open'::text)`),
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
    // v1.1 – Sprint 12 (migration 0009): loại, ngữ cảnh kỹ thuật, SLA phản hồi đầu 24 giờ
    category: text().default('other').notNull(),
    context: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true, mode: 'date' }),
    firstRespondedAt: timestamp('first_responded_at', { withTimezone: true, mode: 'date' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'date' }),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_support_tickets_user').using('btree', table.userId.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
    index('ix_support_tickets_status').using('btree', table.status.asc().nullsLast(), table.firstResponseDueAt.asc().nullsLast()),
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
  // v1.1 – Sprint 12 (migration 0009): replay dead-letter
  jobName: text('job_name'),
  replayedAt: timestamp('replayed_at', { withTimezone: true, mode: 'date' }),
  replayCount: smallint('replay_count').default(0).notNull(),
});

// v1.1 – Sprint 12 (migration 0009): hội thoại ticket 2 chiều
export const opsSupportMessages = ops.table(
  'support_messages',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    ticketId: uuid('ticket_id').notNull(),
    authorUserId: uuid('author_user_id'),
    authorKind: text('author_kind').notNull(),
    body: text().notNull(),
    delivery: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_support_messages_ticket').using('btree', table.ticketId.asc().nullsLast(), table.createdAt.asc().nullsLast()),
    foreignKey({ columns: [table.ticketId], foreignColumns: [opsSupportTickets.id], name: 'support_messages_ticket_id_fkey' }).onDelete('cascade'),
    foreignKey({ columns: [table.authorUserId], foreignColumns: [iamUsers.id], name: 'support_messages_author_user_id_fkey' }).onDelete('set null'),
    check('support_messages_author_kind_check', sql`author_kind = ANY (ARRAY['user'::text, 'agent'::text, 'system'::text])`),
  ],
);

// v1.1 – Sprint 12 (migration 0009): beta kín – đăng ký chờ, mã mời (sha256), khảo sát
export const opsWaitlistEntries = ops.table(
  'waitlist_entries',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: citext('email').notNull(),
    program: text().notNull(),
    locale: text().default('vi').notNull(),
    consentMarketing: boolean('consent_marketing').default(false).notNull(),
    source: text(),
    status: text().default('waiting').notNull(),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_waitlist_entries_status').using('btree', table.program.asc().nullsLast(), table.status.asc().nullsLast(), table.createdAt.asc().nullsLast()),
    unique('waitlist_entries_email_program_key').on(table.email, table.program),
    check('waitlist_entries_status_check', sql`status = ANY (ARRAY['waiting'::text, 'invited'::text, 'joined'::text, 'removed'::text])`),
  ],
);

export const opsBetaInvites = ops.table(
  'beta_invites',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: citext('email').notNull(),
    waitlistEntryId: uuid('waitlist_entry_id'),
    program: text().default('toeic').notNull(),
    locale: text().default('vi').notNull(),
    codeHash: text('code_hash'),
    status: text().default('queued').notNull(),
    batch: text(),
    createdBy: uuid('created_by'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    sendAttempts: smallint('send_attempts').default(0).notNull(),
    lastError: text('last_error'),
    redeemedBy: uuid('redeemed_by'),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true, mode: 'date' }),
    grantResult: jsonb('grant_result').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ux_beta_invites_email_active')
      .using('btree', table.email.asc().nullsLast())
      .where(sql`(status = ANY (ARRAY['queued'::text, 'sent'::text, 'redeemed'::text]))`),
    uniqueIndex('ux_beta_invites_redeemed_by').using('btree', table.redeemedBy.asc().nullsLast()).where(sql`(redeemed_by IS NOT NULL)`),
    index('ix_beta_invites_status').using('btree', table.status.asc().nullsLast(), table.createdAt.asc().nullsLast()),
    unique('beta_invites_code_hash_key').on(table.codeHash),
    foreignKey({ columns: [table.waitlistEntryId], foreignColumns: [opsWaitlistEntries.id], name: 'beta_invites_waitlist_entry_id_fkey' }).onDelete('set null'),
    foreignKey({ columns: [table.createdBy], foreignColumns: [iamUsers.id], name: 'beta_invites_created_by_fkey' }).onDelete('set null'),
    foreignKey({ columns: [table.redeemedBy], foreignColumns: [iamUsers.id], name: 'beta_invites_redeemed_by_fkey' }).onDelete('set null'),
    check('beta_invites_status_check', sql`status = ANY (ARRAY['queued'::text, 'sent'::text, 'redeemed'::text, 'revoked'::text, 'expired'::text, 'failed'::text])`),
  ],
);

export const opsSurveyResponses = ops.table(
  'survey_responses',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    kind: text().notNull(),
    answers: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    score: smallint(),
    comment: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_survey_responses_kind').using('btree', table.kind.asc().nullsLast(), table.createdAt.asc().nullsLast()),
    unique('survey_responses_user_id_kind_key').on(table.userId, table.kind),
    foreignKey({ columns: [table.userId], foreignColumns: [iamUsers.id], name: 'survey_responses_user_id_fkey' }).onDelete('cascade'),
    check('survey_responses_kind_check', sql`kind = ANY (ARRAY['beta_onboarding'::text, 'nps_d7'::text, 'nps_d14'::text])`),
    check('survey_responses_score_check', sql`(score IS NULL) OR ((score >= 0) AND (score <= 10))`),
  ],
);
