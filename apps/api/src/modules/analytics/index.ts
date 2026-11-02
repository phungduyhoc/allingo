// Giao diện công khai của module analytics (S10)
export { AnalyticsModule } from './analytics.module.js';
export { StatsService, statsCacheKey } from './stats.service.js';
export { ReadStoreService } from './read-store.service.js';
export { WeeklySummaryService, WEEKLY_SUMMARY_BATCH, type WeeklySummaryData } from './weekly-summary.service.js';
export { AnalyticsJobsService, ANALYTICS_TICK_MS } from './analytics-jobs.service.js';
export { FunnelService } from './funnel/funnel.service.js';
export { ANALYTICS_SINK, MemoryAnalyticsSink, NoopAnalyticsSink, PostHogSink, createAnalyticsSink, deterministicUuid, hashUserId, analyticsSalt, type AnalyticsSink, type FunnelCapture, type FetchLike } from './funnel/analytics-sink.js';
export { COHORT_MIN_SIZE, accuracyPct, compareAccuracy, lastWeekStarts, mondayOf, percentileOf, sumCells, targetBucket } from './stats-calc.js';
