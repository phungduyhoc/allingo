import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { startDailyJob } from '../../shared/queue/daily-scheduler.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { AiQualityService } from '../ai-gateway/index.js';
import { UploadsService } from '../grading/index.js';
import { BetaService, NotificationService } from '../growth/index.js';
import { AdminOpsService } from './admin-ops.service.js';

const DAY = 86_400_000;

export interface RetentionResult {
  recordings: { deleted: number; purged_files: number; kept_rows: number };
  ai_tasks: number;
  outbox: number;
  notifications: number;
  audit_logs: number;
  dead_letters: number;
  beta_invites_expired: number;
}

/**
 * Job `ops.retention_cleanup` (S12, hàng maintenance, 03:00 giờ VN – runbook docs/runbooks/data-retention.md):
 * ghi âm quá expires_at (+ xoá S3), ai_tasks > RETENTION_AI_TASKS_DAYS, outbox đã relay > RETENTION_OUTBOX_DAYS, thông báo đã xử lý
 * > RETENTION_NOTIFICATIONS_DAYS, audit > RETENTION_AUDIT_DAYS, dead-letter đã xử lý > RETENTION_DEADLETTER_DAYS, mã mời quá hạn.
 * Mỗi module tự xoá bảng của mình (CLAUDE.md §5.1); module admin chỉ điều phối. Kết quả ghi audit `ops.retention_cleanup`.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private stop: (() => void) | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jobs: JobsService,
    private readonly redis: RedisService,
    private readonly uploads: UploadsService,
    private readonly ai: AiQualityService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly ops: AdminOpsService,
    private readonly beta: BetaService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('maintenance', JOB_NAMES.RETENTION_CLEANUP, () => this.run());
  }

  onApplicationBootstrap(): void {
    this.stop = startDailyJob({ name: JOB_NAMES.RETENTION_CLEANUP, hourVn: this.env.RETENTION_HOUR_VN, env: this.env, redis: this.redis, run: (now) => this.run(now) });
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  async run(now: Date = new Date()): Promise<RetentionResult> {
    const b = this.env.RETENTION_BATCH;
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const r: RetentionResult = {
      recordings: await this.uploads.purgeExpiredRecordings(now, b),
      ai_tasks: await this.ai.purgeBefore(ago(this.env.RETENTION_AI_TASKS_DAYS), b),
      outbox: await this.outbox.purgePublished(ago(this.env.RETENTION_OUTBOX_DAYS), b),
      notifications: await this.notifications.purgeBefore(ago(this.env.RETENTION_NOTIFICATIONS_DAYS), b),
      audit_logs: await this.audit.purgeBefore(ago(this.env.RETENTION_AUDIT_DAYS), b),
      dead_letters: await this.ops.purgeDeadLetters(ago(this.env.RETENTION_DEADLETTER_DAYS)),
      beta_invites_expired: await this.beta.expireDue(now),
    };
    await this.audit.log({ action: 'ops.retention_cleanup', actorRole: 'service', entityType: 'system', after: { ...r, policy: { ai_tasks_days: this.env.RETENTION_AI_TASKS_DAYS, outbox_days: this.env.RETENTION_OUTBOX_DAYS, notifications_days: this.env.RETENTION_NOTIFICATIONS_DAYS, audit_days: this.env.RETENTION_AUDIT_DAYS, deadletter_days: this.env.RETENTION_DEADLETTER_DAYS } } });
    return r;
  }
}
