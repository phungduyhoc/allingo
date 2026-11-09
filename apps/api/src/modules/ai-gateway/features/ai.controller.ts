import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { aiFeedbackInputSchema, explainInputSchema, explanationSchema, type ExplainInput } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody } from '../../../shared/http/zod.js';
import { ExamLocked } from '../../../shared/exam/exam-mode.js';
import { writeSse } from '../../../shared/http/sse.js';
import { ExplainService } from './explain.service.js';
import { FeedbackService } from './feedback.service.js';
import { RateLimit } from '../../../shared/http/rate-limit.js';
import { KillSwitch } from '../../billing/index.js';

export { writeSse };

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(
    private readonly explain: ExplainService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @Post('explain')
  @HttpCode(200)
  @ExamLocked()
  @KillSwitch('ff.ai.explain')
  @RateLimit('explain')
  @ApiZod({ body: explainInputSchema, responses: { 200: explanationSchema, 402: 'empty', 403: 'empty', 429: 'empty' } })
  async explainQuestion(@CurrentUser() user: AuthUser, @ZodBody(explainInputSchema) body: ExplainInput, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const r = await this.explain.explain({ userId: user.id, questionVersionId: body.question_version_id, chosenOption: body.chosen_option ?? null, attemptId: body.attempt_id ?? null, answer: body.answer ?? null, traceId: (req as FastifyRequest & { traceId?: string }).traceId });
    // JSON khi cache hit; SSE (start → delta* → result → done | error → done) khi sinh mới
    if (r.kind === 'json') return reply.status(200).send(r.explanation);
    await writeSse(reply, r.events, req);
  }

  /** 👍/👎 + lý do cho kết quả AI – chỉ chủ tác vụ (403 nếu không phải, 404 nếu không có); gửi lại → cập nhật (S5) */
  @Post('feedback')
  @HttpCode(201)
  @ApiZod({ body: aiFeedbackInputSchema, responses: { 201: 'empty', 403: 'empty', 404: 'empty' } })
  async feedback(@CurrentUser() user: AuthUser, @ZodBody(aiFeedbackInputSchema) body: z.infer<typeof aiFeedbackInputSchema>) {
    const r = await this.feedbackService.submit(user.id, body);
    return { ok: true, ...r };
  }
}
