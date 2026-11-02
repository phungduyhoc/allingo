import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { addDays, localDate, zonedDayStart } from '@allingo/planner';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { NotificationService } from '../growth/index.js';
import { SRS_REVIEW_SECONDS } from '../learning/index.js';
import { ReadStoreService } from './read-store.service.js';
import { mondayOf } from './stats-calc.js';

const VN_TZ = 'Asia/Ho_Chi_Minh';
/** Người nhận tối đa mỗi lần chạy (job chạy lại mỗi nhịp tới khi hết; dedupe_key chặn gửi trùng) */
export const WEEKLY_SUMMARY_BATCH = 2000;

export interface WeeklySummaryData {
  minutes: number;
  attempts: number;
  xp: number;
  streak: number;
  estimate: number | null;
  reviews: number;
  words_learned: number;
  errors_open: number;
  errors_resolved: number;
  week_start: string;
  program: string;
}

/**
 * Tóm tắt tuần (S10): sáng thứ Hai (giờ VN) gửi `learning.weekly_summary` (email + in-app, loại marketing → theo tuỳ chọn
 * thông báo/đồng ý marketing – A123) cho người học có hoạt động tuần trước (bài chấm hoặc ôn thẻ). Số liệu đọc kho đọc
 * (replica/READ ONLY); NotificationService quyết định kênh/giờ yên lặng/tần suất; `dedupe_key = weekly:<thứ Hai tuần trước>`.
 */
@Injectable()
export class WeeklySummaryService {
  private readonly logger = getLogger({ component: 'analytics.weekly' });

  constructor(
    private readonly store: ReadStoreService,
    private readonly notify: NotificationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Tuần trước theo giờ VN: [thứ Hai trước, thứ Hai này) */
  weekWindow(now: Date): { weekStart: string; from: Date; to: Date } {
    const thisMonday = mondayOf(localDate(now, VN_TZ));
    const weekStart = addDays(thisMonday, -7);
    return { weekStart, from: zonedDayStart(weekStart, VN_TZ), to: zonedDayStart(thisMonday, VN_TZ) };
  }

  async summaries(from: Date, to: Date, limit: number, userIds?: string[], dedupeKey?: string): Promise<Array<{ userId: string; data: Omit<WeeklySummaryData, 'week_start' | 'program'> }>> {
    const onlyUsers = userIds?.length ? sql`and u.id = any(${`{${userIds.join(',')}}`}::uuid[])` : sql``;
    // Đã gửi tuần này (mọi kênh) → bỏ qua, để lần chạy sau tiếp tục người kế tiếp
    const notSent = dedupeKey ? sql`and not exists (select 1 from ops.notifications n where n.user_id = u.id and n.template_code = 'learning.weekly_summary' and n.payload ->> 'dedupe_key' = ${dedupeKey})` : sql``;
    const rows = await this.store.read((tx) =>
      tx.execute<{ user_id: string; sec: number; attempts: number; reviews: number; words: number; xp: number; streak: number; estimate: string | null; errors_open: number; errors_resolved: number }>(sql`
        with active as (
          select a.user_id from learn.attempts a where a.status = 'graded' and a.submitted_at >= ${from.toISOString()}::timestamptz and a.submitted_at < ${to.toISOString()}::timestamptz
          union
          select c.user_id from learn.srs_reviews r join learn.srs_cards c on c.id = r.card_id where r.reviewed_at >= ${from.toISOString()}::timestamptz and r.reviewed_at < ${to.toISOString()}::timestamptz
        )
        select u.id as user_id,
               coalesce((select sum(a.time_spent_sec) from learn.attempts a where a.user_id = u.id and a.status = 'graded' and a.submitted_at >= ${from.toISOString()}::timestamptz and a.submitted_at < ${to.toISOString()}::timestamptz), 0)::int as sec,
               (select count(*) from learn.attempts a where a.user_id = u.id and a.status = 'graded' and a.submitted_at >= ${from.toISOString()}::timestamptz and a.submitted_at < ${to.toISOString()}::timestamptz)::int as attempts,
               (select count(*) from learn.srs_reviews r join learn.srs_cards c on c.id = r.card_id where c.user_id = u.id and r.reviewed_at >= ${from.toISOString()}::timestamptz and r.reviewed_at < ${to.toISOString()}::timestamptz)::int as reviews,
               (select count(distinct r.card_id) from learn.srs_reviews r join learn.srs_cards c on c.id = r.card_id where c.user_id = u.id and c.card_type = 'vocab' and r.reviewed_at >= ${from.toISOString()}::timestamptz and r.reviewed_at < ${to.toISOString()}::timestamptz
                  and not exists (select 1 from learn.srs_reviews r0 where r0.card_id = r.card_id and r0.reviewed_at < ${from.toISOString()}::timestamptz))::int as words,
               coalesce((select sum(x.amount) from learn.xp_events x where x.user_id = u.id and x.created_at >= ${from.toISOString()}::timestamptz and x.created_at < ${to.toISOString()}::timestamptz), 0)::int as xp,
               coalesce((select s.current_streak from learn.streaks s where s.user_id = u.id), 0)::int as streak,
               (select a.scaled_score from learn.attempts a where a.user_id = u.id and a.status = 'graded' and a.scaled_score is not null and a.mode not in ('drill','timed_drill') order by a.submitted_at desc limit 1) as estimate,
               (select count(*) from learn.error_log_entries e where e.user_id = u.id and e.resolved_at is null)::int as errors_open,
               (select count(*) from learn.error_log_entries e where e.user_id = u.id and e.resolved_at >= ${from.toISOString()}::timestamptz and e.resolved_at < ${to.toISOString()}::timestamptz)::int as errors_resolved
          from iam.users u join active on active.user_id = u.id
         where u.is_guest = false and u.status = 'active' ${onlyUsers} ${notSent}
         order by u.id
         limit ${limit}`),
    );
    return [...rows].map((r) => ({
      userId: r.user_id,
      data: { minutes: Math.round((Number(r.sec) + Number(r.reviews) * SRS_REVIEW_SECONDS) / 60), attempts: Number(r.attempts), reviews: Number(r.reviews), words_learned: Number(r.words), xp: Number(r.xp), streak: Number(r.streak), estimate: r.estimate !== null ? Number(r.estimate) : null, errors_open: Number(r.errors_open), errors_resolved: Number(r.errors_resolved) },
    }));
  }

  /** Gửi tóm tắt tuần trước cho người học có hoạt động (idempotent theo dedupe_key) */
  async run(now: Date = new Date(this.clock.now()), opts: { userIds?: string[]; limit?: number } = {}): Promise<{ week_start: string; candidates: number; sent: number; skipped: number }> {
    const { weekStart, from, to } = this.weekWindow(now);
    const list = await this.summaries(from, to, opts.limit ?? WEEKLY_SUMMARY_BATCH, opts.userIds, `weekly:${weekStart}`);
    let sent = 0;
    let skipped = 0;
    for (const s of list) {
      try {
        const r = await this.notify.send(s.userId, 'learning.weekly_summary', { ...s.data, week_start: weekStart, program: 'toeic' }, { dedupeKey: `weekly:${weekStart}`, now });
        if (r.results.some((x) => x.status === 'sent' || x.status === 'scheduled')) sent++;
        else skipped++;
      } catch (err) {
        skipped++;
        this.logger.warn({ err: (err as Error).message.slice(0, 160) }, 'weekly summary send failed');
      }
    }
    if (list.length) this.logger.info({ week_start: weekStart, candidates: list.length, sent, skipped }, 'notify.weekly_summary');
    return { week_start: weekStart, candidates: list.length, sent, skipped };
  }
}
