import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { GrowthModule } from '../growth/index.js';
import { IamModule } from '../iam/index.js';
import { LearningModule } from '../learning/index.js';
import { TestEngineModule } from '../test-engine/index.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsJobsService } from './analytics-jobs.service.js';
import { ANALYTICS_SINK, createAnalyticsSink } from './funnel/analytics-sink.js';
import { FunnelService } from './funnel/funnel.service.js';
import { ReadStoreService } from './read-store.service.js';
import { StatsService } from './stats.service.js';
import { WeeklySummaryService } from './weekly-summary.service.js';

/**
 * analytics (tầng 4, S10): thống kê dashboard GET /me/stats đọc replica (`DATABASE_URL_REPLICA`, fallback cùng DB READ ONLY) +
 * cache Redis 1 giờ, tóm tắt tuần thứ Hai (NotificationService), phễu server-side → PostHog (không PII, distinct_id băm).
 * Ngoại lệ §5.1: được đọc bảng của module khác qua kho đọc; không ghi.
 */
@Module({
  imports: [IamModule, TestEngineModule, LearningModule, GrowthModule],
  controllers: [AnalyticsController],
  providers: [ReadStoreService, StatsService, FunnelService, WeeklySummaryService, AnalyticsJobsService, { provide: ANALYTICS_SINK, inject: [ENV], useFactory: (env: Env) => createAnalyticsSink(env) }],
  exports: [StatsService, FunnelService, WeeklySummaryService, AnalyticsJobsService, ANALYTICS_SINK],
})
export class AnalyticsModule {}
