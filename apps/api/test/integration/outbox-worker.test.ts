import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { OutboxService } from '../../src/shared/events/outbox.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    const emitter = app.get(EventEmitter2);
    const received: string[] = [];
    emitter.on('outbox.test.happened', (ev: { payload: { k: string } }) => received.push(ev.payload.k));
    await dbs.db.transaction(async (tx) => {
      await outbox.write(tx, { aggregateType: 'test', eventType: 'test.happened', payload: { k: 'v1' } });
    });
    await expect(
      dbs.db.transaction(async (tx) => {
        await outbox.write(tx, { aggregateType: 'test', eventType: 'test.happened', payload: { k: 'rolled-back' } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const n = await outbox.relayBatch(500);
    expect(n).toBeGreaterThan(0);
    expect(received).toContain('v1');
    expect(received).not.toContain('rolled-back');
    const unpublished = await dbs.db.select().from(schema.opsOutbox).where(isNull(schema.opsOutbox.publishedAt));
    expect(unpublished).toHaveLength(0);
    const [last] = await dbs.db.select().from(schema.opsOutbox).where(eq(schema.opsOutbox.eventType, 'test.happened')).orderBy(desc(schema.opsOutbox.id)).limit(1);
    expect(last?.publishedAt).toBeTruthy();
  });
});
