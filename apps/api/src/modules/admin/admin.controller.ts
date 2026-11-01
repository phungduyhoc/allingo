import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { roleGrantInputSchema, type RoleGrantInput } from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { Forbidden, NotFound } from '../../shared/http/errors.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { AiGatewayService } from '../ai-gateway/index.js';
import { UsersService } from '../iam/index.js';

const userParam = z.object({ userId: z.uuid() });

const rangeQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

@ApiTags('Admin')
@Controller('admin')
@Roles('admin', 'superadmin')
export class AdminController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly users: UsersService,
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cấp/thu hồi vai trò (RBAC, Sprint 1). Chưa có trong OpenAPI → loại khỏi tài liệu sinh ra (SPEC-ISSUES S13).
   * admin không được cấp superadmin; chỉ superadmin cấp admin.
   */
  @Post('users/:userId/roles')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async setRole(@CurrentUser() actor: AuthUser, @ZodParams(userParam) p: z.infer<typeof userParam>, @ZodBody(roleGrantInputSchema) body: RoleGrantInput, @Req() req: FastifyRequest) {
    if (body.role_code === 'admin' && !actor.roles.includes('superadmin')) throw new Forbidden('Only superadmin can grant admin', { required: ['superadmin'] });
    const target = await this.users.findById(p.userId);
    if (!target) throw new NotFound('user', p.userId);
    await this.dbs.db.transaction(async (tx) => {
      if (body.action === 'grant') await this.users.grantRole(tx, { userId: p.userId, roleCode: body.role_code, programCode: body.program_code ?? null, grantedBy: actor.id });
      else await this.users.revokeRole(tx, { userId: p.userId, roleCode: body.role_code, programCode: body.program_code ?? null });
      await this.audit.log({ action: body.action === 'grant' ? 'user.role_granted' : 'user.role_revoked', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: p.userId, after: { role: body.role_code, program: body.program_code ?? null }, ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null }, tx);
    });
    return { user_id: p.userId, roles: await this.users.getRoles(p.userId) };
  }

  /**
   * Báo cáo chi phí AI theo ngày (giờ VN) × tác vụ × model (S5): tổng, by_day, by_task, by_model, rows; cache hit, fallback,
   * credit, token, p95 latency; `from`/`to` là ngày lịch Asia/Ho_Chi_Minh (mặc định 30 ngày gần nhất).
   */
  @Get('reports/ai-costs')
  @ApiZod({ query: rangeQuery, responses: { 200: z.record(z.string(), z.unknown()) } })
  aiCosts(@ZodQuery(rangeQuery) q: z.infer<typeof rangeQuery>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999+07:00`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00+07:00`) : new Date(to.getTime() - 30 * 86_400_000);
    return this.gateway.costReport(from, to);
  }
}
