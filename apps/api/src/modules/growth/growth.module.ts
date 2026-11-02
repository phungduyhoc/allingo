import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { IamModule } from '../iam/index.js';
import { AdminNotificationsController, MeNotificationsController, PushPublicController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { BillingNotificationsListener } from './billing-notifications.listener.js';
import { MemoryPushSender, PUSH_SENDER, WebPushSender, type PushSender } from './push/push-sender.js';

/**
 * Chọn sender Web Push: PUSH_SENDER=memory → giả (test); webpush/auto + đủ VAPID → web-push; thiếu khoá → null (push tắt,
 * POST /me/push-subscriptions 503). production thiếu khoá với PUSH_SENDER=webpush → lỗi khởi động.
 */
export function createPushSender(env: Env): PushSender | null {
  if (env.PUSH_SENDER === 'memory') return new MemoryPushSender();
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return new WebPushSender({ subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
  if (env.PUSH_SENDER === 'webpush' && env.APP_ENV === 'production') throw new Error('PUSH_SENDER=webpush requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
  getLogger({ component: 'growth.push' }).warn('VAPID keys missing → Web Push disabled (run: pnpm --filter @allingo/api push:vapid)');
  return null;
}

/** growth: thông báo & Web Push (S6), thông báo billing in-app (S7: hết hạn/nhắc gia hạn/đã thanh toán); referral/khuyến mãi ở S8 – xem README.md */
@Module({
  imports: [IamModule],
  controllers: [MeNotificationsController, PushPublicController, AdminNotificationsController],
  providers: [NotificationsService, BillingNotificationsListener, { provide: PUSH_SENDER, inject: [ENV], useFactory: createPushSender }],
  exports: [NotificationsService, PUSH_SENDER],
})
export class GrowthModule {}
