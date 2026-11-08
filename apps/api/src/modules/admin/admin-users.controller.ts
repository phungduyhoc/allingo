import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminImpersonateInputSchema, adminImpersonationSchema, adminUserDeletionResultSchema, adminUserDetailSchema, adminUserLockInputSchema, adminUserLockResultSchema, adminUsersPageSchema, adminUserUnlockResultSchema } from '@allingo/schemas';
import { CurrentUser, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery, ZodValidationPipe } from '../../shared/http/zod.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CreditService, SubscriptionsService, OrdersService } from '../billing/index.js';
import { BetaService, SupportService } from '../growth/index.js';
import { AdminUsersService } from '../iam/index.js';
import { AttemptsService } from '../test-engine/index.js';

const userParam = z.object({ userId: z.uuid() });
const searchQuery = z.object({
  q: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['active', 'suspended', 'pending_deletion', 'deleted']).optional(),
  role: z.string().max(32).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const unlockInput = z.object({ reason: z.string().max(500).optional() });

function meta(req: FastifyRequest) {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

/**
 * Admin người dùng (S12): tìm, hồ sơ (PII che) + lịch sử attempt/đơn/ticket, khoá/mở (thu hồi phiên ngay), xoá theo yêu cầu,
 * impersonate chỉ đọc có audit. Vai trò (cấp/thu hồi) ở AdminController (S1).
 */
@ApiTags('Admin')
@Controller('admin/users')
@Roles('admin', 'superadmin')
export class AdminUsersController {
  private readonly logger = getLogger({ component: 'admin.users' });

  constructor(
    private readonly admin: AdminUsersService,
    private readonly attempts: AttemptsService,
    private readonly orders: OrdersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly credits: CreditService,
    private readonly support: SupportService,
    private readonly beta: BetaService,
  ) {}

  @Get()
  @ApiZod({ query: searchQuery, responses: { 200: adminUsersPageSchema } })
  search(@CurrentUser() user: AuthUser, @ZodQuery(searchQuery) q: z.infer<typeof searchQuery>, @Req() req: FastifyRequest) {
    return this.admin.search(user, q, meta(req));
  }

  @Get(':userId')
  @ApiZod({ responses: { 200: adminUserDetailSchema, 404: 'empty' } })
  async detail(@ZodParams(userParam) p: z.infer<typeof userParam>) {
    const profile = await this.admin.profile(p.userId);
    const safe = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        this.logger.warn({ what, err: (err as Error).message.slice(0, 160) }, 'admin user detail section failed');
        return fallback;
      }
    };
    const [attempts, orders, subscriptions, balance, tickets, betaStatus] = await Promise.all([
      safe('attempts', async () => (await this.attempts.listMine(p.userId, { limit: 10 })).data, []),
      safe('orders', async () => (await this.orders.listMine(p.userId, undefined, 10)).data, []),
      safe('subscriptions', () => this.subscriptions.listMine(p.userId), []),
      safe('credits', () => this.credits.balance(p.userId), 0),
      safe('tickets', () => this.support.recentForUser(p.userId, 10), []),
      safe('beta', async () => ({ tester: (await this.beta.redeemed(p.userId)) || profile.roles.includes('beta_tester'), redeemed_at: (await this.beta.redeemedAt(p.userId))?.toISOString() ?? null }), { tester: false, redeemed_at: null as string | null }),
    ]);
    return { ...profile, beta: { ...betaStatus, invite_status: betaStatus.redeemed_at ? 'redeemed' : null }, credits: { balance }, subscriptions, attempts, orders, tickets };
  }

  @Post(':userId/lock')
  @HttpCode(200)
  @ApiZod({ body: adminUserLockInputSchema, responses: { 200: adminUserLockResultSchema, 403: 'empty', 404: 'empty', 409: 'empty' } })
  lock(@CurrentUser() user: AuthUser, @ZodParams(userParam) p: z.infer<typeof userParam>, @ZodBody(adminUserLockInputSchema) body: z.infer<typeof adminUserLockInputSchema>, @Req() req: FastifyRequest) {
    return this.admin.lock(user, p.userId, body.reason, meta(req));
  }

  @Post(':userId/unlock')
  @HttpCode(200)
  @ApiZod({ body: unlockInput, responses: { 200: adminUserUnlockResultSchema, 404: 'empty', 409: 'empty' } })
  unlock(@CurrentUser() user: AuthUser, @ZodParams(userParam) p: z.infer<typeof userParam>, @Body(new ZodValidationPipe(unlockInput)) body: z.infer<typeof unlockInput>, @Req() req: FastifyRequest) {
    return this.admin.unlock(user, p.userId, body.reason, meta(req));
  }

  @Post(':userId/deletion')
  @HttpCode(202)
  @ApiZod({ body: adminUserLockInputSchema, responses: { 202: adminUserDeletionResultSchema, 403: 'empty', 404: 'empty', 409: 'empty' } })
  deletion(@CurrentUser() user: AuthUser, @ZodParams(userParam) p: z.infer<typeof userParam>, @ZodBody(adminUserLockInputSchema) body: z.infer<typeof adminUserLockInputSchema>, @Req() req: FastifyRequest) {
    return this.admin.requestDeletion(user, p.userId, body.reason, meta(req));
  }

  @Post(':userId/impersonate')
  @HttpCode(201)
  @ApiZod({ body: adminImpersonateInputSchema, responses: { 201: adminImpersonationSchema, 403: 'empty', 404: 'empty' } })
  impersonate(@CurrentUser() user: AuthUser, @ZodParams(userParam) p: z.infer<typeof userParam>, @ZodBody(adminImpersonateInputSchema) body: z.infer<typeof adminImpersonateInputSchema>, @Req() req: FastifyRequest) {
    return this.admin.impersonate(user, p.userId, body.reason, meta(req));
  }
}
