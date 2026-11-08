import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { NOTIFICATION_REALTIME_EVENT, type DeliveryChannel, type NotificationCategory, type NotificationManage, type PushPayload } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { MailerService, type MailAttachment } from '../../../shared/notify/mailer.service.js';
import { RealtimeGateway } from '../../../shared/realtime/realtime.gateway.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { UsersService } from '../../iam/index.js';
import { NotificationsService } from '../notifications.service.js';
import { ValidationFailed } from '../../../shared/http/errors.js';
import { decideDelivery, makeUnsubscribeToken, renderNotification, unsubscribeSecret, verifyUnsubscribeToken, vnMinuteOfDay, type DeliveryCounts, type RenderedNotification, type UnsubscribeScope } from './renderer.js';
import { templateFor, type TemplateDef } from './templates.js';

const { opsNotifications } = schema;

export interface SendOptions {
  /** Ghi đè kênh mặc định của mẫu */
  channels?: DeliveryChannel[];
  /** Chống trùng theo (người dùng, mẫu, kênh, dedupe_key) – sự kiện local + outbox cùng tới chỉ tạo một lần */
  dedupeKey?: string;
  /** Người nhận email khác email tài khoản (vd email người mua trên hoá đơn) – không lưu vào payload */
  emailTo?: string | null;
  attachments?: MailAttachment[];
  /** Bỏ qua tuỳ chọn/giới hạn (admin gửi thử) */
  force?: boolean;
  now?: Date;
}

export interface ChannelResult {
  channel: DeliveryChannel;
  status: 'sent' | 'scheduled' | 'skipped' | 'failed' | 'duplicate';
  reason?: string;
  notification_id?: string;
}

/**
 * NotificationService (Sprint 8): `send(userId, template, data, channels?)` – mẫu Handlebars vi/en trong repo, kênh email (SMTP/
 * Mailpit dev, Resend/SES adapter), web push (S6), in-app (ops.notifications + Socket.IO `notification.new`). Tuỳ chọn theo loại
 * (learning/billing/marketing) × kênh, giờ yên lặng (giờ VN – push hoãn hoặc bỏ theo mẫu), tần suất (≤ 1 email marketing/tuần,
 * ≤ 2 push không giao dịch/ngày), link huỷ đăng ký ký HMAC + List-Unsubscribe (RFC 8058). Mỗi kênh một hàng ops.notifications
 * (sent | scheduled | failed | cancelled = bỏ qua có lý do). Không log email/nội dung (CLAUDE.md §9).
 */
@Injectable()
export class NotificationService {
  private readonly logger = getLogger({ component: 'growth.notify' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly prefs: NotificationsService,
    private readonly mailer: MailerService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private secret(): string {
    return unsubscribeSecret(this.env);
  }

  unsubscribeUrl(userId: string, category: NotificationCategory | 'all'): string {
    return `${this.env.API_PUBLIC_URL.replace(/\/+$/, '')}/v1/notifications/unsubscribe?token=${encodeURIComponent(makeUnsubscribeToken(this.secret(), userId, category))}`;
  }

  manageUrl(userId: string): string {
    return `${this.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/notifications/manage?token=${encodeURIComponent(makeUnsubscribeToken(this.secret(), userId, 'all'))}`;
  }

  render(def: TemplateDef, userId: string, locale: string, data: Record<string, unknown>): RenderedNotification {
    return renderNotification(def, locale, data, { appUrl: this.env.WEB_PUBLIC_URL, manageUrl: this.manageUrl(userId), unsubscribeUrl: def.category === 'system' ? null : this.unsubscribeUrl(userId, def.category) });
  }

  /** Đếm cho giới hạn tần suất: email marketing 7 ngày, push không giao dịch trong ngày (giờ VN) */
  private async counts(userId: string, now: Date): Promise<DeliveryCounts> {
    const dayStart = new Date(now.getTime() - vnMinuteOfDay(now) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
    const [r] = await this.dbs.db.execute<{ marketing: number; pushes: number }>(sql`
      select
        count(*) filter (where channel = 'email' and payload->>'category' = 'marketing' and sent_at >= ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz)::int as marketing,
        count(*) filter (where channel = 'push' and coalesce((payload->>'transactional')::boolean, false) = false and sent_at >= ${dayStart.toISOString()}::timestamptz)::int as pushes
      from ops.notifications where user_id = ${userId} and status in ('sent','read') and sent_at >= ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz`);
    return { marketingEmails7d: r?.marketing ?? 0, pushesToday: r?.pushes ?? 0 };
  }

  async send(userId: string, templateCode: string, data: Record<string, unknown>, opts: SendOptions = {}): Promise<{ results: ChannelResult[] }> {
    const def = templateFor(templateCode);
    if (!def) throw new Error(`Unknown notification template ${templateCode}`);
    const now = opts.now ?? new Date(this.clock.now());
    const user = await this.users.findById(userId);
    const channels = opts.channels ?? def.channels;
    if (!user || user.status !== 'active') return { results: channels.map((channel) => ({ channel, status: 'skipped' as const, reason: 'user_inactive' })) };
    const prefs = await this.prefs.getPreferences(userId);
    const rendered = this.render(def, userId, user.uiLocale, data);
    const counts = await this.counts(userId, now);
    const results: ChannelResult[] = [];
    for (const channel of channels) {
      const r = await this.dbs.db.transaction(async (tx) => {
        // Khoá theo (người dùng, mẫu, kênh, dedupe) – local + outbox relay đồng thời không tạo 2 hàng
        if (opts.dedupeKey) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`notify:${userId}:${templateCode}:${channel}:${opts.dedupeKey}`}))`);
        if (opts.dedupeKey) {
          const [hit] = await tx
            .select({ id: opsNotifications.id })
            .from(opsNotifications)
            .where(and(eq(opsNotifications.userId, userId), eq(opsNotifications.templateCode, templateCode), eq(opsNotifications.channel, channel), sql`${opsNotifications.payload} ? 'dedupe_key'`, sql`${opsNotifications.payload}->>'dedupe_key' = ${opts.dedupeKey}`))
            .limit(1);
          if (hit) return { result: { channel, status: 'duplicate' as const, notification_id: hit.id }, row: null };
        }
        let decision = decideDelivery({ channel, category: def.category, transactional: def.transactional, quietPolicy: def.quietHours, prefs: { channels: prefs.channels, categories: prefs.categories!, quiet_hours: prefs.quiet_hours }, counts, now, force: opts.force });
        if (decision.action === 'send' && channel === 'email' && !(opts.emailTo ?? user.email)) decision = { action: 'skip', reason: 'channel_disabled' };
        if (decision.action === 'send' && channel === 'push' && (!this.prefs.pushEnabled || !(await this.prefs.subscriptionCount(userId)))) {
          // Không có thiết bị nhận push (phổ biến) – không ghi hàng
          return { result: { channel, status: 'skipped' as const, reason: 'no_subscriptions' }, row: null };
        }
        const status = decision.action === 'send' ? (channel === 'inapp' ? 'sent' : 'scheduled') : decision.action === 'defer' ? 'scheduled' : 'cancelled';
        const [row] = await tx
          .insert(opsNotifications)
          .values({ userId, channel, templateCode, payload: this.payloadFor(def, rendered, data, opts.dedupeKey, channel), status, scheduledAt: decision.action === 'defer' ? decision.at : now, sentAt: channel === 'inapp' && decision.action === 'send' ? now : null, error: decision.action === 'skip' ? `skipped:${decision.reason}` : null })
          .returning();
        if (decision.action === 'skip') return { result: { channel, status: 'skipped' as const, reason: decision.reason, notification_id: row!.id }, row: null };
        if (decision.action === 'defer') return { result: { channel, status: 'scheduled' as const, reason: decision.reason, notification_id: row!.id }, row: null };
        return { result: { channel, status: 'sent' as const, notification_id: row!.id }, row: row! };
      });
      if (r.row) {
        const delivered = await this.deliver(r.row, def, rendered, user.email, opts);
        results.push({ ...r.result, status: delivered.ok ? 'sent' : 'failed', ...(delivered.ok ? {} : { reason: delivered.reason }) });
        if (delivered.ok && channel === 'push') counts.pushesToday += def.transactional ? 0 : 1;
        if (delivered.ok && channel === 'email' && def.category === 'marketing') counts.marketingEmails7d++;
      } else results.push(r.result);
    }
    this.logger.info({ template: templateCode, results: results.map((x) => `${x.channel}:${x.status}${x.reason ? `(${x.reason})` : ''}`).join(',') }, 'notification');
    return { results };
  }

  private payloadFor(def: TemplateDef, rendered: RenderedNotification, data: Record<string, unknown>, dedupeKey: string | undefined, channel: DeliveryChannel): Record<string, unknown> {
    const title = channel === 'push' ? rendered.push.title : channel === 'email' ? rendered.subject : rendered.inapp.title;
    const body = channel === 'push' ? rendered.push.body : channel === 'email' ? null : rendered.inapp.body;
    return { ...data, ...(dedupeKey ? { dedupe_key: dedupeKey } : {}), category: def.category, transactional: def.transactional, locale: rendered.locale, title, body, url: rendered.url, data };
  }

  /** Giao một hàng đã quyết định gửi; cập nhật trạng thái sent/failed */
  private async deliver(row: typeof opsNotifications.$inferSelect, def: TemplateDef, rendered: RenderedNotification, accountEmail: string | null, opts: SendOptions): Promise<{ ok: boolean; reason?: string }> {
    const now = opts.now ?? new Date(this.clock.now());
    if (row.channel === 'inapp') {
      this.realtime.emitToUser(row.userId, NOTIFICATION_REALTIME_EVENT, this.prefs.toItem(row));
      return { ok: true };
    }
    if (row.channel === 'email') {
      const to = opts.emailTo ?? accountEmail;
      if (!to) return this.fail(row.id, 'no_email');
      const headers: Record<string, string> = {};
      if (!def.transactional && def.category !== 'system') {
        const u = this.unsubscribeUrl(row.userId, def.category);
        headers['List-Unsubscribe'] = `<${u}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }
      const r = await this.mailer.send({ to, subject: rendered.subject, text: rendered.text, html: rendered.html, attachments: opts.attachments, headers, tags: { template: def.code.replace(/\./g, '_'), category: def.category } });
      if (!r.delivered) return this.fail(row.id, r.error ?? 'smtp_failed');
      await this.dbs.db.update(opsNotifications).set({ status: 'sent', sentAt: now, error: null }).where(eq(opsNotifications.id, row.id));
      return { ok: true };
    }
    if (row.channel === 'push') {
      const payload: PushPayload = { v: 1, notification_id: row.id, template_code: def.code, title: rendered.push.title, body: rendered.push.body, url: rendered.url, tag: `allingo-${def.code}`, locale: rendered.locale, sent_at: now.toISOString() };
      try {
        const d = await this.prefs.pushToUser(row.userId, payload, { urgency: def.transactional ? 'high' : 'normal' });
        if (d.sent === 0) return this.fail(row.id, d.results.length ? 'all_failed' : 'no_subscriptions');
        await this.dbs.db.update(opsNotifications).set({ status: 'sent', sentAt: now, error: d.failed ? `${d.failed} failed (${d.removed} removed)` : null }).where(eq(opsNotifications.id, row.id));
        return { ok: true };
      } catch (err) {
        return this.fail(row.id, (err as Error).message.slice(0, 100));
      }
    }
    return this.fail(row.id, 'unsupported_channel');
  }

  private async fail(id: string, reason: string): Promise<{ ok: false; reason: string }> {
    await this.dbs.db.update(opsNotifications).set({ status: 'failed', error: reason.slice(0, 300) }).where(eq(opsNotifications.id, id));
    return { ok: false, reason };
  }

  /**
   * Job notification.dispatch (mỗi phút): hàng `scheduled` đến hạn (push/email hoãn vì giờ yên lặng) → đánh giá lại tuỳ chọn
   * hiện tại (tắt sau khi hẹn → huỷ) → giao. Không áp lại giờ yên lặng (đã hẹn đúng lúc kết thúc).
   */
  async dispatchDue(now: Date = new Date(this.clock.now())): Promise<{ sent: number; skipped: number; failed: number }> {
    const due = await this.dbs.db
      .select()
      .from(opsNotifications)
      .where(and(eq(opsNotifications.status, 'scheduled'), inArray(opsNotifications.channel, ['push', 'email']), lte(opsNotifications.scheduledAt, now), gte(opsNotifications.scheduledAt, new Date(now.getTime() - 2 * 86_400_000))))
      .limit(200);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of due) {
      // Giành quyền xử lý: scheduled → đang giao (nhiều replica)
      const [claimed] = await this.dbs.db.update(opsNotifications).set({ scheduledAt: now, error: 'dispatching' }).where(and(eq(opsNotifications.id, row.id), eq(opsNotifications.status, 'scheduled'), sql`coalesce(${opsNotifications.error}, '') <> 'dispatching'`)).returning();
      if (!claimed) continue;
      const def = templateFor(row.templateCode);
      const user = await this.users.findById(row.userId);
      if (!def || !user || user.status !== 'active') {
        await this.dbs.db.update(opsNotifications).set({ status: 'cancelled', error: 'skipped:user_inactive' }).where(eq(opsNotifications.id, row.id));
        skipped++;
        continue;
      }
      const prefs = await this.prefs.getPreferences(row.userId);
      const counts = await this.counts(row.userId, now);
      const decision = decideDelivery({ channel: row.channel as DeliveryChannel, category: def.category, transactional: def.transactional, quietPolicy: 'ignore', prefs: { channels: prefs.channels, categories: prefs.categories!, quiet_hours: prefs.quiet_hours }, counts, now });
      if (decision.action !== 'send') {
        await this.dbs.db.update(opsNotifications).set({ status: 'cancelled', error: `skipped:${decision.action === 'skip' ? decision.reason : 'quiet_hours'}` }).where(eq(opsNotifications.id, row.id));
        skipped++;
        continue;
      }
      const data = ((row.payload as Record<string, unknown>)?.data ?? {}) as Record<string, unknown>;
      const rendered = this.render(def, row.userId, user.uiLocale, data);
      const d = await this.deliver(claimed, def, rendered, user.email, { now });
      if (d.ok) sent++;
      else failed++;
    }
    if (due.length) this.logger.info({ due: due.length, sent, skipped, failed }, 'notification.dispatch');
    return { sent, skipped, failed };
  }

  // ------------------------------------------------------------------ huỷ đăng ký / quản lý bằng link ký
  private fromToken(token: string): { userId: string; scope: UnsubscribeScope } {
    const v = verifyUnsubscribeToken(this.secret(), token);
    if (!v) throw new ValidationFailed({ issues: [{ path: 'token', message: 'invalid or tampered token', code: 'invalid_token' }] });
    return v;
  }

  /** Che email: "ng***@gmail.com" */
  static maskEmail(email: string | null): string | null {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    return `${(local ?? '').slice(0, 2)}***@${domain}`;
  }

  /** POST /notifications/unsubscribe (one-click RFC 8058 hoặc nút trên trang quản lý): tắt email của loại (all = mọi loại) */
  /** S12 – retention: xoá thông báo đã xử lý (sent/read/cancelled/failed) cũ hơn `before` theo lô (đã hẹn giờ thì giữ) */
  async purgeBefore(before: Date, batch: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const r = (await this.dbs.db.execute(sql`delete from ops.notifications where id in (select id from ops.notifications where status in ('sent','read','cancelled','failed') and scheduled_at < ${before.toISOString()}::timestamptz limit ${batch}) returning 1`)) as unknown as unknown[];
      total += r.length;
      if (r.length < batch) break;
    }
    return total;
  }

  async unsubscribe(token: string): Promise<{ unsubscribed: true; category: UnsubscribeScope; channel: 'email' }> {
    const { userId, scope } = this.fromToken(token);
    const user = await this.users.findById(userId);
    if (!user) throw new ValidationFailed({ issues: [{ path: 'token', message: 'unknown user', code: 'invalid_token' }] });
    const off = { email: false };
    await this.prefs.updatePreferences(userId, { categories: scope === 'all' ? { learning: off, billing: off, marketing: off } : { [scope]: off } });
    this.logger.info({ scope }, 'email unsubscribed via signed link');
    return { unsubscribed: true, category: scope, channel: 'email' };
  }

  async manageGet(token: string): Promise<NotificationManage> {
    const { userId, scope } = this.fromToken(token);
    const user = await this.users.findById(userId);
    if (!user) throw new ValidationFailed({ issues: [{ path: 'token', message: 'unknown user', code: 'invalid_token' }] });
    const prefs = await this.prefs.getPreferences(userId);
    return { ...prefs, email_masked: NotificationService.maskEmail(user.email ?? null), token_category: scope };
  }

  async managePatch(token: string, patch: { categories?: Record<string, Record<string, boolean>>; channels?: { email?: boolean } }): Promise<NotificationManage> {
    const { userId } = this.fromToken(token);
    await this.prefs.updatePreferences(userId, { categories: patch.categories, ...(patch.channels ? { channels: patch.channels } : {}) });
    return this.manageGet(token);
  }
}
