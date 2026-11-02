import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { localDate, localTime, weekdayOf } from '@allingo/planner';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { WeeklySummaryService } from './weekly-summary.service.js';

const VN_TZ = 'Asia/Ho_Chi_Minh';
export const ANALYTICS_TICK_MS = 5 * 60_000;

/**
 * Lịch job analytics (S10) – cùng mô hình billing/growth/learning: worker luôn; API khi JOBS_INLINE/BILLING_SCHEDULER_IN_API;
 * không bao giờ ở APP_ENV=test (test gọi trực tiếp). `notify.weekly_summary`: thứ Hai từ `WEEKLY_SUMMARY_HOUR_VN` giờ VN, mỗi
 * nhịp 5′ một lô (khoá Redis theo nhịp), dừng khi tuần đã gửi hết (cờ `analytics:weekly:done:<tuần>`).
 */
@Injectable()
export class AnalyticsJobsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = getLogger({ component: 'analytics.jobs' });
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly jobs: JobsService,
    private readonly weekly: WeeklySummaryService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('analytics', JOB_NAMES.WEEKLY_SUMMARY, async () => this.weekly.run());
  }

  onApplicationBootstrap(): void {
    if (this.env.APP_ENV === 'test') return;
    const isWorker = process.argv.some((a) => a.endsWith('worker.ts') || a.endsWith('worker.js'));
    if (isWorker || this.env.BILLING_SCHEDULER_IN_API || this.env.JOBS_INLINE) {
      this.timer = setInterval(() => void this.tick(), ANALYTICS_TICK_MS);
      this.timer.unref?.();
      this.logger.info({ role: isWorker ? 'worker' : 'api' }, 'analytics scheduler started');
    }
  }

  /** Có nên chạy tóm tắt tuần lúc `now` (thứ Hai, ≥ giờ cấu hình, giờ VN) */
  isWeeklyWindow(now: Date): boolean {
    const day = localDate(now, VN_TZ);
    const hour = Number(localTime(now, VN_TZ).slice(0, 2));
    return weekdayOf(day) === 'mon' && hour >= this.env.WEEKLY_SUMMARY_HOUR_VN;
  }

  async tick(now: Date = new Date()): Promise<boolean> {
    if (this.ticking || !this.isWeeklyWindow(now)) return false;
    this.ticking = true;
    try {
      const day = localDate(now, VN_TZ);
      const done = await this.redis.safe((r) => r.get(`analytics:weekly:done:${day}`));
      if (done) return false;
      const slot = Math.floor(now.getTime() / ANALYTICS_TICK_MS);
      const lock = await this.redis.safe((r) => r.set(`analytics:joblock:weekly:${slot}`, '1', 'EX', 600, 'NX'));
      if (lock !== null && lock !== 'OK') return false;
      const r = await this.weekly.run(now);
      if (r.candidates === 0) await this.redis.safe((x) => x.set(`analytics:weekly:done:${day}`, '1', 'EX', 7 * 86_400));
      return true;
    } catch (err) {
      this.logger.error({ err: (err as Error).message.slice(0, 200) }, 'notify.weekly_summary failed');
      return false;
    } finally {
      this.ticking = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
