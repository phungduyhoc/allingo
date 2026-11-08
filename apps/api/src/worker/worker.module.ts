import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DbModule } from '../shared/db/db.module.js';
import { RedisModule } from '../shared/cache/redis.module.js';
import { QueueModule } from '../shared/queue/queue.module.js';
import { JobsModule } from '../shared/queue/jobs.service.js';
import { ClockModule } from '../shared/clock/clock.module.js';
import { StorageModule } from '../shared/storage/storage.module.js';
import { EventsModule } from '../shared/events/outbox.service.js';
import { NotifyModule } from '../shared/notify/mailer.service.js';
import { SharedAuthModule } from '../shared/auth/auth.module.js';
import { RealtimeModule } from '../shared/realtime/realtime.gateway.js';
import { ExamModeModule } from '../shared/exam/exam-mode.js';
import { IamModule } from '../modules/iam/index.js';
import { CatalogModule } from '../modules/catalog/index.js';
import { BillingModule } from '../modules/billing/index.js';
import { AiGatewayModule } from '../modules/ai-gateway/index.js';
import { TestEngineModule } from '../modules/test-engine/index.js';
import { LearningModule } from '../modules/learning/index.js';
import { SpeechModule } from '../modules/speech/index.js';
import { GrowthModule } from '../modules/growth/index.js';
import { AnalyticsModule } from '../modules/analytics/index.js';
import { AdminModule } from '../modules/admin/index.js';
import { GradingModule } from '../modules/grading/index.js';
import { WorkerRunner } from './worker.runner.js';

/** Worker: cùng codebase, không mở HTTP; chạy processors BullMQ + job định kỳ. GrowthModule (S7): nhận outbox subscription.* → ops.notifications; AnalyticsModule (S10): phễu outbox → PostHog, tóm tắt tuần, xoá cache thống kê */
@Module({
  imports: [ConfigModule, DbModule, RedisModule, QueueModule, JobsModule, ClockModule, StorageModule, EventsModule, NotifyModule, SharedAuthModule, ExamModeModule, RealtimeModule, IamModule, CatalogModule, BillingModule, AiGatewayModule, TestEngineModule, LearningModule, SpeechModule, GrowthModule, AnalyticsModule, GradingModule, AdminModule],
  providers: [WorkerRunner],
})
export class WorkerModule {}
