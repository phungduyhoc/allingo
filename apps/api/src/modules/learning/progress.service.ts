import { Injectable } from '@nestjs/common';
import type { Stats } from '@allingo/schemas';
import { EnrollmentsService } from '../iam/index.js';
import { AttemptsService } from '../test-engine/index.js';
import { GamificationService } from './gamification/gamification.service.js';
import { PlanService } from './plan/plan.service.js';

/**
 * Thống kê dashboard (GET /me/stats – một phần theo spec). S9: XP/chuỗi/huy hiệu chuyển sang GamificationService (chuỗi theo
 * múi giờ người học, đóng băng Pro, rule engine huy hiệu trên outbox); thêm tóm tắt lộ trình. Dashboard đầy đủ ở Sprint 10.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly enrollments: EnrollmentsService,
    private readonly attempts: AttemptsService,
    private readonly gamification: GamificationService,
    private readonly plans: PlanService,
  ) {}

  async stats(userId: string, program: string): Promise<Stats> {
    const [enrollment, attempts, streak, xp, badges, plan] = await Promise.all([
      this.enrollments.get(userId, program as never),
      this.attempts.statsSource(userId, program),
      this.gamification.streakView(userId, program),
      this.gamification.xpSummary(userId),
      this.gamification.latestBadges(userId),
      this.plans.summary(userId, program).catch(() => null),
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
      streak: { current: streak.current, longest: streak.longest, freeze_available: streak.freeze_available, at_risk: streak.at_risk, last_active_date: streak.last_active_date, freezes_used: streak.freezes_used },
      xp: { total: xp.total, this_week: xp.this_week, today: xp.today, level: xp.level, next_level_at: xp.next_level_at },
      minutes_this_week: Math.round(weekSec / 60),
      badges,
      plan,
    };
  }
}
