import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../telemetry/logger.js';

/**
 * Redis dùng cho quota, cache, idempotency, BullMQ. Khi Redis mất, các dịch vụ tiêu thụ phải degrade có chủ đích
 * (vd: PUT /answers vẫn ghi DB) – xem master prompt §7(8).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly logger = getLogger({ component: 'redis' });
  private healthy = false;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on('ready', () => {
      this.healthy = true;
      this.logger.info('redis ready');
    });
    this.client.on('error', (err: Error) => {
      if (this.healthy) this.logger.warn({ err: err.message }, 'redis error');
      this.healthy = false;
    });
    this.client.on('close', () => {
      // Mất kết nối: chuyển sang chế độ degrade có chủ đích (quota/cache/lock bỏ qua, DB vẫn là nguồn sự thật)
      if (this.healthy) this.logger.warn('redis connection lost (degraded mode: cache/quota counters skipped, DB still authoritative)');
      this.healthy = false;
    });
    this.client.on('end', () => (this.healthy = false));
    void this.client.connect().catch((err: Error) => this.logger.warn({ err: err.message }, 'redis connect failed (degraded mode)'));
  }

  get isHealthy(): boolean {
    return this.healthy && this.client.status === 'ready';
  }

  /** Thực thi lệnh Redis; trả null khi Redis không sẵn sàng thay vì ném lỗi */
  async safe<T>(fn: (r: Redis) => Promise<T>): Promise<T | null> {
    if (!this.isHealthy) return null;
    try {
      return await fn(this.client);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'redis command failed');
      return null;
    }
  }

  /** Tạo kết nối riêng (BullMQ yêu cầu maxRetriesPerRequest: null) */
  duplicateForQueue(): Redis {
    return new Redis(this.client.options.host ? { ...this.client.options, maxRetriesPerRequest: null, enableOfflineQueue: true, lazyConnect: false } : { maxRetriesPerRequest: null });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
