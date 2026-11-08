import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams } from '../../shared/http/zod.js';
import { ContentPublishService } from './content-publish.service.js';
import { MiniTestService, generateTestSetInputSchema, generateTestSetResultSchema, type GenerateTestSetInput } from './mini-test.service.js';

const testSetParam = z.object({ testSetId: z.uuid() });

/** Quản trị bộ đề (v1.1 – Sprint 4): sinh đề mini lặp lại được theo seed. Quyền editor/admin. B2: phát hành đề nháp (teacher/admin). */
@ApiTags('Admin')
@Controller('admin/test-sets')
@Roles('editor', 'admin', 'superadmin')
export class AdminTestSetsController {
  constructor(
    private readonly mini: MiniTestService,
    private readonly publish: ContentPublishService,
  ) {}

  /** B2: phát hành đề NHÁP của catalog (vd. đề AI soạn nháp) – mọi câu đã phát hành + đạt kiểm tra cấu trúc */
  @Post(':testSetId/publish')
  @HttpCode(200)
  @Roles('teacher', 'admin', 'superadmin')
  @ApiZod({ responses: { 200: z.record(z.string(), z.unknown()), 409: 'empty', 422: 'empty' } })
  publishDraft(@CurrentUser() user: AuthUser, @ZodParams(testSetParam) p: z.infer<typeof testSetParam>, @Req() req: FastifyRequest) {
    return this.publish.publishDraft({ id: user.id, roles: user.roles }, p.testSetId, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
  }

  @Post('generate')
  @HttpCode(201)
  @ApiZod({ body: generateTestSetInputSchema, responses: { 201: generateTestSetResultSchema } })
  generate(@CurrentUser() user: AuthUser, @ZodBody(generateTestSetInputSchema) body: GenerateTestSetInput, @Req() req: FastifyRequest) {
    return this.mini.generate(body, { id: user.id, roles: user.roles }, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
  }
}
