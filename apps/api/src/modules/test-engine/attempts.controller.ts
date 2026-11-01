import { Controller, Get, Headers, HttpCode, Post, Put } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { attemptAnswersPutSchema, attemptCreateSchema, attemptEventSchema, attemptResultSchema, attemptReviewQuerySchema, attemptReviewSchema, type AttemptReviewQuery, attemptSchema, attemptSummarySchema, myAttemptsQuerySchema, pageSchema, practiceQuestionsQuerySchema, type AttemptAnswersPut, type AttemptCreate, type AttemptEvent } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { AttemptsService } from './attempts.service.js';

const attemptParam = z.object({ attemptId: z.uuid() });
// Query string: 'false'/'0' phải là false (z.coerce.boolean coi mọi chuỗi khác rỗng là true)

@ApiTags('Attempts')
@Controller()
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Post('attempts')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiZod({ body: attemptCreateSchema, responses: { 201: attemptSchema, 402: 'empty' } })
  create(@CurrentUser() user: AuthUser, @ZodBody(attemptCreateSchema) body: AttemptCreate, @Headers('idempotency-key') idem?: string) {
    return this.attempts.create(user.id, body, idem);
  }

  @Get('attempts/:attemptId')
  @ApiZod({ responses: { 200: attemptSchema } })
  get(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>) {
    return this.attempts.get(user.id, p.attemptId);
  }

  @Put('attempts/:attemptId/answers')
  @HttpCode(204)
  @ApiZod({ body: attemptAnswersPutSchema, responses: { 204: 'empty' } })
  async saveAnswers(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>, @ZodBody(attemptAnswersPutSchema) body: AttemptAnswersPut) {
    await this.attempts.saveAnswers(user.id, p.attemptId, body);
  }

  @Post('attempts/:attemptId/events')
  @HttpCode(202)
  @ApiZod({ body: attemptEventSchema, responses: { 202: 'empty' } })
  async event(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>, @ZodBody(attemptEventSchema) body: AttemptEvent) {
    await this.attempts.addEvent(user.id, p.attemptId, body);
    return { accepted: true };
  }

  @Post('attempts/:attemptId/submit')
  @HttpCode(200)
  @ApiZod({ responses: { 200: attemptResultSchema } })
  submit(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>) {
    return this.attempts.submit(user.id, p.attemptId);
  }

  @Get('attempts/:attemptId/result')
  @ApiZod({ responses: { 200: attemptResultSchema } })
  result(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>) {
    return this.attempts.result(user.id, p.attemptId);
  }

  @Get('attempts/:attemptId/review')
  @ApiZod({ query: attemptReviewQuerySchema, responses: { 200: attemptReviewSchema } })
  review(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>, @ZodQuery(attemptReviewQuerySchema) q: AttemptReviewQuery) {
    return this.attempts.review(user.id, p.attemptId, q);
  }

  @Get('me/attempts')
  @ApiZod({ query: myAttemptsQuerySchema, responses: { 200: pageSchema(attemptSummarySchema) } })
  mine(@CurrentUser() user: AuthUser, @ZodQuery(myAttemptsQuerySchema) q: z.infer<typeof myAttemptsQuerySchema>) {
    return this.attempts.listMine(user.id, q);
  }

  /** Theo OpenAPI: GET /practice/questions tạo attempt drill (201) */
  @Get('practice/questions')
  @HttpCode(201)
  @ApiZod({ query: practiceQuestionsQuerySchema, responses: { 201: attemptSchema } })
  practice(@CurrentUser() user: AuthUser, @ZodQuery(practiceQuestionsQuerySchema) q: z.infer<typeof practiceQuestionsQuerySchema>) {
    return this.attempts.practice(user.id, q);
  }
}
