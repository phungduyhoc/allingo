import { Injectable } from '@nestjs/common';
import { schema } from '@allingo/db';
import { DbService, type DbOrTx } from '../db/db.module.js';

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Nhật ký kiểm toán ops.audit_logs (partition tháng). Không ghi PII vào before/after – chỉ id, trạng thái, đếm.
 * Ghi trong cùng transaction với nghiệp vụ khi có tx.
 */
@Injectable()
export class AuditService {
  constructor(private readonly dbs: DbService) {}

  async log(entry: AuditEntry, db: DbOrTx = this.dbs.db): Promise<void> {
    await db.insert(schema.opsAuditLogs).values({
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 300) ?? null,
    });
  }
}
