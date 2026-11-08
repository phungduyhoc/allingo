import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { DbService } from '../../src/shared/db/db.module.js';
import { OutboxPermanentError, OutboxService } from '../../src/shared/events/outbox.service.js';
import { bootTestApp, client } from './setup.js';

const ENV_KEYS = ['OUTBOX_MAX_ATTEMPTS', 'OUTBOX_RETRY_BASE_SECONDS', 'OUTBOX_RETRY_MAX_SECONDS'] as const;
const uniq = () => randomBytes(4).toString('hex');

interface Row {
  id: number;
  attempts: number;
  published: boolean;
  dead: boolean;
  pending: string[] | null;
  last_error: string | null;
  wait_sec: number | null;
}

/**
 * B7/S26 – outbox thử lại có giới hạn + dead-letter (PG/Redis cục bộ): lỗi tạm thời → thử lại theo backoff rồi thành công, chỉ consumer
 * lỗi được gọi lại (consumer đã xong không chạy lại – idempotent); lỗi vĩnh viễn → dead-letter ngay; quá số lần → dead-letter;
 * admin replay giao lại đúng consumer lỗi, replay lần nữa không giao lại; hai relay song song không giao trùng (SKIP LOCKED + lease).
 */
describe('B7/S26 outbox retry + dead-letter (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let outbox: OutboxService;
  const saved: Record<string, string | undefined> = {};
  const offs: Array<() => void> = [];

  const emit = async (eventType: string, payload: Record<string, unknown>) => {
    await dbs.db.transaction((tx) => outbox.write(tx, { aggregateType: 'b7test', eventType, payload }));
    const [r] = (await dbs.db.execute(sql`select id from ops.outbox where event_type = ${eventType} order by id desc limit 1`)) as unknown as Array<{ id: string | number }>;
    return Number(r!.id);
  };
  const row = async (id: number): Promise<Row> => {
    const [r] = (await dbs.db.execute(sql`select id, attempts, published_at is not null as published, dead_lettered_at is not null as dead, pending_consumers as pending, last_error, extract(epoch from next_attempt_at - now())::float8 as wait_sec from ops.outbox where id = ${id}`)) as unknown as Row[];
    return { ...r!, id: Number(r!.id), wait_sec: r!.wait_sec === null ? null : Number(r!.wait_sec) };
  };
  /** Bỏ qua thời gian chờ backoff của một sự kiện (thay cho chờ thật) */
  const due = (id: number) => dbs.db.execute(sql`update ops.outbox set next_attempt_at = now() - interval '1 second' where id = ${id}`);
  /** Relay tới khi hết sự kiện đến hạn (DB test dùng chung có tồn đọng của file khác) */
  const relayAll = async () => {
    for (let i = 0; i < 50; i++) if ((await outbox.relayBatch(500)) === 0) break;
  };

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.OUTBOX_MAX_ATTEMPTS = '3';
    process.env.OUTBOX_RETRY_BASE_SECONDS = '60';
    process.env.OUTBOX_RETRY_MAX_SECONDS = '600';
    app = await bootTestApp();
    dbs = app.get(DbService);
    outbox = app.get(OutboxService);
    await relayAll();
  });

  afterAll(async () => {
    for (const off of offs) off();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await app?.close();
  });

  it('consumer @OnEvent của module được khám phá (giao trực tiếp, không qua EventEmitter2)', () => {
    const ids = outbox.consumersFor('attempt.graded').map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['GamificationService.onOutboxGraded', 'PlanService.onOutboxGraded', 'ErrorLogService.onOutboxGraded']));
    expect(outbox.consumersFor('order.paid').map((c) => c.id)).toEqual(expect.arrayContaining(['InvoicesService.onPaidOutbox']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lỗi tạm thời → thử lại theo backoff → thành công; consumer đã xong không chạy lại (idempotent)', async () => {
    const ev = `b7.transient.${uniq()}`;
    let okCalls = 0;
    let flakyCalls = 0;
    offs.push(outbox.subscribe(ev, 'b7.ok', () => void okCalls++));
    offs.push(
      outbox.subscribe(ev, 'b7.flaky', () => {
        flakyCalls++;
        if (flakyCalls <= 2) throw new Error(`provider timeout #${flakyCalls}`);
      }),
    );
    const id = await emit(ev, { k: 1 });
    await relayAll();
    let r = await row(id);
    expect(r).toMatchObject({ attempts: 1, published: false, dead: false, pending: ['b7.flaky'] });
    expect(r.last_error).toContain('b7.flaky: provider timeout #1');
    // backoff lần 1 = base 60 s → chưa đến hạn thì relay bỏ qua
    expect(r.wait_sec!).toBeGreaterThan(50);
    await relayAll();
    expect(flakyCalls).toBe(1);
    await due(id);
    await relayAll();
    r = await row(id);
    expect(r).toMatchObject({ attempts: 2, published: false, pending: ['b7.flaky'] });
    // backoff lần 2 = 120 s
    expect(r.wait_sec!).toBeGreaterThan(110);
    await due(id);
    await relayAll();
    r = await row(id);
    expect(r).toMatchObject({ published: true, dead: false, pending: null, last_error: null });
    expect(flakyCalls).toBe(3);
    expect(okCalls).toBe(1);
    // đã giao → relay tiếp không gọi lại
    await relayAll();
    expect(okCalls + flakyCalls).toBe(4);
  });

  it('lỗi vĩnh viễn (OutboxPermanentError) → dead-letter ngay (queue outbox, job_name = event_type); không thử lại', async () => {
    const ev = `b7.permanent.${uniq()}`;
    let calls = 0;
    offs.push(
      outbox.subscribe(ev, 'b7.strict', () => {
        calls++;
        throw new OutboxPermanentError('payload thiếu question_id');
      }),
    );
    const id = await emit(ev, { k: 2 });
    await relayAll();
    const r = await row(id);
    expect(r).toMatchObject({ attempts: 1, published: false, dead: true, pending: ['b7.strict'] });
    const [dl] = (await dbs.db.execute(sql`select queue, job_id, job_name, attempts, error, payload from ops.jobs_deadletter where job_id = ${`outbox__${id}`}`)) as unknown as Array<{ queue: string; job_name: string; attempts: number; error: string; payload: { consumers: string[]; event_type: string; payload: { k: number } } }>;
    expect(dl).toMatchObject({ queue: 'outbox', job_name: ev, attempts: 1 });
    expect(dl!.error).toContain('payload thiếu question_id');
    expect(dl!.payload).toMatchObject({ consumers: ['b7.strict'], event_type: ev, payload: { k: 2 } });
    await due(id);
    await relayAll();
    expect(calls).toBe(1);
  });

  it('lỗi mãi → sau OUTBOX_MAX_ATTEMPTS lần vào dead-letter; admin replay giao lại đúng consumer lỗi; replay lần nữa không giao lại', async () => {
    const ev = `b7.exhaust.${uniq()}`;
    let healthy = false;
    let okCalls = 0;
    let badCalls = 0;
    offs.push(outbox.subscribe(ev, 'b7.ok2', () => void okCalls++));
    offs.push(
      outbox.subscribe(ev, 'b7.down', () => {
        badCalls++;
        if (!healthy) throw new Error('search provider unavailable');
      }),
    );
    const id = await emit(ev, { k: 3 });
    for (let i = 0; i < 3; i++) {
      await due(id);
      await relayAll();
    }
    const r = await row(id);
    expect(r).toMatchObject({ attempts: 3, dead: true, published: false, pending: ['b7.down'] });
    expect(badCalls).toBe(3);
    expect(okCalls).toBe(1);
    const [dl] = (await dbs.db.execute(sql`select id from ops.jobs_deadletter where job_id = ${`outbox__${id}`}`)) as unknown as Array<{ id: string }>;
    const admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: 'Allingo@2026' })).status).toBe(200);
    const list = await admin.call('GET', '/admin/jobs/dead-letters?queue=outbox&replayed=false&limit=100');
    expect(list.body.data.find((x: { id: string }) => x.id === dl!.id)).toMatchObject({ queue: 'outbox', job: ev, attempts: 3 });
    const status = await admin.call('GET', '/admin/system/status');
    expect(status.body.outbox.dead_lettered).toBeGreaterThanOrEqual(2);
    expect(status.body.dead_letters.by_queue.outbox).toBeGreaterThanOrEqual(2);
    // Sửa nguyên nhân rồi replay → chỉ consumer lỗi chạy lại
    healthy = true;
    const rep = await admin.call('POST', `/admin/jobs/dead-letters/${dl!.id}/replay`);
    expect(rep.status).toBe(200);
    expect(rep.body).toMatchObject({ mode: 'inline', replay_count: 1, error: null, result: { status: 'delivered', delivered: ['b7.down'], failed: [] } });
    expect(await row(id)).toMatchObject({ published: true, dead: false, pending: null });
    expect(okCalls).toBe(1);
    expect(badCalls).toBe(4);
    const again = await admin.call('POST', `/admin/jobs/dead-letters/${dl!.id}/replay`);
    expect(again.body).toMatchObject({ replay_count: 2, result: { status: 'already_delivered', delivered: [] } });
    expect(badCalls).toBe(4);
    const audit = (await dbs.db.execute(sql`select count(*)::int as n from ops.audit_logs where action = 'job.dead_letter_replayed' and entity_id = ${dl!.id}`)) as unknown as Array<{ n: number }>;
    expect(audit[0]!.n).toBe(2);
  });

  it('hai relay song song không giao trùng (FOR UPDATE SKIP LOCKED + lease)', async () => {
    const ev = `b7.parallel.${uniq()}`;
    const seen = new Map<number, number>();
    offs.push(
      outbox.subscribe(ev, 'b7.counter', async (e) => {
        seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 5));
      }),
    );
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) ids.push(await emit(ev, { i }));
    await Promise.all([outbox.relayBatch(500), outbox.relayBatch(500), outbox.relayBatch(500)]);
    await relayAll();
    expect(ids.map((id) => seen.get(id) ?? 0)).toEqual(ids.map(() => 1));
  });
});
