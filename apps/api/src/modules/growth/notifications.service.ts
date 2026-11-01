import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { AdminTestNotificationInput, AdminTestNotificationResult, NotificationPreferences, NotificationPreferencesPatch, PushPayload, PushSubscriptionInput, PushSubscriptionView } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { PersonalDataRegistry } from '../../shared/events/personal-data.registry.js';
import { FeatureDisabled, NotFound } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { UsersService } from '../iam/index.js';
import { PUSH_SENDER, type PushSender } from './push/push-sender.js';

const { opsNotificationPreferences, opsPushSubscriptions, opsNotifications } = schema;
type SubRow = typeof opsPushSubscriptions.$inferSelect;

/** Mặc định theo DDL ops.notification_preferences */
export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'updated_at' | 'push_subscriptions'> = {
  channels: { email: true, push: true, zalo: false, inapp: true },
  quiet_hours: { start: '22:00', end: '07:00' },
  reminder_times: ['20:00'],
};

const originOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'invalid';
  }
};

/**
 * Thông báo (growth, S6): tuỳ chọn kênh/khung giờ (`ops.notification_preferences`), đăng ký Web Push theo thiết bị
 * (`ops.push_subscriptions`, VAPID), gửi thử từ admin (`ops.notifications` channel push). Endpoint 404/410 → xoá đăng ký.
 * Lịch nhắc tự động ở S9. Dữ liệu cá nhân: purger xoá đăng ký + tuỳ chọn khi xoá tài khoản.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'growth.notifications' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly personalData: PersonalDataRegistry,
  ) {}

  onModuleInit(): void {
    this.personalData.register('growth.push', async (userId) => {
      const subs = await this.dbs.db.delete(opsPushSubscriptions).where(eq(opsPushSubscriptions.userId, userId)).returning({ id: opsPushSubscriptions.id });
      const prefs = await this.dbs.db.delete(opsNotificationPreferences).where(eq(opsNotificationPreferences.userId, userId)).returning({ id: opsNotificationPreferences.userId });
      return subs.length + prefs.length;
    });
  }

  /** Push bật khi có khoá VAPID (hoặc sender memory ở test) */
  get pushEnabled(): boolean {
    return !!this.sender;
  }

  vapidPublicKey(): { public_key: string | null; enabled: boolean } {
    return { public_key: this.env.VAPID_PUBLIC_KEY ?? null, enabled: this.pushEnabled };
  }

  // ------------------------------------------------------------------ tuỳ chọn
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const [row] = await this.dbs.db.select().from(opsNotificationPreferences).where(eq(opsNotificationPreferences.userId, userId)).limit(1);
    const [cnt] = await this.dbs.db.select({ n: sql<number>`count(*)::int` }).from(opsPushSubscriptions).where(eq(opsPushSubscriptions.userId, userId));
    if (!row) return { ...DEFAULT_PREFERENCES, push_subscriptions: cnt?.n ?? 0 };
    return {
      channels: { ...DEFAULT_PREFERENCES.channels, ...((row.channels as Record<string, boolean>) ?? {}) },
      quiet_hours: (row.quietHours as NotificationPreferences['quiet_hours']) ?? DEFAULT_PREFERENCES.quiet_hours,
      reminder_times: row.reminderTimes ?? DEFAULT_PREFERENCES.reminder_times,
      updated_at: row.updatedAt.toISOString(),
      push_subscriptions: cnt?.n ?? 0,
    };
  }

  async updatePreferences(userId: string, patch: NotificationPreferencesPatch): Promise<NotificationPreferences> {
    const cur = await this.getPreferences(userId);
    const channels = { ...cur.channels, ...(patch.channels ?? {}) };
    const quietHours = patch.quiet_hours ?? cur.quiet_hours;
    const reminderTimes = patch.reminder_times ? [...new Set(patch.reminder_times)].sort() : cur.reminder_times;
    await this.dbs.db
      .insert(opsNotificationPreferences)
      .values({ userId, channels, quietHours, reminderTimes, updatedAt: new Date() })
      .onConflictDoUpdate({ target: opsNotificationPreferences.userId, set: { channels, quietHours, reminderTimes, updatedAt: new Date() } });
    return this.getPreferences(userId);
  }

  // ------------------------------------------------------------------ đăng ký push
  private toView(r: SubRow, created?: boolean): PushSubscriptionView {
    return { id: r.id, endpoint_origin: originOf(r.endpoint), user_agent: r.userAgent ?? null, locale: r.locale ?? null, created_at: r.createdAt.toISOString(), last_success_at: r.lastSuccessAt?.toISOString() ?? null, expires_at: r.expiresAt?.toISOString() ?? null, ...(created === undefined ? {} : { created }) };
  }

  async listSubscriptions(userId: string): Promise<PushSubscriptionView[]> {
    const rows = await this.dbs.db.select().from(opsPushSubscriptions).where(eq(opsPushSubscriptions.userId, userId)).orderBy(desc(opsPushSubscriptions.createdAt));
    return rows.map((r) => this.toView(r));
  }

  /** Idempotent theo endpoint: đã có → cập nhật khoá/người dùng (thiết bị đổi tài khoản), created=false */
  async subscribe(userId: string, input: PushSubscriptionInput): Promise<PushSubscriptionView> {
    if (!this.pushEnabled) throw new FeatureDisabled('push');
    const values = {
      userId,
      endpoint: input.endpoint,
      p256Dh: input.keys.p256dh,
      auth: input.keys.auth,
      expiresAt: input.expirationTime ? new Date(input.expirationTime) : null,
      userAgent: input.user_agent?.slice(0, 300) ?? null,
      locale: input.locale ?? null,
    };
    const [existing] = await this.dbs.db.select({ id: opsPushSubscriptions.id }).from(opsPushSubscriptions).where(eq(opsPushSubscriptions.endpoint, input.endpoint)).limit(1);
    const [row] = await this.dbs.db
      .insert(opsPushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: opsPushSubscriptions.endpoint, set: { userId, p256Dh: values.p256Dh, auth: values.auth, expiresAt: values.expiresAt, userAgent: values.userAgent, locale: values.locale, failureCount: 0 } })
      .returning();
    return this.toView(row!, !existing);
  }

  async unsubscribe(userId: string, subscriptionId: string): Promise<void> {
    const r = await this.dbs.db.delete(opsPushSubscriptions).where(and(eq(opsPushSubscriptions.id, subscriptionId), eq(opsPushSubscriptions.userId, userId))).returning({ id: opsPushSubscriptions.id });
    if (!r.length) throw new NotFound('push_subscription', subscriptionId);
  }

  // ------------------------------------------------------------------ gửi
  /**
   * Gửi thông báo đẩy tới mọi thiết bị của người dùng; ghi ops.notifications (status sent | failed). Endpoint 404/410 → xoá đăng ký;
   * lỗi khác tăng failure_count. Người nhận tắt channels.push → skipped (trừ `force`).
   */
  async sendPush(userId: string, input: AdminTestNotificationInput): Promise<AdminTestNotificationResult> {
    if (!this.sender) throw new FeatureDisabled('push');
    const user = await this.users.findById(userId);
    if (!user) throw new NotFound('user', userId);
    const prefs = await this.getPreferences(userId);
    if (prefs.channels.push === false && !input.force) return { notification_id: null, user_id: userId, status: 'skipped', reason: 'push_disabled', sent: 0, failed: 0, removed: 0, results: [] };
    const subs = await this.dbs.db.select().from(opsPushSubscriptions).where(eq(opsPushSubscriptions.userId, userId));
    if (!subs.length) return { notification_id: null, user_id: userId, status: 'skipped', reason: 'no_subscriptions', sent: 0, failed: 0, removed: 0, results: [] };

    const [n] = await this.dbs.db
      .insert(opsNotifications)
      .values({ userId, channel: 'push', templateCode: input.template_code, payload: { title: input.title ?? null, body: input.body ?? null, url: input.url, test: true }, status: 'scheduled' })
      .returning({ id: opsNotifications.id });
    const notificationId = n!.id;
    const payload: PushPayload = { v: 1, notification_id: notificationId, template_code: input.template_code, title: input.title ?? null, body: input.body ?? null, url: input.url, tag: `allingo-${input.template_code}`, locale: user.uiLocale ?? 'vi', sent_at: new Date().toISOString() };
    const body = JSON.stringify(payload);
    const results: AdminTestNotificationResult['results'] = [];
    for (const s of subs) {
      const r = await this.sender.send({ endpoint: s.endpoint, p256dh: s.p256Dh, auth: s.auth }, body, { ttlSeconds: this.env.PUSH_TTL_SECONDS, topic: input.template_code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32), urgency: 'normal' });
      if (r.ok) await this.dbs.db.update(opsPushSubscriptions).set({ lastSuccessAt: new Date(), failureCount: 0 }).where(eq(opsPushSubscriptions.id, s.id));
      else if (r.gone) await this.dbs.db.delete(opsPushSubscriptions).where(eq(opsPushSubscriptions.id, s.id));
      else await this.dbs.db.update(opsPushSubscriptions).set({ failureCount: sql`least(${opsPushSubscriptions.failureCount} + 1, 32000)` }).where(eq(opsPushSubscriptions.id, s.id));
      results.push({ subscription_id: s.id, ok: r.ok, status_code: r.statusCode, removed: r.gone });
    }
    const sent = results.filter((r) => r.ok).length;
    const removed = results.filter((r) => r.removed).length;
    const failed = results.length - sent;
    const status = sent > 0 ? 'sent' : 'failed';
    await this.dbs.db
      .update(opsNotifications)
      .set({ status, sentAt: sent > 0 ? new Date() : null, error: failed ? `${failed} failed (${removed} removed)` : null })
      .where(eq(opsNotifications.id, notificationId));
    // Không log endpoint/khoá (định danh thiết bị); chỉ số đếm
    this.logger.info({ notification_id: notificationId, sent, failed, removed, sender: this.sender.kind }, 'push notification sent');
    return { notification_id: notificationId, user_id: userId, status, reason: sent > 0 ? null : 'all_failed', sent, failed, removed, results };
  }
}
