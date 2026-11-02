import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { badgeListSchema, programCodeSchema, statsSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodQuery } from '../../shared/http/zod.js';
import { GamificationService } from './gamification/gamification.service.js';
import { ProgressService } from './progress.service.js';

const programQuery = z.object({ program: programCodeSchema.default('toeic') });

@ApiTags('Learning')
@Controller('me')
export class LearningController {
  constructor(
    private readonly progress: ProgressService,
    private readonly gamification: GamificationService,
  ) {}

  @Get('stats')
  @ApiZod({ query: programQuery, responses: { 200: statsSchema } })
  stats(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.progress.stats(user.id, q.program);
  }

  /** Huy hiệu: tất cả + đã đạt + tiến độ (v1.1 – S9) */
  @Get('badges')
  @ApiZod({ query: programQuery, responses: { 200: badgeListSchema } })
  badges(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.gamification.badges(user.id, q.program);
  }
}
