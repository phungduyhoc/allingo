import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody } from '../../shared/http/zod.js';
import { MiniTestService, generateTestSetInputSchema, generateTestSetResultSchema, type GenerateTestSetInput } from './mini-test.service.js';

/** Quản trị bộ đề (v1.1 – Sprint 4): sinh đề mini lặp lại được theo seed. Quyền editor/admin. */
@ApiTags('Admin')
@Controller('admin/test-sets')
@Roles('editor', 'admin', 'superadmin')
export class AdminTestSetsController {
  constructor(private readonly mini: MiniTestService) {}

  @Post('generate')
  @HttpCode(201)
  @ApiZod({ body: generateTestSetInputSchema, responses: { 201: generateTestSetResultSchema } })
  generate(@CurrentUser() user: AuthUser, @ZodBody(generateTestSetInputSchema) body: GenerateTestSetInput, @Req() req: FastifyRequest) {
    return this.mini.generate(body, { id: user.id, roles: user.roles }, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
  }
}
