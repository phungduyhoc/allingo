import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService, type DbOrTx } from '../db/db.module.js';
import { getLogger } from '../telemetry/logger.js';
import { AuditService } from './audit.service.js';
import { PersonalDataRegistry } from './personal-data.registry.js';
import { UserDirectory } from './user-directory.js';

export interface OutboxEvent<T = Record<string, unknown>> {
  id: number;
  aggregate_type: string;
  aggregate_id: string | null;
  event_type: string;
  payload: T;
  created_at: Date;
}

/**
 * Outbox (ADR-0006, CLAUDE.md §5.12): sự kiện miền ghi vào ops.outbox trong CÙNG transaction với nghiệp vụ;
 * relay (worker) đọc hàng chưa published và phát lên EventEmitter nội bộ → consumer (search/notify/analytics/learning).
 */
@Injectable()
export class OutboxService {
  private readonly logger = getLogger({ component: 'outbox' });
  constructor(
    private readonly dbs: DbService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** Ghi sự kiện trong transaction đang mở */
  async write(tx: DbOrTx, event: { aggregateType: string; aggregateId?: string | null; eventType: string; payload: Record<string, unknown> }): Promise<void> {
    await tx.insert(schema.opsOutbox).values({
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId ?? null,
      eventType: event.eventType,
      payload: event.payload,
    });
  }

  /** Relay một lô: phát sự kiện nội bộ rồi đánh dấu published. Trả số sự kiện xử lý. */
  async relayBatch(limit = 100): Promise<number> {
    const rows = await this.dbs.db
      .select()
      .from(schema.opsOutbox)
      .where(and(isNull(schema.opsOutbox.publishedAt), lt(schema.opsOutbox.createdAt, sql`now()`)))
      .orderBy(asc(schema.opsOutbox.id))
      .limit(limit);
    for (const row of rows) {
      const ev: OutboxEvent = { id: row.id, aggregate_type: row.aggregateType, aggregate_id: row.aggregateId, event_type: row.eventType, payload: row.payload as Record<string, unknown>, created_at: row.createdAt };
      try {
        await this.emitter.emitAsync(`outbox.${row.eventType}`, ev);
        await this.emitter.emitAsync('outbox.*', ev);
      } catch (err) {
        this.logger.error({ err, event_type: row.eventType, id: row.id }, 'outbox consumer failed');
      }
      await this.dbs.db.update(schema.opsOutbox).set({ publishedAt: new Date() }).where(eq(schema.opsOutbox.id, row.id));
    }
    return rows.length;
  }

  /** Phát ngay sau commit (không qua relay) cho các consumer cùng process cần phản hồi nhanh (realtime, XP). Relay vẫn chạy để consumer ngoài process nhận. */
  emitLocal(eventType: string, payload: Record<string, unknown>): void {
    this.emitter.emit(`local.${eventType}`, payload);
  }
}

@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
  providers: [OutboxService, AuditService, PersonalDataRegistry, UserDirectory],
  exports: [OutboxService, AuditService, PersonalDataRegistry, UserDirectory, EventEmitterModule],
})
export class EventsModule {}
