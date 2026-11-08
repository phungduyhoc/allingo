import { Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { consentInputSchema, consentSchema, deletionRequestResultSchema, enrollmentInputSchema, enrollmentSchema, programCodeSchema, sessionSchema, userSchema, userUpdateSchema, type EnrollmentInput, type UserUpdate } from '@allingo/schemas';
import { BetaExempt, CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { NotFound } from '../../shared/http/errors.js';
import { ApiZod, ZodBody, ZodParams } from '../../shared/http/zod.js';
import { ConsentsService } from './consents.service.js';
import { DeletionService } from './deletion.service.js';
import { EnrollmentsService } from './enrollments.service.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

const programParam = z.object({ program: programCodeSchema });
const sessionParam = z.object({ sessionId: z.uuid() });

@ApiTags('Me')
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly enrollments: EnrollmentsService,
    private readonly sessions: SessionsService,
    private readonly consents: ConsentsService,
    private readonly deletion: DeletionService,
  ) {}

  @BetaExempt()
  @Get()
  @ApiZod({ responses: { 200: userSchema } })
  async me(@CurrentUser() user: AuthUser) {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFound('user', user.id);
    return this.users.toDto(row);
  }

  @BetaExempt()
  @Patch()
  @ApiZod({ body: userUpdateSchema, responses: { 200: userSchema } })
  async update(@CurrentUser() user: AuthUser, @ZodBody(userUpdateSchema) body: UserUpdate) {
    const patch: Record<string, unknown> = {};
    if (body.display_name !== undefined) patch.displayName = body.display_name;
    if (body.avatar_url !== undefined) patch.avatarUrl = body.avatar_url;
    if (body.ui_locale !== undefined) patch.uiLocale = body.ui_locale;
    if (body.explain_locale !== undefined) patch.explainLocale = body.explain_locale;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    const row = Object.keys(patch).length ? await this.users.update(user.id, patch) : await this.users.findById(user.id);
    if (!row) throw new NotFound('user', user.id);
    if (body.active_program) await this.enrollments.upsert(user.id, { program: body.active_program });
    return this.users.toDto(row);
  }

  @BetaExempt()
  @Delete()
  @HttpCode(202)
  @ApiZod({ responses: { 202: deletionRequestResultSchema, 409: 'empty' } })
  async requestDeletion(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    const r = await this.deletion.request(user.id, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
    return { status: 'scheduled' as const, due_at: r.due_at, request_id: r.request_id };
  }

  @BetaExempt()
  @Get('sessions')
  @ApiZod({ responses: { 200: z.array(sessionSchema) } })
  listSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.id, user.sessionId);
  }

  @BetaExempt()
  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiZod({ responses: { 204: 'empty' } })
  async revokeSession(@CurrentUser() user: AuthUser, @ZodParams(sessionParam) params: { sessionId: string }) {
    await this.sessions.revoke(params.sessionId, user.id);
  }

  @BetaExempt()
  @Get('consents')
  @ApiZod({ responses: { 200: z.array(consentSchema) } })
  listConsents(@CurrentUser() user: AuthUser) {
    return this.consents.list(user.id);
  }

  @BetaExempt()
  @Post('consents')
  @HttpCode(200)
  @ApiZod({ body: consentInputSchema, responses: { 200: consentSchema } })
  consent(@CurrentUser() user: AuthUser, @ZodBody(consentInputSchema) body: z.infer<typeof consentInputSchema>, @Req() req: FastifyRequest) {
    return this.consents.set(user.id, { type: body.type, granted: body.granted, version: body.version, ip: req.ip ?? null });
  }

  @Get('enrollments')
  @ApiZod({ responses: { 200: z.array(enrollmentSchema) } })
  listEnrollments(@CurrentUser() user: AuthUser) {
    return this.enrollments.list(user.id);
  }

  @Post('enrollments')
  @HttpCode(201)
  @ApiZod({ body: enrollmentInputSchema, responses: { 201: enrollmentSchema } })
  createEnrollment(@CurrentUser() user: AuthUser, @ZodBody(enrollmentInputSchema) body: EnrollmentInput) {
    return this.enrollments.upsert(user.id, body);
  }

  @Patch('enrollments/:program')
  @ApiZod({ body: enrollmentInputSchema.partial(), responses: { 200: enrollmentSchema } })
  patchEnrollment(@CurrentUser() user: AuthUser, @ZodParams(programParam) params: z.infer<typeof programParam>, @ZodBody(enrollmentInputSchema.partial()) body: Partial<EnrollmentInput>) {
    return this.enrollments.patch(user.id, params.program, { ...body, program: params.program });
  }
}


