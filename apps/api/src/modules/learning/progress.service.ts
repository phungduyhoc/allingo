import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { XP_RULES, type Stats } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { EnrollmentsService } from '../iam/index.js';
import { AttemptsService } from '../test-engine/index.js';

const { learnStreaks, learnXpEvents, learnBadges, learnUserBadges } = schema;
const TZ = 'Asia/Ho_Chi_Minh';

const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Learning (Sprint 0 khung): streak/XP khi attempt.graded, huy hiệu đơn giản, GET /me/stats tối thiểu.
 * Lộ trình/FSRS/sổ lỗi ở Sprint 9–10.
 */
@Injectable()
export class ProgressService {
  private readonly logger = getLogger({ component: 'learning' });
  constructor(
    private readonly dbs: DbService,
    private readonly enrollments: EnrollmentsService,
    private readonly attempts: AttemptsService,
  ) {}

  /** Consumer sự kiện (local = cùng process ngay sau commit; outbox = relay) – idempotent theo (ref_type, ref_id) */
  @OnEvent('local.attempt.graded')
  async onAttemptGraded(payload: { attempt_id: string; user_id: string; xp_earned: number; correct: number; total: number; mode: string }): Promise<void> {
    try {
      await this.recordAttemptXp(payload);
    } catch (err) {
      this.logger.error({ err, attempt_id: payload.attempt_id }, 'xp/streak update failed');
    }
  }

  @OnEvent('outbox.attempt.graded')
  async onOutboxAttemptGraded(ev: { payload: { attempt_id: string; user_id: string; xp_earned: number; correct: number; total: number; mode: string } }): Promise<void> {
    await this.onAttemptGraded(ev.payload);
  }

  async recordAttemptXp(p: { attempt_id: string; user_id: string; xp_earned: number; mode: string }): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: learnXpEvents.id }).from(learnXpEvents).where(and(eq(learnXpEvents.refType, 'attempt'), eq(learnXpEvents.refId, p.attempt_id))).limit(1);
      if (dup) return;
      await tx.insert(learnXpEvents).values({ userId: p.user_id, kind: p.mode === 'exam' ? 'attempt_full_test_submitted' : 'attempt_submitted', amount: p.xp_earned, refType: 'attempt', refId: p.attempt_id });
      const today = localDate(new Date());
      const [s] = await tx.select().from(learnStreaks).where(eq(learnStreaks.userId, p.user_id)).for('update').limit(1);
      if (!s) {
        await tx.insert(learnStreaks).values({ userId: p.user_id, currentStreak: 1, longestStreak: 1, lastActiveDate: today, freezesUsed: 0 });
        await tx.insert(learnXpEvents).values({ userId: p.user_id, kind: 'streak_day', amount: XP_RULES.streak_day, refType: 'streak', refId: null });
      } else if (s.lastActiveDate !== today) {
        const yesterday = localDate(new Date(Date.now() - 86_400_000));
        const current = s.lastActiveDate === yesterday ? s.currentStreak + 1 : 1;
        await tx.update(learnStreaks).set({ currentStreak: current, longestStreak: Math.max(s.longestStreak, current), lastActiveDate: today, updatedAt: new Date() }).where(eq(learnStreaks.userId, p.user_id));
        await tx.insert(learnXpEvents).values({ userId: p.user_id, kind: 'streak_day', amount: XP_RULES.streak_day, refType: 'streak', refId: null });
        if (current === 7 || current === 30) await this.award(tx, p.user_id, `streak_${current}`);
      }
      await this.award(tx, p.user_id, 'first_attempt');
    });
  }

  private async award(tx: Parameters<Parameters<typeof this.dbs.db.transaction>[0]>[0], userId: string, code: string): Promise<void> {
    const [badge] = await tx.select({ code: learnBadges.code }).from(learnBadges).where(eq(learnBadges.code, code)).limit(1);
    if (!badge) return;
    await tx.insert(learnUserBadges).values({ userId, badgeCode: code }).onConflictDoNothing();
  }

  async stats(userId: string, program: string): Promise<Stats> {
    const [enrollment, attempts, streak, xpTotal, xpWeek] = await Promise.all([
      this.enrollments.get(userId, program as never),
      this.attempts.statsSource(userId, program),
      this.dbs.db.select().from(learnStreaks).where(eq(learnStreaks.userId, userId)).limit(1).then((r) => r[0] ?? null),
      this.dbs.db.select({ n: sql<number>`coalesce(sum(${learnXpEvents.amount}), 0)`.mapWith(Number) }).from(learnXpEvents).where(eq(learnXpEvents.userId, userId)).then((r) => r[0]?.n ?? 0),
      this.dbs.db
        .select({ n: sql<number>`coalesce(sum(${learnXpEvents.amount}), 0)`.mapWith(Number) })
        .from(learnXpEvents)
        .where(and(eq(learnXpEvents.userId, userId), gte(learnXpEvents.createdAt, new Date(Date.now() - 7 * 86_400_000))))
        .then((r) => r[0]?.n ?? 0),
    ]);
    const scored = attempts.filter((a) => a.scaled !== null);
    const latest = scored[0];
    const cutoff = Date.now() - 30 * 86_400_000;
    const trend = scored
      .filter((a) => a.submittedAt && a.submittedAt.getTime() >= cutoff)
      .map((a) => ({ date: a.submittedAt!.toISOString().slice(0, 10), score: Number(a.scaled) }))
      .reverse();
    const bySection: Record<string, { correct: number; total: number; accuracy: number }> = {};
    const byType: Record<string, { correct: number; total: number; accuracy: number }> = {};
    const bySkill: Record<string, { correct: number; total: number; accuracy: number }> = {};
    for (const a of attempts.slice(0, 30)) {
      const b = a.breakdown as { by_section?: Record<string, { correct: number; total: number }>; by_question_type?: Record<string, { correct: number; total: number }>; by_subskill?: Record<string, { correct: number; total: number }> } | null;
      const merge = (dst: Record<string, { correct: number; total: number; accuracy: number }>, src?: Record<string, { correct: number; total: number }>) => {
        for (const [k, v] of Object.entries(src ?? {})) {
          const cur = (dst[k] ??= { correct: 0, total: 0, accuracy: 0 });
          cur.correct += v.correct;
          cur.total += v.total;
          cur.accuracy = cur.total ? Math.round((cur.correct / cur.total) * 1000) / 10 : 0;
        }
      };
      merge(bySection, b?.by_section);
      merge(byType, b?.by_question_type);
      merge(bySkill, b?.by_subskill);
    }
    const weakest = Object.entries(bySkill)
      .filter(([, v]) => v.total >= 3)
      .sort((x, y) => x[1].accuracy - y[1].accuracy)
      .slice(0, 3)
      .map(([k]) => k);
    const weekSec = attempts.filter((a) => a.submittedAt && a.submittedAt.getTime() >= Date.now() - 7 * 86_400_000).reduce((n, a) => n + (a.timeSpentSec ?? 0), 0);
    return {
      program,
      current_estimate: latest ? Number(latest.scaled) : null,
      target: enrollment?.targetScore !== null && enrollment?.targetScore !== undefined ? Number(enrollment.targetScore) : null,
      trend_30d: trend,
      by_skill: bySkill,
      by_section: bySection,
      by_question_type: byType,
      weakest,
      streak: { current: streak?.currentStreak ?? 0, longest: streak?.longestStreak ?? 0, freeze_available: false },
      xp: { total: xpTotal, this_week: xpWeek },
      minutes_this_week: Math.round(weekSec / 60),
    };
  }


}
