import { Global, Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { EVENT_LISTENER_METADATA, EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../config/env.js';
import { DbService, type DbOrTx } from '../db/db.module.js';
import { getLogger } from '../telemetry/logger.js';
import { OUTBOX_METRICS } from '../telemetry/metrics.js';
import { AuditService } from './audit.service.js';
import { PersonalDataRegistry } from './personal-data.registry.js';
import { UserDirectory } from './user-directory.js';

const { opsOutbox, opsJobsDeadletter } = schema;
type OutboxRow = typeof opsOutbox.$inferSelect;

export interface OutboxEvent<T = Record<string, unknown>> {
  id: number;
  aggregate_type: string;
  aggregate_id: string | null;
  event_type: string;
  payload: T;
  created_at: Date;
}

/**
 * Lỗi vĩnh viễn (dữ liệu sai, tham chiếu không còn…): consumer ném lỗi này → sự kiện vào dead-letter NGAY, không thử lại.
 * Lỗi khác (provider/DB/mạng) coi là tạm thời → thử lại theo backoff.
 */
export class OutboxPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxPermanentError';
  }
}

/**
 * Hàng đợi dead-letter của outbox trong ops.jobs_deadletter (không phải hàng đợi BullMQ). Cập nhật hàng outbox theo `id` (duy nhất
 * nhờ sequence) – không so `created_at` vì Date của JS chỉ tới mili giây còn timestamptz lưu micro giây.
 */
export const OUTBOX_DLQ_QUEUE = 'outbox';

export interface OutboxConsumer {
  /** Định danh ổn định giữa các lần deploy/process: `<Class>.<method>` (@OnEvent) hoặc tên truyền vào subscribe() */
  id: string;
  /** Mẫu sự kiện kiểu EventEmitter2 (`outbox.attempt.graded`, `outbox.content.*`, `outbox.**`) */
  pattern: string;
  handle: (ev: OutboxEvent) => unknown;
}

export interface OutboxDeliveryResult {
  status: 'delivered' | 'retry' | 'dead_letter' | 'already_delivered';
  delivered: string[];
  failed: Array<{ consumer: string; error: string; permanent: boolean }>;
  attempts: number;
}

/** Khớp tên sự kiện với mẫu EventEmitter2 (dấu phân cách `.`; `*` = đúng một đoạn, `**` = không/nhiều đoạn) – thuần, có unit test */
export function matchesEventPattern(pattern: string, event: string): boolean {
  const p = pattern.split('.');
  const e = event.split('.');
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === e.length;
    if (p[i] === '**') {
      for (let k = j; k <= e.length; k++) if (go(i + 1, k)) return true;
      return false;
    }
    if (j === e.length) return false;
    return (p[i] === '*' || p[i] === e[j]) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/** Backoff mũ (giây) sau lần lỗi thứ `attempt` (≥ 1): base·2^(attempt−1), trần `max` – thuần, có unit test */
export function outboxBackoffSeconds(attempt: number, base: number, max: number): number {
  if (base <= 0) return 0;
  return Math.min(max, base * 2 ** Math.max(0, Math.min(30, attempt - 1)));
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300);

/**
 * Outbox (ADR-0006, ADR-0036, CLAUDE.md §5.12): sự kiện miền ghi vào ops.outbox trong CÙNG transaction với nghiệp vụ; relay (worker)
 * giữ chỗ lô sự kiện chưa giao (`FOR UPDATE SKIP LOCKED` + lease `next_attempt_at` – nhiều replica không giao trùng), rồi gọi TỪNG
 * consumer (phương thức `@OnEvent('outbox.<event>')` được khám phá lúc khởi động, hoặc `subscribe()`), ghi lại consumer còn lỗi.
 * B7/S26: consumer lỗi → chỉ consumer đó được thử lại theo backoff mũ (consumer đã xong không chạy lại – idempotent theo consumer);
 * quá OUTBOX_MAX_ATTEMPTS hoặc OutboxPermanentError → ops.jobs_deadletter (queue `outbox`, job_name = event_type) + metric/log;
 * admin replay (POST /admin/jobs/dead-letters/{id}/replay) giao lại đúng các consumer lỗi.
 * Sự kiện `outbox.*` KHÔNG còn phát qua EventEmitter2 (tránh giao hai lần); `emitLocal` vẫn dùng EventEmitter2 (`local.*`).
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap {
  private readonly logger = getLogger({ component: 'outbox' });
  private readonly consumers = new Map<string, OutboxConsumer>();
  private discovered = false;

  constructor(
    private readonly dbs: DbService,
    private readonly emitter: EventEmitter2,
    @Inject(ENV) private readonly env: Env,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    this.discover();
  }

  /** Khám phá phương thức @OnEvent('outbox.…') của provider/controller singleton (một lần) */
  private discover(): void {
    if (this.discovered) return;
    this.discovered = true;
    for (const w of [...this.discovery.getProviders(), ...this.discovery.getControllers()]) {
      const instance = w.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || w.isAlias) continue;
      const proto = Object.getPrototypeOf(instance) as object | null;
      if (!proto) continue;
      const className = (w.metatype as { name?: string } | undefined)?.name || instance.constructor?.name || 'Anonymous';
      for (const key of this.scanner.getAllMethodNames(proto)) {
        const fn = instance[key];
        if (typeof fn !== 'function') continue;
        const meta = this.reflector.get<Array<{ event: string | symbol | Array<string | symbol> }> | undefined>(EVENT_LISTENER_METADATA, fn);
        if (!meta) continue;
        for (const m of Array.isArray(meta) ? meta : [meta]) {
          const events = (Array.isArray(m.event) ? m.event : [m.event]).filter((e): e is string => typeof e === 'string' && e.startsWith('outbox.'));
          if (!events.length) continue;
          if (!w.isDependencyTreeStatic()) {
            this.logger.warn({ consumer: `${className}.${key}` }, 'request-scoped outbox consumer ignored');
            continue;
          }
          for (const pattern of events) this.add({ id: `${className}.${key}`, pattern, handle: (ev) => (fn as (e: OutboxEvent) => unknown).call(instance, ev) });
        }
      }
    }
    this.logger.debug({ consumers: this.consumers.size }, 'outbox consumers discovered');
  }

  private add(c: OutboxConsumer): void {
    const k = `${c.id}|${c.pattern}`;
    // Cùng lớp đăng ký ở nhiều module (nhiều instance) → giữ một (trước đây EventEmitter gọi cả hai)
    if (!this.consumers.has(k)) this.consumers.set(k, c);
  }

  /** Đăng ký consumer lập trình (script/test): `eventPattern` không có tiền tố `outbox.`; trả hàm huỷ đăng ký */
  subscribe(eventPattern: string, id: string, handle: (ev: OutboxEvent) => unknown): () => void {
    this.discover();
    const c: OutboxConsumer = { id, pattern: `outbox.${eventPattern}`, handle };
    const k = `${c.id}|${c.pattern}`;
    this.consumers.set(k, c);
    return () => {
      if (this.consumers.get(k) === c) this.consumers.delete(k);
    };
  }

  /** Consumer của một loại sự kiện (mỗi id một lần) */
  consumersFor(eventType: string): OutboxConsumer[] {
    this.discover();
    const out = new Map<string, OutboxConsumer>();
    for (const c of this.consumers.values()) if (!out.has(c.id) && matchesEventPattern(c.pattern, `outbox.${eventType}`)) out.set(c.id, c);
    return [...out.values()];
  }

  /** Ghi sự kiện trong transaction đang mở */
  async write(tx: DbOrTx, event: { aggregateType: string; aggregateId?: string | null; eventType: string; payload: Record<string, unknown> }): Promise<void> {
    await tx.insert(opsOutbox).values({
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId ?? null,
      eventType: event.eventType,
      payload: event.payload,
    });
  }

  /** Giữ chỗ ≤ `limit` sự kiện đến hạn (chưa giao, chưa dead-letter, hết backoff/lease) – SKIP LOCKED + lease */
  private async claim(limit: number): Promise<OutboxRow[]> {
    return this.dbs.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(opsOutbox)
        .where(and(isNull(opsOutbox.publishedAt), isNull(opsOutbox.deadLetteredAt), lt(opsOutbox.createdAt, sql`now()`), or(isNull(opsOutbox.nextAttemptAt), lte(opsOutbox.nextAttemptAt, sql`now()`))))
        .orderBy(asc(opsOutbox.id))
        .limit(limit)
        .for('update', { skipLocked: true });
      if (rows.length) {
        await tx
          .update(opsOutbox)
          .set({ nextAttemptAt: sql`now() + make_interval(secs => ${this.env.OUTBOX_LEASE_SECONDS})` })
          .where(inArray(opsOutbox.id, rows.map((r) => r.id)));
      }
      return rows;
    });
  }

  /** Relay một lô: giao từng sự kiện tới các consumer còn phải giao. Trả số sự kiện đã xử lý (kể cả lỗi chờ thử lại). */
  async relayBatch(limit = 100): Promise<number> {
    const rows = await this.claim(limit);
    for (const row of rows) {
      try {
        await this.process(row);
      } catch (err) {
        // Lỗi ghi trạng thái (DB) – lease hết hạn thì relay khác nhận lại
        this.logger.error({ err: errText(err), id: row.id, event_type: row.eventType }, 'outbox process failed');
      }
    }
    return rows.length;
  }

  private toEvent(row: Pick<OutboxRow, 'id' | 'aggregateType' | 'aggregateId' | 'eventType' | 'payload' | 'createdAt'>): OutboxEvent {
    return { id: row.id, aggregate_type: row.aggregateType, aggregate_id: row.aggregateId, event_type: row.eventType, payload: row.payload as Record<string, unknown>, created_at: row.createdAt };
  }

  /** Gọi lần lượt các consumer; lỗi của một consumer không chặn consumer khác */
  private async deliver(ev: OutboxEvent, pending: readonly string[] | null): Promise<{ delivered: string[]; failed: OutboxDeliveryResult['failed']; missing: string[] }> {
    const all = this.consumersFor(ev.event_type);
    const targets = pending ? all.filter((c) => pending.includes(c.id)) : all;
    const missing = pending ? pending.filter((id) => !all.some((c) => c.id === id)) : [];
    const delivered: string[] = [];
    const failed: OutboxDeliveryResult['failed'] = [];
    for (const c of targets) {
      try {
        await c.handle(ev);
        delivered.push(c.id);
      } catch (err) {
        const permanent = err instanceof OutboxPermanentError;
        failed.push({ consumer: c.id, error: errText(err), permanent });
        OUTBOX_METRICS.consumerFailures.inc({ consumer: c.id, kind: permanent ? 'permanent' : 'transient' });
        this.logger.warn({ id: ev.id, event_type: ev.event_type, consumer: c.id, permanent, err: errText(err) }, 'outbox consumer failed');
      }
    }
    // Consumer không còn trong mã (đổi tên/xoá ở bản deploy mới) → bỏ (không thử lại vô hạn)
    if (missing.length) this.logger.warn({ id: ev.id, event_type: ev.event_type, consumers: missing }, 'outbox pending consumers not registered – dropped');
    return { delivered, failed, missing };
  }

  /** Giao một sự kiện đã giữ chỗ rồi ghi kết quả: xong → published; lỗi → thử lại (backoff) hoặc dead-letter */
  private async process(row: OutboxRow): Promise<OutboxDeliveryResult> {
    const ev = this.toEvent(row);
    const { delivered, failed } = await this.deliver(ev, row.pendingConsumers ?? null);
    if (!failed.length) {
      await this.dbs.db.update(opsOutbox).set({ publishedAt: new Date(), nextAttemptAt: null, pendingConsumers: null, lastError: null }).where(eq(opsOutbox.id, row.id));
      OUTBOX_METRICS.events.inc({ event_type: row.eventType, result: 'delivered' });
      if (row.attempts > 0) this.logger.info({ id: row.id, event_type: row.eventType, attempts: row.attempts + 1 }, 'outbox event delivered after retry');
      return { status: 'delivered', delivered, failed, attempts: row.attempts };
    }
    const attempts = row.attempts + 1;
    const lastError = failed.map((f) => `${f.consumer}: ${f.error}`).join(' | ').slice(0, 1000);
    const pending = failed.map((f) => f.consumer);
    if (failed.some((f) => f.permanent) || attempts >= this.env.OUTBOX_MAX_ATTEMPTS) {
      await this.dbs.db.transaction(async (tx) => {
        await tx.insert(opsJobsDeadletter).values({
          queue: OUTBOX_DLQ_QUEUE,
          jobId: `outbox__${row.id}`,
          jobName: row.eventType,
          payload: { outbox_id: row.id, outbox_created_at: row.createdAt.toISOString(), aggregate_type: row.aggregateType, aggregate_id: row.aggregateId, event_type: row.eventType, payload: row.payload, consumers: pending, errors: Object.fromEntries(failed.map((f) => [f.consumer, f.error])) },
          error: lastError,
          attempts,
        });
        await tx.update(opsOutbox).set({ attempts, lastError, pendingConsumers: pending, nextAttemptAt: null, deadLetteredAt: new Date() }).where(eq(opsOutbox.id, row.id));
      });
      OUTBOX_METRICS.events.inc({ event_type: row.eventType, result: 'dead_letter' });
      this.logger.error({ id: row.id, event_type: row.eventType, attempts, consumers: pending }, 'outbox event dead-lettered');
      return { status: 'dead_letter', delivered, failed, attempts };
    }
    const delay = outboxBackoffSeconds(attempts, this.env.OUTBOX_RETRY_BASE_SECONDS, this.env.OUTBOX_RETRY_MAX_SECONDS);
    await this.dbs.db
      .update(opsOutbox)
      .set({ attempts, lastError, pendingConsumers: pending, nextAttemptAt: sql`now() + make_interval(secs => ${delay})` })
      .where(eq(opsOutbox.id, row.id));
    OUTBOX_METRICS.events.inc({ event_type: row.eventType, result: 'retry' });
    return { status: 'retry', delivered, failed, attempts };
  }

  /**
   * Admin replay một dead-letter của outbox: mở lại sự kiện (attempts = 0, chỉ các consumer còn lỗi) và giao NGAY trong process
   * gọi. Đã giao rồi → `already_delivered` (không chạy lại). Hàng outbox đã bị dọn → giao từ bản chụp trong dead-letter.
   * Lỗi lại → sự kiện vào vòng thử lại mới (worker), quá hạn → dead-letter mới.
   */
  async replayDeadLetter(dl: { payload: unknown }): Promise<OutboxDeliveryResult> {
    const p = (dl.payload ?? {}) as { outbox_id?: number | string; outbox_created_at?: string; aggregate_type?: string; aggregate_id?: string | null; event_type?: string; payload?: Record<string, unknown>; consumers?: string[] };
    const outboxId = Number(p.outbox_id);
    if (!Number.isFinite(outboxId) || !p.event_type) throw new Error('dead-letter payload is not an outbox event');
    const consumers = Array.isArray(p.consumers) && p.consumers.length ? p.consumers : null;
    const reopened = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(opsOutbox)
        .where(eq(opsOutbox.id, outboxId))
        .limit(1)
        .for('update');
      if (!row) return { kind: 'missing' as const };
      if (row.publishedAt) return { kind: 'published' as const, row };
      const [after] = await tx
        .update(opsOutbox)
        .set({ attempts: 0, deadLetteredAt: null, pendingConsumers: consumers ?? row.pendingConsumers, nextAttemptAt: sql`now() + make_interval(secs => ${this.env.OUTBOX_LEASE_SECONDS})` })
        .where(eq(opsOutbox.id, row.id))
        .returning();
      return { kind: 'reopened' as const, row: after! };
    });
    if (reopened.kind === 'published') return { status: 'already_delivered', delivered: [], failed: [], attempts: reopened.row.attempts };
    if (reopened.kind === 'reopened') return this.process(reopened.row);
    // Hàng outbox không còn (dọn dữ liệu) → giao từ bản chụp, không ghi trạng thái outbox
    const ev: OutboxEvent = { id: outboxId, aggregate_type: p.aggregate_type ?? 'unknown', aggregate_id: p.aggregate_id ?? null, event_type: p.event_type, payload: p.payload ?? {}, created_at: p.outbox_created_at ? new Date(p.outbox_created_at) : new Date() };
    const r = await this.deliver(ev, consumers);
    return { status: r.failed.length ? 'retry' : 'delivered', delivered: r.delivered, failed: r.failed, attempts: 0 };
  }

  /** Trạng thái hàng outbox cho admin/metrics: chờ giao, đang thử lại, dead-letter */
  async backlog(): Promise<{ unpublished: number; retrying: number; dead_lettered: number; oldest_unpublished_sec: number | null }> {
    const [r] = (await this.dbs.db.execute(sql`
      select count(*) filter (where dead_lettered_at is null)::int as unpublished,
             count(*) filter (where dead_lettered_at is null and attempts > 0)::int as retrying,
             count(*) filter (where dead_lettered_at is not null)::int as dead_lettered,
             extract(epoch from now() - min(created_at) filter (where dead_lettered_at is null))::float8 as oldest
      from ops.outbox where published_at is null`)) as unknown as Array<{ unpublished: number; retrying: number; dead_lettered: number; oldest: number | null }>;
    return { unpublished: r?.unpublished ?? 0, retrying: r?.retrying ?? 0, dead_lettered: r?.dead_lettered ?? 0, oldest_unpublished_sec: r?.oldest === null || r?.oldest === undefined ? null : Math.round(Number(r.oldest)) };
  }

  /** S12 – retention: xoá sự kiện đã relay (published_at) cũ hơn `before` theo lô */
  async purgePublished(before: Date, batch: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const r = (await this.dbs.db.execute(sql`delete from ops.outbox where (id, created_at) in (select id, created_at from ops.outbox where published_at is not null and created_at < ${before.toISOString()}::timestamptz limit ${batch}) returning 1`)) as unknown as unknown[];
      total += r.length;
      if (r.length < batch) break;
    }
    return total;
  }

  /** Phát ngay sau commit (không qua relay) cho các consumer cùng process cần phản hồi nhanh (realtime, XP). Relay vẫn chạy để consumer ngoài process nhận. */
  emitLocal(eventType: string, payload: Record<string, unknown>): void {
    this.emitter.emit(`local.${eventType}`, payload);
  }
}

@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 }), DiscoveryModule],
  providers: [OutboxService, AuditService, PersonalDataRegistry, UserDirectory],
  exports: [OutboxService, AuditService, PersonalDataRegistry, UserDirectory, EventEmitterModule],
})
export class EventsModule {}
