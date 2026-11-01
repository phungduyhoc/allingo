import { Injectable } from '@nestjs/common';
import { RedisService } from '../cache/redis.module.js';

/**
 * Idempotency-Key cho POST /attempts|/orders|/submissions (CLAUDE.md §6): lưu kết quả 24 giờ theo (user, key).
 * Không có Redis → bỏ qua (degrade), request vẫn xử lý.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  async get<T>(userId: string, key: string | undefined): Promise<T | null> {
    if (!key) return null;
    const raw = await this.redis.safe((r) => r.get(`idem:${userId}:${key}`));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(userId: string, key: string | undefined, value: unknown, ttlSec = 86_400): Promise<void> {
    if (!key) return;
    await this.redis.safe((r) => r.set(`idem:${userId}:${key}`, JSON.stringify(value), 'EX', ttlSec));
  }
}
