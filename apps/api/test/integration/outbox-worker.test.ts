import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { OutboxService } from '../../src/shared/events/outbox.service.js';
import { bootTestApp } from './setup.js';

describe('outbox relay (integration)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await bootTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('ghi sự kiện trong transaction và relay đánh dấu published', async () => {
    const dbs = app.get(DbService);
    const outbox = app.get(OutboxService);
    const received: string[] = [];
    // B7/S26: consumer lập trình đăng ký qua OutboxService.subscribe (relay không còn phát `outbox.*` qua EventEmitter2)
    const off = outbox.subscribe('test.happened', 'test.receiver', (ev) => {
      received.push((ev.payload as { k: string }).k);
    });
    await dbs.db.transaction(async (tx) => {
      await outbox.write(tx, { aggregateType: 'test', eventType: 'test.happened', payload: { k: 'v1' } });
    });
    await expect(
      dbs.db.transaction(async (tx) => {
        await outbox.write(tx, { aggregateType: 'test', eventType: 'test.happened', payload: { k: 'rolled-back' } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    // S9: consumer có thể sinh sự kiện mới khi relay (attempt.graded → plan_task.completed / badge.awarded; DB test dùng lại có
    // tồn đọng của file test khác) → relay tới khi hết hàng chờ
    let n = 0;
    for (let i = 0; i < 50; i++) {
      const k = await outbox.relayBatch(500);
      n += k;
      if (k === 0) break;
    }
    expect(n).toBeGreaterThan(0);
    expect(received).toContain('v1');
    expect(received).not.toContain('rolled-back');
    // B7: dòng đang chờ thử lại (attempts > 0) hoặc đã dead-letter là trạng thái hợp lệ (vd. sự kiện cố ý lỗi của
    // b7-outbox-retry chạy trước trên DB dùng chung) → chỉ kiểm dòng chưa từng giao lỗi đều đã được relay
    const unpublished = await dbs.db
      .select()
      .from(schema.opsOutbox)
      .where(and(isNull(schema.opsOutbox.publishedAt), isNull(schema.opsOutbox.deadLetteredAt), eq(schema.opsOutbox.attempts, 0)));
    expect(unpublished.map((r) => r.eventType)).toEqual([]);
    const [last] = await dbs.db.select().from(schema.opsOutbox).where(eq(schema.opsOutbox.eventType, 'test.happened')).orderBy(desc(schema.opsOutbox.id)).limit(1);
    expect(last?.publishedAt).toBeTruthy();
    off();
  });
});
