import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { addDays, localDate, zonedDayStart } from '@allingo/planner';
import { SCALE_INFO } from '@allingo/scoring';
import { scaledPartsOf, scorePartOf, type Forecast, type ProgramCode } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { EnrollmentsService, UsersService } from '../../iam/index.js';
import { AttemptsService } from '../../test-engine/index.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { FORECAST_MODEL_VERSION, forecastLinear, recommendationText } from './forecast.js';

const { learnScoreForecasts } = schema;
/** Cửa sổ dữ liệu điểm (ngày) */
export const FORECAST_WINDOW_DAYS = 120;
/** Không có ngày thi → dự báo +30 ngày */
export const FORECAST_DEFAULT_HORIZON_DAYS = 30;

/**
 * GET /me/forecast v0 (S10): điểm ước tính từ bài có thang (`attempts.scaled_score`, mode khác drill/timed_drill) 120 ngày →
 * `forecastLinear`; lưu learn.score_forecasts tối đa 1 lần/ngày (theo giờ người học) để theo dõi dự báo theo thời gian.
 */
@Injectable()
export class ForecastService {
  constructor(
    private readonly dbs: DbService,
    private readonly attempts: AttemptsService,
    private readonly enrollments: EnrollmentsService,
    private readonly users: UsersService,
    private readonly gamification: GamificationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async forecast(userId: string, program: ProgramCode): Promise<Forecast> {
    const now = this.clock.now();
    const [enrollment, history, user, tz] = await Promise.all([this.enrollments.get(userId, program), this.attempts.statsSource(userId, program), this.users.findById(userId), this.gamification.timezoneOf(userId)]);
    const scale = SCALE_INFO[program];
    const since = now - FORECAST_WINDOW_DAYS * 86_400_000;
    const points = history
      // S12 (fix web S10): chỉ điểm thang tổng (mini một kỹ năng 5–495 không trộn vào dự báo 10–990)
      // C3: IELTS – chỉ overall (đủ 4 kỹ năng); band một kỹ năng không trộn vào dự báo overall
      .filter((a) => a.scaled !== null && a.submittedAt && a.submittedAt.getTime() >= since && a.mode !== 'drill' && a.mode !== 'timed_drill' && scorePartOf(scaledPartsOf(a.breakdown as Parameters<typeof scaledPartsOf>[0])) === 'total')
      .map((a) => ({ at: a.submittedAt!.getTime(), score: Number(a.scaled) }));
    const today = localDate(now, tz);
    const examDate = enrollment?.examDate && enrollment.examDate > today ? enrollment.examDate : null;
    const horizonDate = examDate ?? addDays(today, FORECAST_DEFAULT_HORIZON_DAYS);
    const target = enrollment?.targetScore !== null && enrollment?.targetScore !== undefined ? Number(enrollment.targetScore) : null;
    const out = forecastLinear({ points, now, horizon: zonedDayStart(horizonDate, tz).getTime(), target, examDate: examDate ? zonedDayStart(examDate, tz).getTime() : null, scale: { min: scale.min, max: scale.max } });
    const computedAt = new Date(now);
    if (enrollment && out.predicted !== null) await this.persistDaily(enrollment.id, out, tz, computedAt).catch(() => undefined);
    return {
      predicted_score: out.predicted,
      ci_low: out.ciLow,
      ci_high: out.ciHigh,
      ready_date: out.readyAt !== null ? localDate(out.readyAt, tz) : null,
      on_track: out.onTrack,
      recommendation_code: out.recommendation,
      recommendation: recommendationText(out.recommendation, user?.uiLocale ?? 'vi'),
      computed_at: computedAt.toISOString(),
      status: out.status,
      label: 'preliminary_estimate',
      model_version: FORECAST_MODEL_VERSION,
      current_estimate: out.current,
      target,
      exam_date: examDate,
      horizon_date: horizonDate,
      slope_per_week: out.slopePerWeek,
      points_used: out.pointsUsed,
      scale: { min: scale.min, max: scale.max },
    };
  }

  /** Một hàng learn.score_forecasts/ngày (giờ người học) – lần tính sau trong ngày cập nhật hàng đó */
  private async persistDaily(enrollmentId: string, out: ReturnType<typeof forecastLinear>, tz: string, at: Date): Promise<void> {
    const dayStart = zonedDayStart(localDate(at, tz), tz);
    const [last] = await this.dbs.db.select().from(learnScoreForecasts).where(eq(learnScoreForecasts.enrollmentId, enrollmentId)).orderBy(desc(learnScoreForecasts.computedAt)).limit(1);
    const values = { predictedScore: String(out.predicted), ciLow: out.ciLow !== null ? String(out.ciLow) : null, ciHigh: out.ciHigh !== null ? String(out.ciHigh) : null, readyDate: out.readyAt !== null ? localDate(out.readyAt, tz) : null, modelVersion: FORECAST_MODEL_VERSION, computedAt: at };
    if (last && last.computedAt >= dayStart) await this.dbs.db.update(learnScoreForecasts).set(values).where(and(eq(learnScoreForecasts.id, last.id)));
    else await this.dbs.db.insert(learnScoreForecasts).values({ enrollmentId, ...values });
  }
}
