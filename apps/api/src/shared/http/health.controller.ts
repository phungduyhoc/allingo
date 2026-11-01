import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/auth.guard.js';
import { DbService } from '../db/db.module.js';
import { RedisService } from '../cache/redis.module.js';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    const db = await this.dbs.ping();
    const redis = this.redis.isHealthy;
    return { status: db ? 'ok' : 'degraded', checks: { db, redis }, ts: new Date().toISOString() };
  }
}
