import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { messageCreateSchema, messageSchema, pageSchema, threadCreateSchema, threadDetailSchema, threadSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ExamLocked } from '../../../shared/exam/exam-mode.js';
import { writeSse } from '../../../shared/http/sse.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../../shared/http/zod.js';
import { ThreadsService } from './threads.service.js';

const threadParam = z.object({ threadId: z.uuid() });
const listQuery = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
const detailQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const messagesQuery = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

/** Gia sư AI /ai/threads* (S6) – toàn bộ bị khoá khi đang thi (attempt exam in_progress → 403 exam_mode_locked) */
@ApiTags('AI')
@Controller('ai/threads')
@ExamLocked()
export class TutorController {
  constructor(private readonly threads: ThreadsService) {}

  @Get()
  @ApiZod({ query: listQuery, responses: { 200: pageSchema(threadSchema) } })
  list(@CurrentUser() user: AuthUser, @ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.threads.list(user.id, q.cursor, q.limit);
  }

  @Post()
  @HttpCode(201)
  @ApiZod({ body: threadCreateSchema, responses: { 201: threadSchema, 400: 'empty', 404: 'empty' } })
  create(@CurrentUser() user: AuthUser, @ZodBody(threadCreateSchema) body: z.infer<typeof threadCreateSchema>) {
    return this.threads.create(user.id, body);
  }

  @Get(':threadId')
  @ApiZod({ query: detailQuery, responses: { 200: threadDetailSchema, 404: 'empty' } })
  detail(@CurrentUser() user: AuthUser, @ZodParams(threadParam) p: z.infer<typeof threadParam>, @ZodQuery(detailQuery) q: z.infer<typeof detailQuery>) {
    return this.threads.detail(user.id, p.threadId, q.limit);
  }

  @Get(':threadId/messages')
  @ApiZod({ query: messagesQuery, responses: { 200: pageSchema(messageSchema), 404: 'empty' } })
  messages(@CurrentUser() user: AuthUser, @ZodParams(threadParam) p: z.infer<typeof threadParam>, @ZodQuery(messagesQuery) q: z.infer<typeof messagesQuery>) {
    return this.threads.messages(user.id, p.threadId, q.cursor, q.limit);
  }

  @Post(':threadId/messages')
  @HttpCode(200)
  @ApiZod({ body: messageCreateSchema, responses: { 200: 'sse', 400: 'empty', 402: 'empty', 404: 'empty', 429: 'empty' } })
  async send(@CurrentUser() user: AuthUser, @ZodParams(threadParam) p: z.infer<typeof threadParam>, @ZodBody(messageCreateSchema) body: z.infer<typeof messageCreateSchema>, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const events = await this.threads.send(user.id, p.threadId, body, (req as FastifyRequest & { traceId?: string }).traceId);
    await writeSse(reply, events, req);
  }
}
