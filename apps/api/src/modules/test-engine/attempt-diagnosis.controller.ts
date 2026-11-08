import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { attemptAiDiagnosisSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { writeSse } from '../../shared/http/sse.js';
import { ApiZod, ZodParams } from '../../shared/http/zod.js';
import { KillSwitch } from '../billing/index.js';
import { AttemptDiagnosisService } from './attempt-diagnosis.service.js';

const attemptParam = z.object({ attemptId: z.uuid() });

/** Ask AI trên kết quả R/L (OpenAPI tag AI): POST stream SSE, GET đọc lại kết quả đã lưu (v1.1 – Sprint 5) */
@ApiTags('AI')
@Controller('attempts')
export class AttemptDiagnosisController {
  constructor(private readonly diagnosis: AttemptDiagnosisService) {}

  @Post(':attemptId/diagnosis')
  @HttpCode(200)
  @KillSwitch('ff.ai.diagnose')
  @ApiZod({ responses: { 200: 'sse', 402: 'empty', 403: 'empty', 404: 'empty', 409: 'empty' } })
  async diagnose(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const events = await this.diagnosis.diagnose(user.id, p.attemptId, (req as FastifyRequest & { traceId?: string }).traceId);
    await writeSse(reply, events, req);
  }

  @Get(':attemptId/diagnosis')
  @ApiZod({ responses: { 200: attemptAiDiagnosisSchema, 404: 'empty' } })
  get(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>) {
    return this.diagnosis.get(user.id, p.attemptId);
  }
}
