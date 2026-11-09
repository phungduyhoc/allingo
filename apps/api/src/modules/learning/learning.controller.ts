import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DEFAULT_PROGRAM, badgeListSchema, forecastSchema, programCodeSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodQuery } from '../../shared/http/zod.js';
import { ForecastService } from './forecast/forecast.service.js';
import { GamificationService } from './gamification/gamification.service.js';

const programQuery = z.object({ program: programCodeSchema.default(DEFAULT_PROGRAM) });

/** GET /me/badges (S9), GET /me/forecast (S10 v0). GET /me/stats chuyển sang module analytics (đọc replica, cache) ở S10. */
@ApiTags('Learning')
@Controller('me')
export class LearningController {
  constructor(
    private readonly gamification: GamificationService,
    private readonly forecasts: ForecastService,
  ) {}

  /** Huy hiệu: tất cả + đã đạt + tiến độ (v1.1 – S9) */
  @Get('badges')
  @ApiZod({ query: programQuery, responses: { 200: badgeListSchema } })
  badges(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.gamification.badges(user.id, q.program);
  }

  /** Dự báo điểm v0 – hồi quy tuyến tính, "ước tính sơ bộ" (v1.1 – S10) */
  @Get('forecast')
  @ApiZod({ query: programQuery, responses: { 200: forecastSchema } })
  forecast(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.forecasts.forecast(user.id, q.program);
  }
}
