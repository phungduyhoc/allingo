import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { consentInputSchema, consentSchema, enrollmentInputSchema, enrollmentSchema, programCodeSchema, sessionSchema, userSchema, userUpdateSchema, type EnrollmentInput, type UserUpdate } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { DbService } from '../../shared/db/db.module.js';
import { NotFound } from '../../shared/http/errors.js';
import { ApiZod, ZodBody, ZodParams } from '../../shared/http/zod.js';
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
    private readonly dbs: DbService,
  ) {}

  @Get()
  @ApiZod({ responses: { 200: userSchema } })
  async me(@CurrentUser() user: AuthUser) {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFound('user', user.id);
    return this.users.toDto(row);
  }

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

  @Delete()
  @HttpCode(202)
  @ApiZod({ responses: { 202: 'empty' } })
  async requestDeletion(@CurrentUser() user: AuthUser) {
    await this.users.requestDeletion(user.id);
    return { status: 'scheduled', due_in_hours: 72 };
  }

  @Get('sessions')
  @ApiZod({ responses: { 200: z.array(sessionSchema) } })
  listSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.id, user.sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiZod({ responses: { 204: 'empty' } })
  async revokeSession(@CurrentUser() user: AuthUser, @ZodParams(sessionParam) params: { sessionId: string }) {
    await this.sessions.revoke(params.sessionId, user.id);
  }

  @Get('consents')
  @ApiZod({ responses: { 200: z.array(consentSchema) } })
  async consents(@CurrentUser() user: AuthUser) {
    const rows = await this.dbs.db.select().from(schema.iamConsents).where(eq(schema.iamConsents.userId, user.id)).orderBy(desc(schema.iamConsents.grantedAt));
    return rows.map((r) => ({ type: r.type, version: r.version, granted_at: r.grantedAt.toISOString(), revoked_at: r.revokedAt?.toISOString() ?? null }));
  }

  @Post('consents')
  @HttpCode(200)
  @ApiZod({ body: consentInputSchema, responses: { 200: consentSchema } })
  async consent(@CurrentUser() user: AuthUser, @ZodBody(consentInputSchema) body: z.infer<typeof consentInputSchema>) {
    const version = body.version ?? '2026-11';
    if (body.granted) {
      const [row] = await this.dbs.db.insert(schema.iamConsents).values({ userId: user.id, type: body.type, version }).returning();
      return { type: row!.type, version: row!.version, granted_at: row!.grantedAt.toISOString(), revoked_at: null };
    }
    const [row] = await this.dbs.db
      .update(schema.iamConsents)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.iamConsents.userId, user.id), eq(schema.iamConsents.type, body.type), isNull(schema.iamConsents.revokedAt)))
      .returning();
    if (!row) throw new NotFound('consent', body.type);
    return { type: row.type, version: row.version, granted_at: row.grantedAt.toISOString(), revoked_at: row.revokedAt?.toISOString() ?? null };
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


