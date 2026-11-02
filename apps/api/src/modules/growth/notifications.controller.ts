import { Controller, Delete, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  cursorQuerySchema,
  notificationItemSchema,
  adminTestNotificationInputSchema,
  adminTestNotificationResultSchema,
  notificationPreferencesPatchSchema,
  notificationPreferencesSchema,
  pageSchema,
  pushSubscriptionInputSchema,
  pushSubscriptionSchema,
  vapidPublicKeySchema,
  type AdminTestNotificationInput,
  type NotificationPreferencesPatch,
  type PushSubscriptionInput,
} from '@allingo/schemas';
import { CurrentUser, Public, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { NotificationsService } from './notifications.service.js';

const subParam = z.object({ subscriptionId: z.uuid() });

/** Tuỳ chọn thông báo + đăng ký Web Push của người dùng (S6) */
@ApiTags('Growth')
@Controller('me')
export class MeNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notification-preferences')
  @ApiZod({ responses: { 200: notificationPreferencesSchema } })
  get(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Patch('notification-preferences')
  @ApiZod({ body: notificationPreferencesPatchSchema, responses: { 200: notificationPreferencesSchema, 400: 'empty' } })
  patch(@CurrentUser() user: AuthUser, @ZodBody(notificationPreferencesPatchSchema) body: NotificationPreferencesPatch) {
    return this.notifications.updatePreferences(user.id, body);
  }

  /** Thông báo in-app (S7: billing – nhắc gia hạn 7/3/1 ngày, hết hạn, đã thanh toán); web dịch theo `template_code` */
  @Get('notifications')
  @ApiZod({ query: cursorQuerySchema, responses: { 200: pageSchema(notificationItemSchema) } })
  inbox(@CurrentUser() user: AuthUser, @ZodQuery(cursorQuerySchema) q: z.infer<typeof cursorQuerySchema>) {
    return this.notifications.listInApp(user.id, q.cursor, q.limit);
  }

  @Get('push-subscriptions')
  @ApiZod({ responses: { 200: pageSchema(pushSubscriptionSchema) } })
  async list(@CurrentUser() user: AuthUser) {
    return { data: await this.notifications.listSubscriptions(user.id), next_cursor: null };
  }

  /** 201 mới, 200 đã có (cùng endpoint); push chưa cấu hình → 503 feature_disabled */
  @Post('push-subscriptions')
  @HttpCode(201)
  @ApiZod({ body: pushSubscriptionInputSchema, responses: { 200: pushSubscriptionSchema, 201: pushSubscriptionSchema, 400: 'empty', 503: 'empty' } })
  async subscribe(@CurrentUser() user: AuthUser, @ZodBody(pushSubscriptionInputSchema) body: PushSubscriptionInput, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.notifications.subscribe(user.id, body);
    if (r.created === false) void reply.status(200);
    return r;
  }

  @Delete('push-subscriptions/:subscriptionId')
  @HttpCode(204)
  @ApiZod({ responses: { 204: 'empty', 404: 'empty' } })
  async unsubscribe(@CurrentUser() user: AuthUser, @ZodParams(subParam) p: z.infer<typeof subParam>) {
    await this.notifications.unsubscribe(user.id, p.subscriptionId);
  }
}

/** Khoá công khai VAPID (không cần đăng nhập) */
@ApiTags('Growth')
@Controller('push')
export class PushPublicController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @Get('vapid-public-key')
  @ApiZod({ responses: { 200: vapidPublicKeySchema } })
  key() {
    return this.notifications.vapidPublicKey();
  }
}

/** Admin gửi thử "Đến giờ học" (S6; lịch tự động ở S9) */
@ApiTags('Admin')
@Controller('admin/notifications')
@Roles('admin', 'superadmin')
export class AdminNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Post('test')
  @HttpCode(200)
  @ApiZod({ body: adminTestNotificationInputSchema, responses: { 200: adminTestNotificationResultSchema, 404: 'empty', 503: 'empty' } })
  async test(@CurrentUser() actor: AuthUser, @ZodBody(adminTestNotificationInputSchema) body: AdminTestNotificationInput) {
    const target = body.user_id ?? actor.id;
    const r = await this.notifications.sendPush(target, body);
    await this.audit.log({ actorUserId: actor.id, actorRole: 'admin', action: 'notification.test_push', entityType: 'user', entityId: target, after: { template_code: body.template_code, status: r.status, sent: r.sent, failed: r.failed, removed: r.removed } });
    return r;
  }
}
