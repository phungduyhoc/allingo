import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../cache/redis.module.js';
import { DbService } from '../db/db.module.js';

/**
 * Thu hồi access token theo phiên (sid) trước khi JWT hết hạn: logout, thu hồi từ xa, phát hiện tái sử dụng refresh,
 * xoá tài khoản, ghép khách. Denylist `sess:revoked:{sid}` trong Redis với TTL = thời hạn access token (+60 s).
 * Redis degrade → đối chiếu iam.sessions.revoked_at (ngoại lệ có chủ đích của quy tắc §5.1: guard xác thực dùng chung
 * là điểm thực thi của iam ở tầng shared; chỉ đọc 1 cột theo khoá chính).
 */
@Injectable()
export class SessionRevocationService {
  /** Bản sao trong tiến trình để vẫn chặn được khi Redis vừa mất kết nối (một instance) */
  private readonly local = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly dbs: DbService,
  ) {}

  private get ttl(): number {
    return this.env.JWT_ACCESS_TTL_SECONDS + 60;
  }

  async markRevoked(sessionIds: readonly string[]): Promise<void> {
    if (!sessionIds.length) return;
    const until = Date.now() + this.ttl * 1000;
    for (const sid of sessionIds) this.local.set(sid, until);
    await this.redis.safe(async (r) => {
      const p = r.pipeline();
      for (const sid of sessionIds) p.set(`sess:revoked:${sid}`, '1', 'EX', this.ttl);
      return p.exec();
    });
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    const until = this.local.get(sessionId);
    if (until !== undefined) {
      if (until > Date.now()) return true;
      this.local.delete(sessionId);
    }
    const hit = await this.redis.safe((r) => r.exists(`sess:revoked:${sessionId}`));
    if (hit !== null) return hit === 1;
    // Redis không sẵn sàng → DB là nguồn sự thật
    const [row] = await this.dbs.db.select({ revokedAt: schema.iamSessions.revokedAt }).from(schema.iamSessions).where(eq(schema.iamSessions.id, sessionId)).limit(1);
    return !row || row.revokedAt !== null;
  }
}
