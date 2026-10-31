// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.

import { pgSchema } from 'drizzle-orm/pg-core';

export const iam = pgSchema('iam');

export const catalog = pgSchema('catalog');

export const learn = pgSchema('learn');

export const ai = pgSchema('ai');

export const billing = pgSchema('billing');

export const ops = pgSchema('ops');

export const opsAuditLogsIdSeq = ops.sequence('audit_logs_id_seq', {
  startWith: '1',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});

export const opsOutboxIdSeq = ops.sequence('outbox_id_seq', {
  startWith: '1',
  increment: '1',
  minValue: '1',
  maxValue: '9223372036854775807',
  cache: '1',
  cycle: false,
});
