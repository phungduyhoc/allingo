import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { NotificationService } from './notify/notification.service.js';
import { StudyRemindersService } from './study-reminders.service.js';

/**
 * Job growth (S8): `notification.dispatch` mỗi phút – giao thông báo đã hẹn giờ (giờ yên lặng); S9: `notify.study_reminder` cùng nhịp. Đăng ký JobsService (hàng `notify`)
 * + bộ lập lịch như billing (worker luôn; API khi JOBS_INLINE/BILLING_SCHEDULER_IN_API; không bao giờ ở APP_ENV=test),
 * khoá Redis theo nhịp chống chạy trùng giữa replica.
 */
@Injectable()
export class GrowthJobsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = getLogger({ component: 'growth.jobs' });
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jobs: JobsService,
    private readonly redis: RedisService,
    private readonly notify: NotificationService,
    private readonly reminders: StudyRemindersService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('notify', JOB_NAMES.NOTIFICATION_DISPATCH, () => this.notify.dispatchDue());
  }

  onApplicationBootstrap(): void {
    if (this.env.APP_ENV === 'test') return;
    const isWorker = process.argv.some((a) => a.endsWith('worker.ts') || a.endsWith('worker.js'));
    if (isWorker || this.env.BILLING_SCHEDULER_IN_API || this.env.JOBS_INLINE) this.start(isWorker ? 'worker' : 'api');
  }

  start(role: 'api' | 'worker'): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    this.logger.info({ role }, 'growth scheduler started');
  }

  async tick(now: Date = new Date()): Promise<boolean> {
    if (this.ticking) return false;
    this.ticking = true;
    try {
      const slot = Math.floor(now.getTime() / 60_000);
      const lock = await this.redis.safe((r) => r.set(`growth:joblock:dispatch:${slot}`, '1', 'EX', 120, 'NX'));
      if (lock !== null && lock !== 'OK') return false;
      const r = await this.notify.dispatchDue(now);
      if (r.sent || r.failed) this.logger.info(r, 'notification.dispatch');
      // S9: nhắc học theo giờ người học + nhắc chuỗi 20:00 (cùng nhịp phút, cùng khoá)
      await this.reminders.run(now).catch((err: Error) => this.logger.error({ err: err.message.slice(0, 200) }, 'notify.study_reminder failed'));
      return true;
    } catch (err) {
      this.logger.error({ err: (err as Error).message.slice(0, 200) }, 'notification.dispatch failed');
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
