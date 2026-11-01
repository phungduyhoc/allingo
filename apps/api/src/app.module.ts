import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './shared/db/db.module.js';
import { RedisModule } from './shared/cache/redis.module.js';
import { QueueModule } from './shared/queue/queue.module.js';
import { JobsModule } from './shared/queue/jobs.service.js';
import { ClockModule } from './shared/clock/clock.module.js';
import { MetricsController } from './shared/http/metrics.controller.js';
import { StorageModule } from './shared/storage/storage.module.js';
import { EventsModule } from './shared/events/outbox.service.js';
import { NotifyModule } from './shared/notify/mailer.service.js';
import { SharedAuthModule } from './shared/auth/auth.module.js';
import { AuthGuard } from './shared/auth/auth.guard.js';
import { AppExceptionFilter } from './shared/http/exception.filter.js';
import { HealthController } from './shared/http/health.controller.js';
import { RealtimeModule } from './shared/realtime/realtime.gateway.js';
import { IamModule } from './modules/iam/index.js';
import { CatalogModule } from './modules/catalog/index.js';
import { BillingModule } from './modules/billing/index.js';
import { AiGatewayModule, AiFeaturesModule } from './modules/ai-gateway/index.js';
import { TestEngineModule } from './modules/test-engine/index.js';
import { LearningModule } from './modules/learning/index.js';
import { GradingModule } from './modules/grading/index.js';
import { SpeechModule } from './modules/speech/index.js';
import { GrowthModule } from './modules/growth/index.js';
import { AnalyticsModule } from './modules/analytics/index.js';
import { B2bModule } from './modules/b2b/index.js';
import { AdminModule } from './modules/admin/index.js';

/** Modular monolith (ADR-0002): shared → iam/catalog/billing/ai-gateway/speech → test-engine/grading → learning → growth/b2b/analytics/admin */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    QueueModule,
    JobsModule,
    ClockModule,
    StorageModule,
    EventsModule,
    NotifyModule,
    SharedAuthModule,
    RealtimeModule,
    IamModule,
    CatalogModule,
    BillingModule,
    AiGatewayModule,
    AiFeaturesModule,
    TestEngineModule,
    LearningModule,
    GradingModule,
    SpeechModule,
    GrowthModule,
    AnalyticsModule,
    B2bModule,
    AdminModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
