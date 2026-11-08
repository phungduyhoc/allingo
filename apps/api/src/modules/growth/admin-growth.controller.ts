import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JOB_NAMES, BETA_INVITE_STATUSES, FEEDBACK_STATUSES, SUPPORT_PRIORITIES, SUPPORT_STATUSES, WAITLIST_PROGRAMS, adminBetaInviteCreateResultSchema, adminBetaInviteCreateSchema, adminBetaInviteSchema, adminBetaInviteSendInputSchema, adminBetaInvitesPageSchema, adminFeedbackItemSchema, adminFeedbackPageSchema, adminSupportReplyResultSchema, adminSupportTicketSchema, adminSupportTicketsPageSchema, adminWaitlistPageSchema, adminBetaInviteSendResultSchema, adminSupportPatchSchema, adminSupportReplySchema, type AdminBetaInviteCreate, type AdminBetaInviteSendInput, type BetaInviteSendSummary } from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery, ZodValidationPipe } from '../../shared/http/zod.js';
import { BetaService } from './beta/beta.service.js';
import { FeedbackService } from './support/feedback.service.js';
import { SupportService } from './support/support.service.js';

const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());
const page = { cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) };
const waitlistQuery = z.object({ program: z.enum(WAITLIST_PROGRAMS).optional(), status: z.enum(['waiting', 'invited', 'joined', 'removed']).optional(), ...page });
const invitesQuery = z.object({ status: z.enum(BETA_INVITE_STATUSES).optional(), batch: z.string().max(64).optional(), ...page });
const feedbackQuery = z.object({ status: z.enum(FEEDBACK_STATUSES).optional(), category: z.string().max(32).optional(), ...page });
const ticketsQuery = z.object({ status: z.enum(SUPPORT_STATUSES).optional(), priority: z.enum(SUPPORT_PRIORITIES).optional(), category: z.string().max(32).optional(), overdue: boolish, user_id: z.uuid().optional(), q: z.string().max(100).optional(), ...page });
const inviteParam = z.object({ inviteId: z.uuid() });
const feedbackParam = z.object({ feedbackId: z.uuid() });
const ticketParam = z.object({ ticketId: z.uuid() });
const feedbackPatch = z.object({ status: z.enum(FEEDBACK_STATUSES) });

function meta(req: FastifyRequest) {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

/** Admin beta kín, góp ý, hỗ trợ (S12) – vai trò admin/superadmin (MFA step-up khi bắt buộc) */
@ApiTags('Admin')
@Controller('admin')
@Roles('admin', 'superadmin')
export class AdminGrowthController {
  constructor(
    private readonly beta: BetaService,
    private readonly feedback: FeedbackService,
    private readonly support: SupportService,
    private readonly jobs: JobsService,
  ) {}

  @Get('beta/waitlist')
  @ApiZod({ query: waitlistQuery, responses: { 200: adminWaitlistPageSchema } })
  waitlist(@ZodQuery(waitlistQuery) q: z.infer<typeof waitlistQuery>) {
    return this.beta.listWaitlist(q);
  }

  @Get('beta/invites')
  @ApiZod({ query: invitesQuery, responses: { 200: adminBetaInvitesPageSchema } })
  invites(@ZodQuery(invitesQuery) q: z.infer<typeof invitesQuery>) {
    return this.beta.listInvites(q);
  }

  @Post('beta/invites')
  @HttpCode(201)
  @ApiZod({ body: adminBetaInviteCreateSchema, responses: { 201: adminBetaInviteCreateResultSchema, 400: 'empty' } })
  createInvites(@CurrentUser() user: AuthUser, @ZodBody(adminBetaInviteCreateSchema) body: AdminBetaInviteCreate, @Req() req: FastifyRequest) {
    return this.beta.createInvites(user, body, meta(req));
  }

  /**
   * Chạy ngay job gửi mời (tôn trọng hạn mức ngày). B6/S147: `invite_ids`/`batch` chọn lô; không truyền → mọi lời mời đang xếp hàng.
   * Inline → chờ tối đa 10 s để trả kết quả
   */
  @Post('beta/invites/send')
  @HttpCode(202)
  @ApiZod({ body: adminBetaInviteSendInputSchema, responses: { 202: adminBetaInviteSendResultSchema, 400: 'empty' } })
  async send(@Body(new ZodValidationPipe(adminBetaInviteSendInputSchema)) body: AdminBetaInviteSendInput): Promise<z.infer<typeof adminBetaInviteSendResultSchema>> {
    const r = await this.jobs.dispatch('notify', JOB_NAMES.BETA_INVITES_SEND, `manual-${Date.now()}`, { limit: body.limit ?? null, invite_ids: body.invite_ids ?? null, batch: body.batch ?? null });
    const result = r.done ? await Promise.race([r.done, new Promise((res) => setTimeout(() => res(null), 10_000))]).catch(() => null) : null;
    return { job_id: r.jobId, mode: r.mode, result: (result as BetaInviteSendSummary | null) ?? null };
  }

  @Post('beta/invites/:inviteId/revoke')
  @HttpCode(200)
  @ApiZod({ responses: { 200: adminBetaInviteSchema, 404: 'empty', 409: 'empty' } })
  revoke(@CurrentUser() user: AuthUser, @ZodParams(inviteParam) p: z.infer<typeof inviteParam>) {
    return this.beta.revokeInvite(user, p.inviteId);
  }

  @Get('feedback')
  @ApiZod({ query: feedbackQuery, responses: { 200: adminFeedbackPageSchema } })
  listFeedback(@ZodQuery(feedbackQuery) q: z.infer<typeof feedbackQuery>) {
    return this.feedback.list(q);
  }

  @Patch('feedback/:feedbackId')
  @ApiZod({ body: feedbackPatch, responses: { 200: adminFeedbackItemSchema, 404: 'empty' } })
  patchFeedback(@CurrentUser() user: AuthUser, @ZodParams(feedbackParam) p: z.infer<typeof feedbackParam>, @ZodBody(feedbackPatch) body: z.infer<typeof feedbackPatch>) {
    return this.feedback.setStatus(user, p.feedbackId, body.status);
  }

  @Get('support/tickets')
  @ApiZod({ query: ticketsQuery, responses: { 200: adminSupportTicketsPageSchema } })
  tickets(@ZodQuery(ticketsQuery) q: z.infer<typeof ticketsQuery>) {
    return this.support.adminList(q);
  }

  @Get('support/tickets/:ticketId')
  @ApiZod({ responses: { 200: adminSupportTicketSchema, 404: 'empty' } })
  ticket(@ZodParams(ticketParam) p: z.infer<typeof ticketParam>) {
    return this.support.adminGet(p.ticketId);
  }

  @Patch('support/tickets/:ticketId')
  @ApiZod({ body: adminSupportPatchSchema, responses: { 200: adminSupportTicketSchema, 404: 'empty' } })
  patchTicket(@CurrentUser() user: AuthUser, @ZodParams(ticketParam) p: z.infer<typeof ticketParam>, @ZodBody(adminSupportPatchSchema) body: z.infer<typeof adminSupportPatchSchema>) {
    return this.support.adminPatch(user, p.ticketId, body);
  }

  @Post('support/tickets/:ticketId/messages')
  @HttpCode(201)
  @ApiZod({ body: adminSupportReplySchema, responses: { 201: adminSupportReplyResultSchema, 404: 'empty', 409: 'empty' } })
  reply(@CurrentUser() user: AuthUser, @ZodParams(ticketParam) p: z.infer<typeof ticketParam>, @ZodBody(adminSupportReplySchema) body: z.infer<typeof adminSupportReplySchema>, @Req() req: FastifyRequest) {
    return this.support.adminReply(user, p.ticketId, body, meta(req));
  }
}
