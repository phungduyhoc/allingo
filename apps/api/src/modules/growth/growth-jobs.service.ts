import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { NotificationService } from './notify/notification.service.js';
import { StudyRemindersService } from './study-reminders.service.js';
import { BetaService } from './beta/beta.service.js';
import { SupportService } from './support/support.service.js';
import { ContentReportsService } from '../catalog/index.js';
import { GROWTH_METRICS } from '../../shared/telemetry/metrics.js';

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
    private readonly beta: BetaService,
    private readonly support: SupportService,
    private readonly reports: ContentReportsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('notify', JOB_NAMES.NOTIFICATION_DISPATCH, () => this.notify.dispatchDue());
    // S12: gửi mời beta theo đợt (hạn mức/ngày giờ VN) + cảnh báo SLA hỗ trợ
    // B6/S147: payload có thể chọn lô (`invite_ids`, `batch`); thiếu → mọi lời mời đang xếp hàng
    this.jobs.register('notify', JOB_NAMES.BETA_INVITES_SEND, (p) =>
      this.beta.sendDue({
        limit: typeof p?.limit === 'number' ? p.limit : undefined,
        inviteIds: Array.isArray(p?.invite_ids) ? (p.invite_ids as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
        batch: typeof p?.batch === 'string' && p.batch ? p.batch : undefined,
      }),
    );
    this.jobs.register('maintenance', JOB_NAMES.SLA_CHECK, () => this.slaCheck());
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
      await this.s12Tick(now);
      return true;
    } catch (err) {
      this.logger.error({ err: (err as Error).message.slice(0, 200) }, 'notification.dispatch failed');
      return false;
    } finally {
      this.ticking = false;
    }
  }

  /** S12: SLA mỗi 15 phút; gửi mời beta mỗi ngày lúc BETA_INVITE_SEND_HOUR_VN (khoá Redis theo ngày – một replica) */
  async s12Tick(now: Date): Promise<void> {
    if (now.getUTCMinutes() % 15 === 0) await this.slaCheck(now).catch((err: Error) => this.logger.warn({ err: err.message.slice(0, 200) }, 'ops.sla_check failed'));
    const vn = new Date(now.getTime() + 7 * 3_600_000);
    if (vn.getUTCHours() !== this.env.BETA_INVITE_SEND_HOUR_VN) return;
    const day = vn.toISOString().slice(0, 10);
    const lock = await this.redis.safe((r) => r.set(`growth:joblock:beta_invites:${day}`, '1', 'EX', 26 * 3600, 'NX'));
    if (lock !== null && lock !== 'OK') return;
    await this.beta.sendDue({ now }).catch((err: Error) => this.logger.error({ err: err.message.slice(0, 200) }, 'beta.invites_send failed'));
  }

  /** ops.sla_check: báo lỗi câu mở quá 48 giờ, ticket chưa phản hồi quá 24 giờ → gauge + cảnh báo log (alert SupportSlaBreached) */
  async slaCheck(now: Date = new Date()): Promise<{ content_reports_overdue: number; support_tickets_overdue: number }> {
    const content = await this.reports.overdueCount(now);
    const tickets = await this.support.overdueCount(now);
    GROWTH_METRICS.slaOverdue.set({ kind: 'content_report' }, content);
    GROWTH_METRICS.slaOverdue.set({ kind: 'support_ticket' }, tickets);
    if (content || tickets) this.logger.warn({ content_reports_overdue: content, support_tickets_overdue: tickets }, 'support SLA overdue');
    return { content_reports_overdue: content, support_tickets_overdue: tickets };
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
