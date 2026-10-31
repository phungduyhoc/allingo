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
  date,
  char,
  check,
  bigserial,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { LocalizedText } from '@allingo/schemas';
import { billing } from './_common.js';
import { catalogPrograms } from './catalog.js';
import { iamOrganizations, iamUsers } from './iam.js';

export const billingCreditReason = billing.enum('credit_reason', [
  'purchase',
  'subscription_grant',
  'referral',
  'promo',
  'consume',
  'refund',
  'expire',
  'admin_adjust',
  'b2b_pool',
]);

export const billingOrderStatus = billing.enum('order_status', [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'expired',
]);

export const billingPaymentProvider = billing.enum('payment_provider', [
  'vnpay',
  'momo',
  'zalopay',
  'payos',
  'stripe',
  'bank_transfer',
  'manual',
]);

export const billingPlanKind = billing.enum('plan_kind', [
  'free',
  'monthly',
  'yearly',
  'lifetime',
  'combo',
  'credit_pack',
  'b2b_seat',
]);

export const billingQuotaPeriod = billing.enum('quota_period', ['day', 'month', 'lifetime']);

export const billingSubscriptionStatus = billing.enum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
  'lifetime',
]);

export const billingPlans = billing.table(
  'plans',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: text().notNull(),
    kind: billingPlanKind().notNull(),
    programCodes: text('program_codes').array().default(['']).notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    description: jsonb().$type<LocalizedText>(),
    creditsIncluded: integer('credits_included').default(0).notNull(),
    creditsPeriod: text('credits_period'),
    durationDays: integer('duration_days'),
    features: jsonb().default({}).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: smallint('sort_order').default(0).notNull(),
  },
  (table) => [unique('plans_code_key').on(table.code)],
);

export const billingPrices = billing.table(
  'prices',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    planId: uuid('plan_id').notNull(),
    currency: char({ length: 3 }).default('VND').notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    compareAt: numeric('compare_at', { precision: 14, scale: 2 }),
    region: text().default('VN').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_prices_plan_valid').using(
      'btree',
      table.planId.asc().nullsLast().op('uuid_ops'),
      table.validFrom.asc().nullsLast().op('timestamptz_ops'),
      table.validTo.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.planId],
      foreignColumns: [billingPlans.id],
      name: 'prices_plan_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const billingOrders = billing.table(
  'orders',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    orgId: uuid('org_id'),
    planId: uuid('plan_id').notNull(),
    priceId: uuid('price_id').notNull(),
    promotionId: uuid('promotion_id'),
    quantity: integer().default(1).notNull(),
    currency: char({ length: 3 }).notNull(),
    subtotal: numeric({ precision: 14, scale: 2 }).notNull(),
    discount: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull(),
    status: billingOrderStatus().default('pending').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    buyerInfo: jsonb('buyer_info'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_orders_user_created').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'orders_user_id_fkey',
    }),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [iamOrganizations.id],
      name: 'orders_org_id_fkey',
    }),
    foreignKey({
      columns: [table.planId],
      foreignColumns: [billingPlans.id],
      name: 'orders_plan_id_fkey',
    }),
    foreignKey({
      columns: [table.priceId],
      foreignColumns: [billingPrices.id],
      name: 'orders_price_id_fkey',
    }),
    foreignKey({
      columns: [table.promotionId],
      foreignColumns: [billingPromotions.id],
      name: 'orders_promotion_id_fkey',
    }),
    unique('orders_idempotency_key_key').on(table.idempotencyKey),
  ],
);

export const billingPromotions = billing.table(
  'promotions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    code: text().notNull(),
    kind: text().notNull(),
    value: numeric({ precision: 14, scale: 2 }).notNull(),
    planIds: uuid('plan_ids').array(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }).notNull(),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').default(0).notNull(),
    perUserLimit: smallint('per_user_limit').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [unique('promotions_code_key').on(table.code)],
);

export const billingPayments = billing.table(
  'payments',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    orderId: uuid('order_id').notNull(),
    provider: billingPaymentProvider().notNull(),
    providerTxnId: text('provider_txn_id'),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    status: text().notNull(),
    rawCallback: jsonb('raw_callback'),
    signatureValid: boolean('signature_valid'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_payments_order').using('btree', table.orderId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [billingOrders.id],
      name: 'payments_order_id_fkey',
    }),
    unique('payments_provider_provider_txn_id_key').on(table.provider, table.providerTxnId),
  ],
);

export const billingSubscriptions = billing.table(
  'subscriptions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id'),
    orgId: uuid('org_id'),
    planId: uuid('plan_id').notNull(),
    programCode: text('program_code'),
    status: billingSubscriptionStatus().notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true, mode: 'date' }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, mode: 'date' }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    providerTokenRef: text('provider_token_ref'),
    sourceOrderId: uuid('source_order_id'),
    seats: integer(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_subscriptions_period_end')
      .using('btree', table.currentPeriodEnd.asc().nullsLast().op('timestamptz_ops'))
      .where(sql`(status = 'active'::billing.subscription_status)`),
    index('ix_subscriptions_user_status').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.status.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'subscriptions_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [iamOrganizations.id],
      name: 'subscriptions_org_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.planId],
      foreignColumns: [billingPlans.id],
      name: 'subscriptions_plan_id_fkey',
    }),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'subscriptions_program_code_fkey',
    }),
    foreignKey({
      columns: [table.sourceOrderId],
      foreignColumns: [billingOrders.id],
      name: 'subscriptions_source_order_id_fkey',
    }),
    check('subscriptions_check', sql`(user_id IS NOT NULL) OR (org_id IS NOT NULL)`),
  ],
);

export const billingEntitlements = billing.table(
  'entitlements',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    programCode: text('program_code'),
    featureCode: text('feature_code').notNull(),
    source: text().notNull(),
    sourceId: uuid('source_id'),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_entitlements_user_valid').using(
      'btree',
      table.userId.asc().nullsLast().op('timestamptz_ops'),
      table.featureCode.asc().nullsLast().op('timestamptz_ops'),
      table.validTo.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'entitlements_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.programCode],
      foreignColumns: [catalogPrograms.code],
      name: 'entitlements_program_code_fkey',
    }),
    unique('entitlements_user_id_program_code_feature_code_source_sourc_key').on(
      table.userId,
      table.programCode,
      table.featureCode,
      table.source,
      table.sourceId,
    ),
  ],
);

export const billingQuotas = billing.table(
  'quotas',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    planKind: billingPlanKind('plan_kind').notNull(),
    featureCode: text('feature_code').notNull(),
    period: billingQuotaPeriod().notNull(),
    limitValue: integer('limit_value').notNull(),
  },
  (table) => [unique('quotas_plan_kind_feature_code_period_key').on(table.planKind, table.featureCode, table.period)],
);

export const billingCreditLedger = billing.table(
  'credit_ledger',
  {
    id: bigserial({ mode: 'bigint' }).primaryKey().notNull(),
    userId: uuid('user_id'),
    orgId: uuid('org_id'),
    delta: integer().notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: billingCreditReason().notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    aiTaskId: uuid('ai_task_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('ix_credit_ledger_org_created').using(
      'btree',
      table.orgId.asc().nullsLast().op('timestamptz_ops'),
      table.createdAt.desc().nullsFirst().op('uuid_ops'),
    ),
    index('ix_credit_ledger_user_created').using(
      'btree',
      table.userId.asc().nullsLast().op('uuid_ops'),
      table.createdAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'credit_ledger_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [iamOrganizations.id],
      name: 'credit_ledger_org_id_fkey',
    }).onDelete('cascade'),
    check('credit_ledger_check', sql`(user_id IS NOT NULL) OR (org_id IS NOT NULL)`),
  ],
);

export const billingInvoices = billing.table(
  'invoices',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    orderId: uuid('order_id').notNull(),
    provider: text().notNull(),
    series: text(),
    invoiceNo: text('invoice_no'),
    lookupCode: text('lookup_code'),
    status: text().notNull(),
    pdfUrl: text('pdf_url'),
    raw: jsonb(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [billingOrders.id],
      name: 'invoices_order_id_fkey',
    }),
    unique('invoices_order_id_key').on(table.orderId),
  ],
);

export const billingReconciliationRuns = billing.table(
  'reconciliation_runs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    provider: billingPaymentProvider().notNull(),
    forDate: date('for_date').notNull(),
    expectedTotal: numeric('expected_total', { precision: 14, scale: 2 }),
    actualTotal: numeric('actual_total', { precision: 14, scale: 2 }),
    mismatches: jsonb().default([]).notNull(),
    status: text().notNull(),
    runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [unique('reconciliation_runs_provider_for_date_key').on(table.provider, table.forDate)],
);

export const billingFeatureFlags = billing.table('feature_flags', {
  key: text().primaryKey().notNull(),
  enabled: boolean().default(false).notNull(),
  rules: jsonb().default({}).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const billingCreditBalances = billing.table(
  'credit_balances',
  {
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    balance: integer().default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerType, table.ownerId], name: 'credit_balances_pkey' }),
    check('credit_balances_balance_check', sql`balance >= 0`),
  ],
);

export const billingUsageCounters = billing.table(
  'usage_counters',
  {
    userId: uuid('user_id').notNull(),
    featureCode: text('feature_code').notNull(),
    periodKey: text('period_key').notNull(),
    used: integer().default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [iamUsers.id],
      name: 'usage_counters_user_id_fkey',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.userId, table.featureCode, table.periodKey], name: 'usage_counters_pkey' }),
  ],
);

export const billingVActiveEntitlements = billing
  .view('v_active_entitlements', {
    userId: uuid('user_id'),
    programCode: text('program_code'),
    featureCode: text('feature_code'),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  })
  .as(
    sql`SELECT user_id, program_code, feature_code, min(valid_from) AS valid_from, max(valid_to) AS valid_to FROM billing.entitlements WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now()) GROUP BY user_id, program_code, feature_code`,
  );
