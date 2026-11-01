import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Roles } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodQuery } from '../../shared/http/zod.js';
import { AiGatewayService } from '../ai-gateway/index.js';

const rangeQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

@ApiTags('Admin')
@Controller('admin')
@Roles('admin', 'superadmin')
export class AdminController {
  constructor(private readonly gateway: AiGatewayService) {}

  /** Báo cáo chi phí AI theo ngày/tác vụ (master prompt §7(7)) */
  @Get('reports/ai-costs')
  @ApiZod({ query: rangeQuery, responses: { 200: z.record(z.string(), z.unknown()) } })
  aiCosts(@ZodQuery(rangeQuery) q: z.infer<typeof rangeQuery>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 30 * 86_400_000);
    return this.gateway.costReport(from, to);
  }
}
