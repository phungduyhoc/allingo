import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { programCodeSchema, statsSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodQuery } from '../../shared/http/zod.js';
import { ProgressService } from './progress.service.js';

const programQuery = z.object({ program: programCodeSchema.default('toeic') });

@ApiTags('Learning')
@Controller('me')
export class LearningController {
  constructor(private readonly progress: ProgressService) {}

  @Get('stats')
  @ApiZod({ query: programQuery, responses: { 200: statsSchema } })
  stats(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.progress.stats(user.id, q.program);
  }
}
