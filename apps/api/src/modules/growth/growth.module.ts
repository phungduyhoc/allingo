import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { BillingModule } from '../billing/index.js';
import { IamModule } from '../iam/index.js';
import { LearningModule } from '../learning/index.js';
import { AdminNotificationsController, MeNotificationsController, NotificationLinksController, PushPublicController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { BillingNotificationsListener } from './billing-notifications.listener.js';
import { GrowthJobsService } from './growth-jobs.service.js';
import { LearningNotificationsListener } from './learning-notifications.listener.js';
import { StudyRemindersService } from './study-reminders.service.js';
import { NotificationService } from './notify/notification.service.js';
import { MemoryPushSender, PUSH_SENDER, WebPushSender, type PushSender } from './push/push-sender.js';
import { ReferralController } from './referral/referral.controller.js';
import { ReferralListener } from './referral/referral.listener.js';
import { ReferralService } from './referral/referral.service.js';

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

/**
 * growth (tầng 4): thông báo & Web Push (S6), NotificationService đa kênh + mẫu vi/en + tuỳ chọn theo loại + huỷ đăng ký ký HMAC,
 * thông báo billing/hoá đơn/dùng thử (S7→S8), referral (S8 – ADR-0030); S9: thông báo huy hiệu/đề xuất lộ trình, nhắc học
 * theo giờ người học + nhắc chuỗi 20:00 (job notify.study_reminder). Xem README.md.
 */
@Module({
  imports: [IamModule, BillingModule, LearningModule],
  controllers: [MeNotificationsController, PushPublicController, AdminNotificationsController, NotificationLinksController, ReferralController],
  providers: [NotificationsService, NotificationService, BillingNotificationsListener, ReferralService, ReferralListener, GrowthJobsService, LearningNotificationsListener, StudyRemindersService, { provide: PUSH_SENDER, inject: [ENV], useFactory: createPushSender }],
  exports: [NotificationsService, NotificationService, ReferralService, StudyRemindersService, PUSH_SENDER],
})
export class GrowthModule {}
