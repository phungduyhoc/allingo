import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { localDate, localTime, weekdayOf } from '@allingo/planner';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { PlanService } from './plan/plan.service.js';
import { SrsService } from './srs.service.js';

/** S10: srs.optimize chạy Chủ nhật từ 03:00 giờ VN (một lần/tuần) */
export const SRS_OPTIMIZE_WEEKDAY = 'sun';
export const SRS_OPTIMIZE_HOUR_VN = 3;

/** Nhịp job plan.expire_tasks (task pending quá 3 ngày → expired; đề xuất quá hạn → expired) */
export const PLAN_EXPIRE_INTERVAL_MS = 15 * 60_000;

/**
 * Lịch job learning (S9) – cùng mô hình billing/growth: worker luôn chạy; API chỉ khi JOBS_INLINE/BILLING_SCHEDULER_IN_API
 * (dev không có worker); không bao giờ ở APP_ENV=test (test gọi trực tiếp). Khoá Redis theo nhịp chống chạy trùng giữa replica.
 */
@Injectable()
export class LearningJobsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = getLogger({ component: 'learning.jobs' });
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly plans: PlanService,
    private readonly srs: SrsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('maintenance', JOB_NAMES.SRS_OPTIMIZE, async () => this.srs.optimizeDue());
  }

  onApplicationBootstrap(): void {
    if (this.env.APP_ENV === 'test') return;
    const isWorker = process.argv.some((a) => a.endsWith('worker.ts') || a.endsWith('worker.js'));
    if (isWorker || this.env.BILLING_SCHEDULER_IN_API || this.env.JOBS_INLINE) {
      this.timer = setInterval(() => void this.tick(), PLAN_EXPIRE_INTERVAL_MS);
      this.timer.unref?.();
      this.logger.info({ role: isWorker ? 'worker' : 'api' }, 'learning scheduler started');
    }
  }

  async tick(now: Date = new Date()): Promise<boolean> {
    if (this.ticking) return false;
    this.ticking = true;
    try {
      const slot = Math.floor(now.getTime() / PLAN_EXPIRE_INTERVAL_MS);
      const lock = await this.redis.safe((r) => r.set(`learning:joblock:plan_expire:${slot}`, '1', 'EX', 1800, 'NX'));
      if (lock !== null && lock !== 'OK') return false;
      await this.plans.expireDue(now);
      await this.maybeOptimize(now);
      return true;
    } catch (err) {
      this.logger.error({ err: (err as Error).message.slice(0, 200) }, 'plan.expire_tasks failed');
      return false;
    } finally {
      this.ticking = false;
    }
  }

  /** Tối ưu trọng số FSRS hằng tuần (Chủ nhật ≥ 03:00 giờ VN; khoá Redis theo ngày) */
  async maybeOptimize(now: Date): Promise<boolean> {
    const day = localDate(now, 'Asia/Ho_Chi_Minh');
    if (weekdayOf(day) !== SRS_OPTIMIZE_WEEKDAY || Number(localTime(now, 'Asia/Ho_Chi_Minh').slice(0, 2)) < SRS_OPTIMIZE_HOUR_VN) return false;
    const lock = await this.redis.safe((r) => r.set(`learning:joblock:srs_optimize:${day}`, '1', 'EX', 2 * 86_400, 'NX'));
    if (lock !== null && lock !== 'OK') return false;
    await this.srs.optimizeDue(now).catch((err: Error) => this.logger.error({ err: err.message.slice(0, 200) }, 'srs.optimize failed'));
    return true;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
