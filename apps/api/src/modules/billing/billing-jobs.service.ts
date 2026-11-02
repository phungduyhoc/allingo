import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BILLING_JOBS, type BillingJob } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CreditService } from './credit.service.js';
import { FreeCreditsService } from './free-credits.service.js';
import { InvoicesService } from './invoices/invoices.service.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';
import { vnDateTime } from './payments/crypto.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** Chu kỳ (giây) của từng job billing trong bộ lập lịch */
export const BILLING_JOB_INTERVALS: Record<BillingJob, number> = {
  'order.expire': 60,
  'payment.reconcile': 300,
  'subscription.expire': 600,
  'credit.grant_monthly': 3600,
  'credit.expire': 3600,
  // hằng ngày: chạy ở lần tick đầu tiên sau 01:30 giờ VN
  'billing.reconcile': 86_400,
  // S8: Free cấp lại credit tháng (idempotent theo (user, kỳ)); hoá đơn thử lại theo backoff + quét hàng kẹt
  'credit.grant_free_monthly': 3600,
  'invoice.retry': 60,
};

/**
 * Job billing (CLAUDE.md §5.5, hàng đợi `maintenance`): đăng ký với JobsService (worker BullMQ chạy, POST /admin/billing/jobs/{job}
 * đưa vào hàng đợi / chạy inline) + bộ lập lịch theo chu kỳ (worker luôn; API khi BILLING_SCHEDULER_IN_API hoặc JOBS_INLINE –
 * dev không có worker, A59). Khoá Redis `billing:joblock:<job>` để nhiều replica không chạy trùng; mọi job idempotent.
 */
@Injectable()
export class BillingJobsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = getLogger({ component: 'billing.jobs' });
  private timer: NodeJS.Timeout | null = null;
  private readonly lastRun = new Map<BillingJob, number>();
  private ticking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly redis: RedisService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly credits: CreditService,
    private readonly reconciliation: ReconciliationService,
    private readonly freeCredits: FreeCreditsService,
    private readonly invoices: InvoicesService,
  ) {}

  onModuleInit(): void {
    for (const job of BILLING_JOBS) this.jobs.register('maintenance', job, () => this.run(job));
  }

  onApplicationBootstrap(): void {
    if (this.env.APP_ENV !== 'test' && (this.env.BILLING_SCHEDULER_IN_API || this.env.JOBS_INLINE) && !process.argv.some((a) => a.endsWith('worker.ts') || a.endsWith('worker.js'))) this.startScheduler('api');
  }

  /** Chạy một job ngay (đồng bộ) – trả kết quả đếm */
  async run(job: BillingJob, now: Date = new Date(this.clock.now())): Promise<Record<string, number>> {
    switch (job) {
      case 'order.expire':
        return { expired: await this.orders.expireDue(now) };
      case 'payment.reconcile':
        return this.payments.reconcilePending(now);
      case 'subscription.expire': {
        const e = await this.subscriptions.expireDue(now);
        const r = await this.subscriptions.remindDue(now);
        return { ...e, ...r };
      }
      case 'credit.grant_monthly':
        return this.subscriptions.grantMonthlyDue(now);
      case 'credit.expire':
        return this.credits.expireDue(now);
      case 'billing.reconcile':
        return this.reconciliation.daily(now);
      case 'credit.grant_free_monthly': {
        const r = await this.freeCredits.grantDue(now);
        return { users: r.users, credits: r.credits, skipped: r.skipped };
      }
      case 'invoice.retry':
        return this.invoices.retryDue(now);
    }
  }

  startScheduler(role: 'api' | 'worker'): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
    this.logger.info({ role }, 'billing scheduler started');
  }

  /** Một nhịp: chạy các job đến hạn (theo chu kỳ; billing.reconcile sau 01:30 giờ VN mỗi ngày) */
  async tick(now: Date = new Date(this.clock.now())): Promise<BillingJob[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const ran: BillingJob[] = [];
    try {
      for (const job of BILLING_JOBS) {
        if (!this.isDue(job, now)) continue;
        // Khoá theo nhịp (slot): một replica chạy mỗi nhịp; nhịp sau có khoá mới
        const interval = BILLING_JOB_INTERVALS[job];
        const slot = job === 'billing.reconcile' ? vnDateTime(now).slice(0, 8) : String(Math.floor(now.getTime() / (interval * 1000)));
        const lock = await this.redis.safe((r) => r.set(`billing:joblock:${job}:${slot}`, String(now.getTime()), 'EX', interval + 60, 'NX'));
        this.lastRun.set(job, now.getTime());
        if (lock === null && this.redis.isHealthy) continue;
        if (lock !== null && lock !== 'OK') continue; // replica khác đang/đã chạy
        try {
          const r = await this.run(job, now);
          ran.push(job);
          if (Object.values(r).some((v) => v > 0)) this.logger.info({ job, ...r }, 'billing job');
        } catch (err) {
          this.logger.error({ job, err: (err as Error).message.slice(0, 300) }, 'billing job failed');
        }
      }
    } finally {
      this.ticking = false;
    }
    return ran;
  }

  private isDue(job: BillingJob, now: Date): boolean {
    const last = this.lastRun.get(job);
    if (job === 'billing.reconcile') {
      const hm = vnDateTime(now).slice(8, 12);
      if (hm < '0130') return false;
      return !last || vnDateTime(new Date(last)).slice(0, 8) !== vnDateTime(now).slice(0, 8);
    }
    return !last || now.getTime() - last >= BILLING_JOB_INTERVALS[job] * 1000;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
