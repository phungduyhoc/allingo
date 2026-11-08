import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { betaSurveyInputSchema, cursorQuerySchema, feedbackCreatedSchema, feedbackInputSchema, npsInputSchema, pageSchema, pendingSurveysSchema, supportMessageInputSchema, supportTicketInputSchema, supportTicketSchema, surveyResponseSchema, type BetaSurveyInput, type FeedbackInput, type SupportTicketInput } from '@allingo/schemas';
import { BetaExempt, CurrentUser, type AuthedRequest, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { RateLimit } from '../../../shared/http/rate-limit.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../../shared/http/zod.js';
import { currentTraceId } from '../../../shared/telemetry/request-context.js';
import { FeedbackService } from './feedback.service.js';
import { SupportService } from './support.service.js';
import { SurveysService } from './surveys.service.js';

const ticketParam = z.object({ ticketId: z.uuid() });

function traceOf(req: AuthedRequest): string {
  return req.traceId ?? currentTraceId() ?? 'unknown';
}

/** Góp ý, ticket hỗ trợ, khảo sát onboarding beta + NPS (S12) */
@ApiTags('Growth')
@Controller()
export class SupportController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly support: SupportService,
    private readonly surveys: SurveysService,
  ) {}

  /** B6/S150: miễn beta gate – người chưa có quyền beta (đang ở /beta) vẫn gửi góp ý được (ảnh màn hình vẫn qua presign có gate) */
  @BetaExempt()
  @Post('feedback')
  @HttpCode(201)
  @RateLimit('feedback')
  @ApiZod({ body: feedbackInputSchema, responses: { 201: feedbackCreatedSchema, 404: 'empty', 429: 'empty' } })
  createFeedback(@CurrentUser() user: AuthUser, @ZodBody(feedbackInputSchema) body: FeedbackInput, @Req() req: AuthedRequest) {
    const locale = (req.headers['accept-language'] ?? '').toString().slice(0, 5) || null;
    return this.feedback.create(user, body, { traceId: traceOf(req), userAgent: req.headers['user-agent'] ?? null, locale });
  }

  @BetaExempt()
  @Post('support/tickets')
  @HttpCode(201)
  @RateLimit('support')
  @ApiZod({ body: supportTicketInputSchema, responses: { 201: supportTicketSchema, 429: 'empty' } })
  createTicket(@CurrentUser() user: AuthUser, @ZodBody(supportTicketInputSchema) body: SupportTicketInput, @Req() req: AuthedRequest) {
    return this.support.create(user, body, { traceId: traceOf(req), userAgent: req.headers['user-agent'] ?? null });
  }

  @BetaExempt()
  @Get('me/support/tickets')
  @ApiZod({ query: cursorQuerySchema, responses: { 200: pageSchema(supportTicketSchema) } })
  myTickets(@CurrentUser() user: AuthUser, @ZodQuery(cursorQuerySchema) q: z.infer<typeof cursorQuerySchema>) {
    return this.support.listMine(user.id, q);
  }

  @BetaExempt()
  @Get('me/support/tickets/:ticketId')
  @ApiZod({ responses: { 200: supportTicketSchema, 404: 'empty' } })
  myTicket(@CurrentUser() user: AuthUser, @ZodParams(ticketParam) p: z.infer<typeof ticketParam>) {
    return this.support.getMine(user.id, p.ticketId);
  }

  @BetaExempt()
  @Post('support/tickets/:ticketId/messages')
  @HttpCode(201)
  @RateLimit('feedback')
  @ApiZod({ body: supportMessageInputSchema, responses: { 201: supportTicketSchema, 404: 'empty', 409: 'empty' } })
  reply(@CurrentUser() user: AuthUser, @ZodParams(ticketParam) p: z.infer<typeof ticketParam>, @ZodBody(supportMessageInputSchema) body: z.infer<typeof supportMessageInputSchema>) {
    return this.support.userReply(user.id, p.ticketId, body.message);
  }

  @Post('me/beta-survey')
  @HttpCode(200)
  @ApiZod({ body: betaSurveyInputSchema, responses: { 200: surveyResponseSchema } })
  betaSurvey(@CurrentUser() user: AuthUser, @ZodBody(betaSurveyInputSchema) body: BetaSurveyInput) {
    return this.surveys.submitBetaSurvey(user, body);
  }

  @Get('me/surveys/pending')
  @ApiZod({ responses: { 200: pendingSurveysSchema } })
  pending(@CurrentUser() user: AuthUser) {
    return this.surveys.pending(user);
  }

  @Post('me/surveys/nps')
  @HttpCode(200)
  @ApiZod({ body: npsInputSchema, responses: { 200: surveyResponseSchema, 409: 'empty' } })
  nps(@CurrentUser() user: AuthUser, @ZodBody(npsInputSchema) body: z.infer<typeof npsInputSchema>) {
    return this.surveys.submitNps(user, body);
  }
}
