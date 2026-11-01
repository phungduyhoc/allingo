import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { CONSENT_TYPES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { NotFound, ValidationFailed } from '../../shared/http/errors.js';

const { iamConsents } = schema;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface ConsentDto {
  type: ConsentType;
  version: string;
  granted_at: string;
  revoked_at: string | null;
}

/** Đồng ý xử lý dữ liệu (PDPL): terms + privacy bắt buộc khi đăng ký, có phiên bản văn bản (POLICY_VERSION). */
@Injectable()
export class ConsentsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
  ) {}

  get policyVersion(): string {
    return this.env.POLICY_VERSION;
  }

  /** Ghi đồng ý bắt buộc khi tạo tài khoản. accept === false → 400 (client phải hiển thị và nhận đồng ý). */
  async recordSignupConsents(tx: DbOrTx, userId: string, input: { accept?: boolean; marketing?: boolean; ip?: string | null }): Promise<void> {
    if (input.accept === false) throw new ValidationFailed({ issues: [{ path: 'accept_terms', message: 'Terms and privacy policy must be accepted' }] });
    const version = this.policyVersion;
    const rows: Array<typeof iamConsents.$inferInsert> = [
      { userId, type: 'terms', version, ip: input.ip ?? null },
      { userId, type: 'privacy', version, ip: input.ip ?? null },
    ];
    if (input.marketing) rows.push({ userId, type: 'marketing', version, ip: input.ip ?? null });
    await tx.insert(iamConsents).values(rows);
  }

  async list(userId: string): Promise<ConsentDto[]> {
    const rows = await this.dbs.db.select().from(iamConsents).where(eq(iamConsents.userId, userId)).orderBy(desc(iamConsents.grantedAt));
    return rows.map(toDto);
  }

  /** Cấp: nếu đã có bản chưa thu hồi cùng phiên bản → trả bản đó (idempotent); thu hồi: đánh dấu revoked_at */
  async set(userId: string, input: { type: ConsentType; granted: boolean; version?: string; ip?: string | null }): Promise<ConsentDto> {
    const version = input.version ?? this.policyVersion;
    if (input.granted) {
      const [active] = await this.dbs.db
        .select()
        .from(iamConsents)
        .where(and(eq(iamConsents.userId, userId), eq(iamConsents.type, input.type), eq(iamConsents.version, version), isNull(iamConsents.revokedAt)))
        .limit(1);
      if (active) return toDto(active);
      const [row] = await this.dbs.db.insert(iamConsents).values({ userId, type: input.type, version, ip: input.ip ?? null }).returning();
      return toDto(row!);
    }
    if (input.type === 'terms' || input.type === 'privacy') throw new ValidationFailed({ issues: [{ path: 'type', message: 'terms/privacy cannot be revoked; request account deletion instead' }] });
    const [row] = await this.dbs.db
      .update(iamConsents)
      .set({ revokedAt: new Date() })
      .where(and(eq(iamConsents.userId, userId), eq(iamConsents.type, input.type), isNull(iamConsents.revokedAt)))
      .returning();
    if (!row) throw new NotFound('consent', input.type);
    return toDto(row);
  }

  /** Đã đồng ý (chưa thu hồi) loại này? */
  async has(userId: string, type: ConsentType, db: DbOrTx = this.dbs.db): Promise<boolean> {
    const [row] = await db.select({ id: iamConsents.id }).from(iamConsents).where(and(eq(iamConsents.userId, userId), eq(iamConsents.type, type), isNull(iamConsents.revokedAt))).limit(1);
    return !!row;
  }
}

function toDto(r: typeof iamConsents.$inferSelect): ConsentDto {
  return { type: r.type, version: r.version, granted_at: r.grantedAt.toISOString(), revoked_at: r.revokedAt?.toISOString() ?? null };
}
