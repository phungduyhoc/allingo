import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { RedisService } from '../cache/redis.module.js';
import { DbService } from '../db/db.module.js';

const TTL_SEC = 300;

/**
 * B7/S144: tra nhẹ "đã đăng ký TOTP chưa" cho AuthGuard khi trả 403 `mfa_required` (`details.enrolled` như OpenAPI) – chỉ chạy ở
 * nhánh lỗi (admin chưa step-up), cache Redis 5′, iam xoá cache khi xác nhận TOTP. Ngoại lệ có chủ đích của quy tắc §5.1 giống
 * SessionRevocationService: guard xác thực dùng chung ở tầng shared đọc đúng một cột của iam.mfa_factors theo user_id.
 */
@Injectable()
export class MfaEnrollmentLookup {
  constructor(
    private readonly redis: RedisService,
    private readonly dbs: DbService,
  ) {}

  private key(userId: string): string {
    return `mfa:enrolled:${userId}`;
  }

  async isEnrolled(userId: string): Promise<boolean> {
    const hit = await this.redis.safe((r) => r.get(this.key(userId)));
    if (hit === '1') return true;
    if (hit === '0') return false;
    const [row] = await this.dbs.db
      .select({ id: schema.iamMfaFactors.id })
      .from(schema.iamMfaFactors)
      .where(and(eq(schema.iamMfaFactors.userId, userId), eq(schema.iamMfaFactors.kind, 'totp'), isNotNull(schema.iamMfaFactors.confirmedAt)))
      .limit(1);
    const enrolled = !!row;
    await this.redis.safe((r) => r.set(this.key(userId), enrolled ? '1' : '0', 'EX', TTL_SEC));
    return enrolled;
  }

  async invalidate(userId: string): Promise<void> {
    await this.redis.safe((r) => r.del(this.key(userId)));
  }
}
