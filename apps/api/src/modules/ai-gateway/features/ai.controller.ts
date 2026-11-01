import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { aiFeedbackInputSchema, explainInputSchema, explanationSchema, messageCreateSchema, messageSchema, pageSchema, threadCreateSchema, threadSchema, type ExplainInput } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../../shared/http/zod.js';
import { writeSse } from '../../../shared/http/sse.js';
import { ExplainService } from './explain.service.js';
import { FeedbackService } from './feedback.service.js';
import { ThreadsService } from './threads.service.js';

const threadParam = z.object({ threadId: z.uuid() });
const listQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export { writeSse };

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(
    private readonly explain: ExplainService,
    private readonly threads: ThreadsService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @Post('explain')
  @HttpCode(200)
  @ApiZod({ body: explainInputSchema, responses: { 200: explanationSchema, 402: 'empty', 403: 'empty', 429: 'empty' } })
  async explainQuestion(@CurrentUser() user: AuthUser, @ZodBody(explainInputSchema) body: ExplainInput, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const r = await this.explain.explain({ userId: user.id, questionVersionId: body.question_version_id, chosenOption: body.chosen_option ?? null, attemptId: body.attempt_id ?? null, traceId: (req as FastifyRequest & { traceId?: string }).traceId });
    // JSON khi cache hit; SSE (start → delta* → result → done | error → done) khi sinh mới
    if (r.kind === 'json') return reply.status(200).send(r.explanation);
    await writeSse(reply, r.events, req);
  }

  @Get('threads')
  @ApiZod({ query: listQuery, responses: { 200: pageSchema(threadSchema) } })
  listThreads(@CurrentUser() user: AuthUser, @ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.threads.list(user.id, q.cursor, q.limit);
  }

  @Post('threads')
  @HttpCode(201)
  @ApiZod({ body: threadCreateSchema, responses: { 201: threadSchema } })
  createThread(@CurrentUser() user: AuthUser, @ZodBody(threadCreateSchema) body: z.infer<typeof threadCreateSchema>) {
    return this.threads.create(user.id, body);
  }

  @Get('threads/:threadId/messages')
  @ApiZod({ responses: { 200: pageSchema(messageSchema) } })
  listMessages(@CurrentUser() user: AuthUser, @ZodParams(threadParam) p: z.infer<typeof threadParam>) {
    return this.threads.messages(user.id, p.threadId);
  }

  @Post('threads/:threadId/messages')
  @HttpCode(200)
  @ApiZod({ body: messageCreateSchema, responses: { 200: 'sse', 402: 'empty' } })
  async sendMessage(@CurrentUser() user: AuthUser, @ZodParams(threadParam) p: z.infer<typeof threadParam>, @ZodBody(messageCreateSchema) body: z.infer<typeof messageCreateSchema>, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const events = await this.threads.send(user.id, p.threadId, body, (req as FastifyRequest & { traceId?: string }).traceId);
    await writeSse(reply, events, req);
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
