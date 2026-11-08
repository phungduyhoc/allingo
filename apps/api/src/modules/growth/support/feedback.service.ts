import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, type FeedbackInput } from '@allingo/schemas';
import type { AuthUser } from '../../../shared/auth/auth.guard.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { StorageService } from '../../../shared/storage/storage.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { GROWTH_METRICS } from '../../../shared/telemetry/metrics.js';
import { MediaAssetsService } from '../../speech/index.js';

const { opsFeedback } = schema;

interface FeedbackContext {
  trace_id?: string;
  request_trace_id?: string | null;
  screenshot_media_id?: string | null;
  user_agent?: string | null;
  app_version?: string | null;
  locale?: string | null;
}

/**
 * Góp ý in-app (S12) → ops.feedback: ảnh màn hình qua /uploads/presign kind=image (bucket recordings – riêng tư, của chính người
 * gọi), trace_id tự gắn (trace của request nếu client không gửi), ngữ cảnh kỹ thuật tối thiểu (không email/IP). Admin xem với URL
 * ảnh ký 10 phút. Nội dung góp ý KHÔNG ghi log.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = getLogger({ component: 'growth.feedback' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly media: MediaAssetsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(user: AuthUser, input: FeedbackInput, meta: { traceId: string; userAgent?: string | null; locale?: string | null }) {
    let screenshot: string | null = null;
    if (input.screenshot_upload_id) {
      const asset = await this.media.getRow(input.screenshot_upload_id).catch(() => null);
      if (!asset) throw new NotFound('upload', input.screenshot_upload_id);
      if (asset.kind !== 'image' || asset.createdBy !== user.id) throw new ValidationFailed({ issues: [{ path: 'screenshot_upload_id', code: 'invalid_upload', message: 'screenshot must be an image uploaded by you' }] });
      screenshot = asset.id;
      // Chuẩn hoá ảnh (webp + thumbnail) – lỗi (chưa PUT xong…) không chặn góp ý
      void this.media.requestProcessing(asset.id).catch((err: Error) => this.logger.warn({ err: err.message.slice(0, 120) }, 'screenshot processing deferred'));
    }
    const context: FeedbackContext = { trace_id: input.trace_id ?? meta.traceId, request_trace_id: meta.traceId, screenshot_media_id: screenshot, user_agent: meta.userAgent?.slice(0, 200) ?? null, app_version: input.app_version ?? null, locale: meta.locale ?? null };
    const [row] = await this.dbs.db.insert(opsFeedback).values({ userId: user.id, kind: input.category, body: input.message, page: input.page_url ?? null, context, status: 'new', createdAt: new Date(this.clock.now()) }).returning();
    await this.outbox.write(this.dbs.db, { aggregateType: 'feedback', aggregateId: row!.id, eventType: DOMAIN_EVENTS.FEEDBACK_SUBMITTED, payload: { feedback_id: row!.id, user_id: user.id, category: input.category, has_screenshot: !!screenshot } });
    GROWTH_METRICS.feedback.inc({ kind: `feedback_${input.category}` });
    return { id: row!.id, status: 'new' as const, trace_id: context.trace_id!, created_at: row!.createdAt.toISOString() };
  }

  private async screenshotView(id: string | null | undefined) {
    if (!id) return null;
    try {
      const v = await this.media.view(id);
      if (v.url) return { media_asset_id: id, url: v.url, url_expires_at: v.url_expires_at };
      const row = await this.media.getRow(id);
      if (!row.storageKey) return { media_asset_id: id, url: null, url_expires_at: null };
      const ttl = this.storage.defaultTtlSec;
      return { media_asset_id: id, url: await this.storage.presignGet('recordings', row.storageKey, ttl), url_expires_at: new Date(Date.now() + ttl * 1000).toISOString() };
    } catch {
      return { media_asset_id: id, url: null, url_expires_at: null };
    }
  }

  private async dto(r: typeof opsFeedback.$inferSelect) {
    const ctx = (r.context ?? {}) as FeedbackContext;
    return { id: r.id, user_id: r.userId ?? null, category: r.kind, message: r.body, page_url: r.page ?? null, trace_id: ctx.trace_id ?? null, screenshot: await this.screenshotView(ctx.screenshot_media_id), context: { request_trace_id: ctx.request_trace_id ?? null, user_agent: ctx.user_agent ?? null, app_version: ctx.app_version ?? null, locale: ctx.locale ?? null }, status: r.status, created_at: r.createdAt.toISOString() };
  }

  async list(q: { status?: string; category?: string; cursor?: string; limit: number }) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(opsFeedback.status, q.status));
    if (q.category) conds.push(eq(opsFeedback.kind, q.category));
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${opsFeedback.createdAt}, ${opsFeedback.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(opsFeedback).where(conds.length ? and(...conds) : undefined).orderBy(desc(opsFeedback.createdAt), desc(opsFeedback.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: await Promise.all(page.map((r) => this.dto(r))), next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null };
  }

  async setStatus(actor: AuthUser, id: string, status: string) {
    const [before] = await this.dbs.db.select().from(opsFeedback).where(eq(opsFeedback.id, id)).limit(1);
    if (!before) throw new NotFound('feedback', id);
    const [row] = await this.dbs.db.update(opsFeedback).set({ status }).where(eq(opsFeedback.id, id)).returning();
    await this.audit.log({ action: 'feedback.update', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'feedback', entityId: id, before: { status: before.status }, after: { status } });
    return this.dto(row!);
  }
}
