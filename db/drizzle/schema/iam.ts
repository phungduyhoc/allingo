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
  inet,
  pgPolicy,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext } from './_types.js';
import { iam } from './_common.js';

export const iamAuthProvider = iam.enum('auth_provider', ['email', 'phone', 'google', 'apple', 'facebook', 'zalo']);

export const iamConsentType = iam.enum('consent_type', [
  'terms',
  'privacy',
  'voice_processing',
  'marketing',
  'minor_guardian',
]);

export const iamOrgRole = iam.enum('org_role', ['org_admin', 'teacher', 'learner']);

export const iamOrgType = iam.enum('org_type', ['school', 'center', 'company', 'other']);

export const iamReferralStatus = iam.enum('referral_status', ['joined', 'started', 'upgraded']);

export const iamUserStatus = iam.enum('user_status', ['active', 'suspended', 'pending_deletion', 'deleted']);

export const iamUsers = iam.table(
  'users',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: citext('email'),
    phone: text(),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    uiLocale: text('ui_locale').default('vi').notNull(),
    explainLocale: text('explain_locale').default('vi').notNull(),
    timezone: text().default('Asia/Ho_Chi_Minh').notNull(),
    status: iamUserStatus().default('active').notNull(),
    isGuest: boolean('is_guest').default(false).notNull(),
    birthYear: smallint('birth_year'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [unique('users_email_key').on(table.email), unique('users_phone_key').on(table.phone)],
);

export const iamAuthIdentities = iam.table(
  'auth_identities',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    provider: iamAuthProvider().notNull(),
    providerUid: text('provider_uid').notNull(),
    email: citext('email'),
    rawProfile: jsonb('raw_profile'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_auth_identities_user').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'auth_identities_user_id_fkey',
    }).onDelete('cascade'),
    unique('auth_identities_provider_provider_uid_key').on(table.provider, table.providerUid),
  ],
);

export const iamSessions = iam.table(
  'sessions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    device: jsonb(),
    ip: inet(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_sessions_user_active')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`(revoked_at IS NULL)`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'sessions_user_id_fkey',
    }).onDelete('cascade'),
    unique('sessions_refresh_token_hash_key').on(table.refreshTokenHash),
  ],
);

export const iamUserRoles = iam.table(
  'user_roles',
  {
    userId: uuid('user_id').notNull(),
    roleCode: text('role_code').notNull(),
    programCode: text('program_code'),
    grantedBy: uuid('granted_by'),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'user_roles_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.roleCode],
      foreignColumns: [iamRoles.code],
      name: 'user_roles_role_code_fkey',
    }),
    foreignKey({
      columns: [table.grantedBy],
      foreignColumns: [iamUsers.id],
      name: 'user_roles_granted_by_fkey',
    }),
    unique('user_roles_user_id_role_code_program_code_key').on(table.userId, table.roleCode, table.programCode),
  ],
);

export const iamRoles = iam.table('roles', {
  code: text().primaryKey().notNull(),
  description: text(),
});

export const iamOrganizations = iam.table('organizations', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  name: text().notNull(),
  type: iamOrgType().notNull(),
  taxCode: text('tax_code'),
  domain: text(),
  settings: jsonb().default({}).notNull(),
  status: text().default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const iamReferrals = iam.table(
  'referrals',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    referrerUserId: uuid('referrer_user_id').notNull(),
    refereeUserId: uuid('referee_user_id'),
    code: text().notNull(),
    status: iamReferralStatus().default('joined').notNull(),
    deviceFingerprint: text('device_fingerprint'),
    ip: inet(),
    creditedJoinAt: timestamp('credited_join_at', { withTimezone: true, mode: 'date' }),
    creditedUpgradeAt: timestamp('credited_upgrade_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_referrals_referrer').using('btree', table.referrerUserId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.referrerUserId],
      foreignColumns: [iamUsers.id],
      name: 'referrals_referrer_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.refereeUserId],
      foreignColumns: [iamUsers.id],
      name: 'referrals_referee_user_id_fkey',
    }).onDelete('cascade'),
    unique('referrals_referee_user_id_key').on(table.refereeUserId),
  ],
);

export const iamConsents = iam.table(
  'consents',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    type: iamConsentType().notNull(),
    version: text().notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    ip: inet(),
  },
  (table) => [
    index('ix_consents_user_type').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.type.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'consents_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const iamDeletionRequests = iam.table(
  'deletion_requests',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    exportUrl: text('export_url'),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'deletion_requests_user_id_fkey',
    }),
  ],
);

export const iamClasses = iam.table(
  'classes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    orgId: uuid('org_id').notNull(),
    name: text().notNull(),
    programCode: text('program_code'),
    teacherUserId: uuid('teacher_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [iamOrganizations.id],
      name: 'classes_org_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.teacherUserId],
      foreignColumns: [iamUsers.id],
      name: 'classes_teacher_user_id_fkey',
    }),
    pgPolicy('org_scope_classes', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)))`,
    }),
  ],
);

export const iamOrgMemberships = iam.table(
  'org_memberships',
  {
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: iamOrgRole().notNull(),
    classId: uuid('class_id'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_org_memberships_user').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [iamOrganizations.id],
      name: 'org_memberships_org_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'org_memberships_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.classId],
      foreignColumns: [iamClasses.id],
      name: 'org_memberships_class_id_fkey',
    }).onDelete('set null'),
    primaryKey({ columns: [table.orgId, table.userId], name: 'org_memberships_pkey' }),
    pgPolicy('org_scope_memberships', {
      as: 'permissive',
      for: 'all',
      to: ['public'],
      using: sql`((current_setting('app.role'::text, true) = ANY (ARRAY['admin'::text, 'superadmin'::text, 'service'::text])) OR ((org_id)::text = current_setting('app.org_id'::text, true)) OR ((user_id)::text = current_setting('app.user_id'::text, true)))`,
    }),
  ],
);
