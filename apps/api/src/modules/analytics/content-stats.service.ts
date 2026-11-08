import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { startDailyJob } from '../../shared/queue/daily-scheduler.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { ContentReportsService, QuestionStatsService, type QuestionStatsValue } from '../catalog/index.js';
import { recommendQuestion, round } from './content-stats.js';
import { ReadStoreService } from './read-store.service.js';

interface Row {
  question_id: string;
  n: number;
  correct: number;
  avg_time: number | null;
  pb: number | null;
}

/**
 * Job `content.stats_nightly` (S12, hàng maintenance, 02:00 giờ VN): đọc replica learn.attempt_answers trong cửa sổ
 * CONTENT_STATS_WINDOW_DAYS (attempt đã chấm, câu chấm tự động) → n, p-value, point-biserial (corr đúng/sai × tỉ lệ đúng phần
 * còn lại của bài), thời gian TB; + số báo lỗi (catalog) → đề xuất retire/review → catalog.questions.stats (QuestionStatsService).
 */
@Injectable()
export class ContentStatsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private stop: (() => void) | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly read: ReadStoreService,
    private readonly jobs: JobsService,
    private readonly redis: RedisService,
    private readonly stats: QuestionStatsService,
    private readonly reports: ContentReportsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('maintenance', JOB_NAMES.CONTENT_STATS_NIGHTLY, () => this.run());
  }

  onApplicationBootstrap(): void {
    this.stop = startDailyJob({ name: JOB_NAMES.CONTENT_STATS_NIGHTLY, hourVn: this.env.CONTENT_STATS_HOUR_VN, env: this.env, redis: this.redis, run: (now) => this.run(now) });
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  async run(now: Date = new Date()): Promise<{ questions: number; updated: number; retire: number; review: number }> {
    const since = new Date(now.getTime() - this.env.CONTENT_STATS_WINDOW_DAYS * 86_400_000);
    const rows = await this.read.read(async (tx) =>
      (await tx.execute(sql`
        with ans as (
          select aa.question_id, aa.attempt_id, (case when aa.is_correct then 1 else 0 end) as c, aa.time_spent_ms as t
          from learn.attempt_answers aa join learn.attempts a on a.id = aa.attempt_id
          where aa.created_at >= ${since.toISOString()}::timestamptz and aa.is_correct is not null and a.status = 'graded'
        ),
        tot as (select attempt_id, sum(c) as sc, count(*) as n from ans group by attempt_id having count(*) >= 2)
        select ans.question_id, count(*)::int as n, sum(ans.c)::int as correct, avg(ans.t)::int as avg_time,
               corr(ans.c::float8, ((tot.sc - ans.c)::float8 / (tot.n - 1))) as pb
        from ans join tot using (attempt_id)
        group by ans.question_id`)) as unknown as Row[],
    );
    const reportCounts = await this.reports.countsByQuestion();
    const ids = new Set(rows.map((r) => r.question_id));
    for (const q of reportCounts.keys()) ids.add(q);
    const byId = new Map(rows.map((r) => [r.question_id, r]));
    const computedAt = now.toISOString();
    let retire = 0;
    let review = 0;
    const out: Array<{ questionId: string; stats: QuestionStatsValue }> = [];
    for (const id of ids) {
      const r = byId.get(id);
      const rc = reportCounts.get(id) ?? { open: 0, confirmed: 0, total: 0 };
      const n = r?.n ?? 0;
      const p = n ? round((r!.correct ?? 0) / n) : null;
      const disc = r?.pb === null || r?.pb === undefined ? null : round(Number(r.pb));
      const rec = recommendQuestion({ n, p_value: p, discrimination: disc, reports_open: rc.open, reports_confirmed: rc.confirmed }, this.env.CONTENT_STATS_MIN_N);
      if (rec.recommendation === 'retire') retire++;
      if (rec.recommendation === 'review') review++;
      out.push({ questionId: id, stats: { n, correct: r?.correct ?? 0, p_value: p, discrimination: disc, avg_time_ms: r?.avg_time ?? null, reports_open: rc.open, reports_confirmed: rc.confirmed, reports_total: rc.total, recommendation: rec.recommendation, reasons: rec.reasons, window_days: this.env.CONTENT_STATS_WINDOW_DAYS, computed_at: computedAt } });
    }
    const updated = await this.stats.save(out);
    return { questions: ids.size, updated, retire, review };
  }
}
