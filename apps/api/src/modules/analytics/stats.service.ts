import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { addDays, localDate, zonedDayStart } from '@allingo/planner';
import { DOMAIN_EVENTS, type ProgramCode, type Stats } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import type { Tx } from '../../shared/db/db.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { EnrollmentsService } from '../iam/index.js';
import { ERROR_RESOLVED_EVENT, GamificationService, PlanService, SRS_REVIEWED_EVENT, SRS_REVIEW_SECONDS } from '../learning/index.js';
import { ReadStoreService } from './read-store.service.js';
import { COHORT_MIN_SIZE, accuracyPct, compareAccuracy, lastWeekStarts, mondayOf, percentileOf, sumCells, targetBucket, type Breakdown } from './stats-calc.js';

const MASTERED_STABILITY = 21;
const HISTORY_DAYS = 180;
const ACCURACY_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

type Heavy = Omit<Stats, 'streak' | 'xp' | 'badges' | 'plan' | 'target' | 'cached'>;

type AttemptRow = {
  id: string;
  mode: string;
  scaled_score: string | null;
  submitted_at: string | Date;
  time_spent_sec: number | null;
  test_set_kind: string | null;
  by_section: Breakdown | null;
  by_subskill: Breakdown | null;
  by_question_type: Breakdown | null;
  by_skill: Record<string, { correct: number; total: number }> | null;
  scaled: { listening?: number | null; reading?: number | null } | null;
};

export const statsCacheKey = (userId: string, program: string) => `stats:v1:${userId}:${program}`;
const cohortKey = (program: string, bucket: string) => `stats:cohort:v1:${program}:${bucket}`;

/**
 * GET /me/stats đầy đủ (Sprint 10): phần nặng (điểm theo thời gian, độ chính xác 30 ngày vs trước, phút học/tuần, từ vựng, lỗi,
 * percentile cộng đồng) tính trên kho đọc (replica / READ ONLY) và cache Redis `STATS_CACHE_TTL_SECONDS` (1 giờ) theo (người
 * dùng, chương trình); xoá khi `attempt.graded`, ôn thẻ, sổ lỗi đổi. Phần nhẹ thay đổi liên tục (chuỗi, XP, huy hiệu, lộ trình,
 * mục tiêu) luôn đọc trực tiếp. DDL không có schema `analytics` → chưa có bảng tổng hợp đêm (SPEC-ISSUES S113).
 */
@Injectable()
export class StatsService {
  private readonly logger = getLogger({ component: 'analytics.stats' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly store: ReadStoreService,
    private readonly redis: RedisService,
    private readonly enrollments: EnrollmentsService,
    private readonly gamification: GamificationService,
    private readonly plans: PlanService,
  ) {}

  async stats(userId: string, program: ProgramCode): Promise<Stats> {
    const [enrollment, streak, xp, badges, plan] = await Promise.all([
      this.enrollments.get(userId, program),
      this.gamification.streakView(userId, program),
      this.gamification.xpSummary(userId),
      this.gamification.latestBadges(userId),
      this.plans.summary(userId, program).catch(() => null),
    ]);
    const target = enrollment?.targetScore !== null && enrollment?.targetScore !== undefined ? Number(enrollment.targetScore) : null;
    let cached = false;
    let heavy: Heavy | null = null;
    const ttl = this.env.STATS_CACHE_TTL_SECONDS;
    if (ttl > 0) {
      const raw = await this.redis.safe((r) => r.get(statsCacheKey(userId, program)));
      if (raw) {
        try {
          heavy = JSON.parse(raw) as Heavy;
          cached = true;
        } catch {
          heavy = null;
        }
      }
    }
    if (!heavy) {
      heavy = await this.compute(userId, program, target);
      if (ttl > 0) await this.redis.safe((r) => r.set(statsCacheKey(userId, program), JSON.stringify(heavy), 'EX', ttl));
    }
    return {
      ...heavy,
      target,
      streak: { current: streak.current, longest: streak.longest, freeze_available: streak.freeze_available, at_risk: streak.at_risk, last_active_date: streak.last_active_date, freezes_used: streak.freezes_used },
      xp: { total: xp.total, this_week: xp.this_week, today: xp.today, level: xp.level, next_level_at: xp.next_level_at },
      badges,
      plan,
      cached,
    };
  }

  /** Xoá cache khi dữ liệu nguồn đổi (mọi chương trình đã nêu; thiếu → toeic) */
  async invalidate(userId: string, programs: readonly string[] = ['toeic']): Promise<void> {
    if (!userId) return;
    await this.redis.safe((r) => r.del(...programs.map((p) => statsCacheKey(userId, p))));
  }

  @OnEvent('local.attempt.graded')
  async onLocalGraded(p: { user_id: string; program?: string }): Promise<void> {
    await this.invalidate(p?.user_id, [p?.program ?? 'toeic']);
  }

  @OnEvent('outbox.attempt.graded')
  async onOutboxGraded(ev: { payload: { user_id: string; program?: string } }): Promise<void> {
    await this.onLocalGraded(ev.payload);
  }

  @OnEvent(`local.${SRS_REVIEWED_EVENT}`)
  async onSrs(ev: { user_id: string; programs?: string[] }): Promise<void> {
    await this.invalidate(ev?.user_id, ev?.programs ?? ['toeic']);
  }

  @OnEvent(`local.${DOMAIN_EVENTS.ERROR_LOG_UPDATED}`)
  async onErrorsUpdated(ev: { user_id: string; program?: string }): Promise<void> {
    await this.invalidate(ev?.user_id, [ev?.program ?? 'toeic']);
  }

  @OnEvent(`local.${ERROR_RESOLVED_EVENT}`)
  async onErrorResolved(ev: { user_id: string; program?: string }): Promise<void> {
    await this.invalidate(ev?.user_id, [ev?.program ?? 'toeic']);
  }

  // ------------------------------------------------------------------ tính toán (kho đọc)
  async compute(userId: string, program: string, target: number | null): Promise<Heavy> {
    const t0 = Date.now();
    const now = this.clock.now();
    const tz = await this.gamification.timezoneOf(userId);
    const today = localDate(now, tz);
    const endOfDay = zonedDayStart(addDays(today, 1), tz);
    const weeks = lastWeekStarts(today, 8);
    const weeksFrom = zonedDayStart(weeks[0]!, tz);
    const out = await this.store.read(async (tx) => {
      const [attempts, vocab, reviews, errors, errorKinds] = await Promise.all([
        tx.execute<AttemptRow>(sql`
          select a.id, a.mode, a.scaled_score, a.submitted_at, a.time_spent_sec, ts.kind::text as test_set_kind,
                 a.score_breakdown -> 'by_section' as by_section, a.score_breakdown -> 'by_subskill' as by_subskill,
                 a.score_breakdown -> 'by_question_type' as by_question_type,
                 (select jsonb_object_agg(k, jsonb_build_object('correct', v -> 'correct', 'total', v -> 'total')) from jsonb_each(coalesce(a.score_breakdown -> 'by_skill', '{}'::jsonb)) as s(k, v)) as by_skill,
                 a.score_breakdown -> 'scaled' as scaled
            from learn.attempts a left join catalog.test_sets ts on ts.id = a.test_set_id
           where a.user_id = ${userId}::uuid and a.program_code = ${program} and a.status = 'graded'
             and a.submitted_at >= ${new Date(now - HISTORY_DAYS * DAY_MS).toISOString()}::timestamptz
           order by a.submitted_at desc limit 500`),
        tx.execute<{ total: number; new: number; mastered: number; learning: number; due_today: number }>(sql`
          select count(*)::int as total,
                 count(*) filter (where state = 'new')::int as new,
                 count(*) filter (where state = 'review' and coalesce(stability, 0) >= ${MASTERED_STABILITY})::int as mastered,
                 count(*) filter (where state <> 'new' and not (state = 'review' and coalesce(stability, 0) >= ${MASTERED_STABILITY}))::int as learning,
                 count(*) filter (where state <> 'new' and due_at < ${endOfDay.toISOString()}::timestamptz)::int as due_today
            from learn.srs_cards where user_id = ${userId}::uuid and program_code = ${program} and card_type = 'vocab' and not suspended`),
        tx.execute<{ wk: string; n: number }>(sql`
          select to_char(date_trunc('week', r.reviewed_at at time zone ${tz}), 'YYYY-MM-DD') as wk, count(*)::int as n
            from learn.srs_reviews r join learn.srs_cards c on c.id = r.card_id
           where c.user_id = ${userId}::uuid and c.program_code = ${program} and r.reviewed_at >= ${weeksFrom.toISOString()}::timestamptz
           group by 1`),
        tx.execute<{ open: number; resolved: number }>(sql`
          select count(*) filter (where resolved_at is null)::int as open, count(*) filter (where resolved_at is not null)::int as resolved
            from learn.error_log_entries where user_id = ${userId}::uuid and program_code = ${program}`),
        tx.execute<{ k: string; n: number }>(sql`
          select coalesce(reason_override, error_kind)::text as k, count(*)::int as n
            from learn.error_log_entries where user_id = ${userId}::uuid and program_code = ${program} and resolved_at is null group by 1`),
      ]);
      const reviews7d = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from learn.srs_reviews r join learn.srs_cards c on c.id = r.card_id
         where c.user_id = ${userId}::uuid and c.program_code = ${program} and r.reviewed_at >= ${new Date(now - 7 * DAY_MS).toISOString()}::timestamptz`);
      return { attempts: [...attempts], vocab: [...vocab][0], reviews: [...reviews], errors: [...errors][0], errorKinds: [...errorKinds], reviews7d: Number([...reviews7d][0]?.n ?? 0) };
    });

    const rows = out.attempts.map((a) => ({ ...a, at: new Date(a.submitted_at).getTime(), scaled_num: a.scaled_score !== null ? Number(a.scaled_score) : null }));
    // Điểm theo thời gian: bài có thang điểm (không tính drill/timed_drill)
    const scored = rows.filter((a) => a.scaled_num !== null && a.mode !== 'drill' && a.mode !== 'timed_drill').sort((x, y) => x.at - y.at);
    const scoreHistory = scored.map((a) => ({ date: localDate(a.at, tz), at: new Date(a.at).toISOString(), score: a.scaled_num!, listening: numOrNull(a.scaled?.listening), reading: numOrNull(a.scaled?.reading), kind: a.test_set_kind, mode: a.mode, attempt_id: a.id }));
    const latest = scored.at(-1) ?? null;
    const trend = scored.filter((a) => a.at >= now - 30 * DAY_MS).map((a) => ({ date: localDate(a.at, tz), score: a.scaled_num! }));
    // Tổng hợp tương thích (30 bài gần nhất)
    const recent = rows.slice(0, 30);
    const withAcc = (m: Record<string, { correct: number; total: number }>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, accuracy: accuracyPct(v) ?? 0 }]));
    const bySection = withAcc(sumCells(recent.map((a) => a.by_section)));
    const byType = withAcc(sumCells(recent.map((a) => a.by_question_type)));
    const bySkill = withAcc(sumCells(recent.map((a) => a.by_subskill)));
    const weakest = Object.entries(bySkill)
      .filter(([, v]) => v.total >= 3)
      .sort((x, y) => x[1].accuracy - y[1].accuracy)
      .slice(0, 3)
      .map(([k]) => k);
    // 30 ngày gần nhất vs 30 ngày trước đó
    const curWin = rows.filter((a) => a.at >= now - ACCURACY_WINDOW_DAYS * DAY_MS);
    const prevWin = rows.filter((a) => a.at < now - ACCURACY_WINDOW_DAYS * DAY_MS && a.at >= now - 2 * ACCURACY_WINDOW_DAYS * DAY_MS);
    const accuracy = {
      window_days: ACCURACY_WINDOW_DAYS,
      by_section: compareAccuracy(sumCells(curWin.map((a) => a.by_section)), sumCells(prevWin.map((a) => a.by_section))),
      by_subskill: compareAccuracy(sumCells(curWin.map((a) => a.by_subskill)), sumCells(prevWin.map((a) => a.by_subskill))),
    };
    // Phút học theo tuần (thứ Hai, giờ người học): bài làm + ôn thẻ (ước tính SRS_REVIEW_SECONDS/thẻ)
    const reviewsByWeek = new Map(out.reviews.map((r) => [r.wk, Number(r.n)]));
    const minutesByWeek = weeks.map((wk) => {
      const inWeek = rows.filter((a) => mondayOf(localDate(a.at, tz)) === wk);
      const sec = inWeek.reduce((s, a) => s + (a.time_spent_sec ?? 0), 0);
      const reviews = reviewsByWeek.get(wk) ?? 0;
      return { week_start: wk, minutes: Math.round((sec + reviews * SRS_REVIEW_SECONDS) / 60), attempts: inWeek.length, reviews };
    });
    const minutesThisWeek = Math.round(rows.filter((a) => a.at >= now - 7 * DAY_MS).reduce((s, a) => s + (a.time_spent_sec ?? 0), 0) / 60);
    const community = await this.community(program, target, latest?.scaled_num ?? null);
    this.logger.debug({ ms: Date.now() - t0, attempts: rows.length, replica: this.store.usesReplica }, 'stats computed');
    return {
      program,
      current_estimate: latest?.scaled_num ?? null,
      trend_30d: trend,
      by_skill: bySkill,
      by_section: bySection,
      by_question_type: byType,
      weakest,
      minutes_this_week: minutesThisWeek,
      score_history: scoreHistory,
      accuracy,
      minutes_by_week: minutesByWeek,
      vocab: { total: Number(out.vocab?.total ?? 0), new: Number(out.vocab?.new ?? 0), learning: Number(out.vocab?.learning ?? 0), mastered: Number(out.vocab?.mastered ?? 0), due_today: Number(out.vocab?.due_today ?? 0), reviews_7d: out.reviews7d },
      errors: { open: Number(out.errors?.open ?? 0), resolved: Number(out.errors?.resolved ?? 0), by_kind: Object.fromEntries(out.errorKinds.map((k) => [k.k, Number(k.n)])) },
      community,
      generated_at: new Date(now).toISOString(),
    };
  }

  /** Percentile ẩn danh trong nhóm cùng chương trình + mức mục tiêu (điểm ước tính gần nhất 180 ngày của mỗi người) – cache 1 giờ */
  async community(program: string, target: number | null, estimate: number | null): Promise<Stats['community'] & object> {
    const bucket = targetBucket(program, target);
    const label = bucket?.label ?? 'none';
    if (estimate === null) return { percentile: null, cohort_size: 0, target_bucket: bucket?.label ?? null, reason: 'no_estimate' };
    let sample: number[] | null = null;
    const raw = await this.redis.safe((r) => r.get(cohortKey(program, label)));
    if (raw) {
      try {
        sample = JSON.parse(raw) as number[];
      } catch {
        sample = null;
      }
    }
    if (!sample) {
      sample = await this.store.read((tx) => this.cohortScores(tx, program, bucket));
      await this.redis.safe((r) => r.set(cohortKey(program, label), JSON.stringify(sample), 'EX', Math.max(60, this.env.STATS_CACHE_TTL_SECONDS || 3600)));
    }
    if (sample.length < COHORT_MIN_SIZE) return { percentile: null, cohort_size: sample.length, target_bucket: bucket?.label ?? null, reason: 'cohort_too_small' };
    return { percentile: percentileOf(estimate, sample), cohort_size: sample.length, target_bucket: bucket?.label ?? null, reason: 'ok' };
  }

  private async cohortScores(tx: Tx, program: string, bucket: { lo: number; hi: number } | null): Promise<number[]> {
    const bucketCond = bucket ? sql`e.target_score >= ${bucket.lo} and e.target_score < ${bucket.hi}` : sql`e.target_score is null`;
    const rows = await tx.execute<{ s: string }>(sql`
      select distinct on (a.user_id) a.scaled_score as s
        from learn.attempts a
        join learn.enrollments e on e.user_id = a.user_id and e.program_code = a.program_code
        join iam.users u on u.id = a.user_id
       where a.program_code = ${program} and a.status = 'graded' and a.scaled_score is not null and a.mode not in ('drill','timed_drill')
         and a.submitted_at >= now() - interval '${sql.raw(String(HISTORY_DAYS))} days'
         and u.is_guest = false and u.status = 'active' and ${bucketCond}
       order by a.user_id, a.submitted_at desc`);
    return [...rows].map((r) => Number(r.s)).sort((x, y) => x - y);
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
