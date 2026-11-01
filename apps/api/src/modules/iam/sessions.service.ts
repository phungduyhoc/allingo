import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { JwtService } from '../../shared/auth/jwt.service.js';
import { SessionRevocationService } from '../../shared/auth/session-revocation.service.js';
import { Unauthorized } from '../../shared/http/errors.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';

const { iamSessions } = schema;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

/** Phiên = refresh token xoay vòng, băm SHA-256 lưu iam.sessions (ADR-0020). Access JWT mang sid để thu hồi. */
@Injectable()
export class SessionsService {
  private readonly logger = getLogger({ component: 'iam.sessions' });
  constructor(
    private readonly dbs: DbService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly revocation: SessionRevocationService,
  ) {}

  async create(tx: DbOrTx, user: { id: string; isGuest: boolean }, roles: string[], meta: { device?: Record<string, unknown>; ip?: string | null }): Promise<IssuedTokens> {
    const { token, hash } = this.jwt.newRefreshToken();
    const expiresAt = new Date(Date.now() + this.jwt.refreshTtl * 1000);
    const [session] = await tx
      .insert(iamSessions)
      .values({ userId: user.id, refreshTokenHash: hash, device: meta.device ?? null, ip: meta.ip ?? null, expiresAt, lastSeenAt: new Date() })
      .returning({ id: iamSessions.id });
    const accessToken = await this.jwt.signAccess({ sub: user.id, sid: session!.id, roles, guest: user.isGuest });
    return { accessToken, refreshToken: token, sessionId: session!.id, expiresIn: this.jwt.accessTtl };
  }

  /** Xoay vòng refresh: token cũ hết hiệu lực ngay, phát token mới cùng session id */
  async rotate(refreshToken: string, roles: (userId: string) => Promise<string[]>, isGuest: (userId: string) => Promise<boolean>): Promise<IssuedTokens> {
    const hash = this.jwt.hashToken(refreshToken);
    const result = await this.dbs.db.transaction(async (tx): Promise<IssuedTokens | { reusedSessionId: string; userId: string } | null> => {
      const [session] = await tx
        .select()
        .from(iamSessions)
        .where(and(eq(iamSessions.refreshTokenHash, hash), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date())))
        .for('update')
        .limit(1);
      if (!session) {
        // Hash trùng refresh token đã xoay vòng (device._prev_rt) → token có thể bị đánh cắp
        const [reused] = await tx
          .select({ id: iamSessions.id, userId: iamSessions.userId })
          .from(iamSessions)
          .where(sql`${iamSessions.device} ->> '_prev_rt' = ${hash}`)
          .limit(1);
        return reused ? { reusedSessionId: reused.id, userId: reused.userId } : null;
      }
      const next = this.jwt.newRefreshToken();
      const expiresAt = new Date(Date.now() + this.jwt.refreshTtl * 1000);
      const device = { ...((session.device as Record<string, unknown> | null) ?? {}), _prev_rt: hash };
      await tx.update(iamSessions).set({ refreshTokenHash: next.hash, expiresAt, lastSeenAt: new Date(), device }).where(eq(iamSessions.id, session.id));
      const [r, g] = await Promise.all([roles(session.userId), isGuest(session.userId)]);
      const accessToken = await this.jwt.signAccess({ sub: session.userId, sid: session.id, roles: r, guest: g });
      return { accessToken, refreshToken: next.token, sessionId: session.id, expiresIn: this.jwt.accessTtl };
    });
    if (result && 'accessToken' in result) return result;
    if (!result) throw new Unauthorized('Invalid refresh token');
    // Phát hiện tái sử dụng: thu hồi toàn bộ phiên của user trong transaction RIÊNG (đã commit) rồi mới báo lỗi
    await this.dbs.db.transaction(async (tx) => {
      await this.revokeAll(result.userId, tx);
      await this.revocation.markRevoked([result.reusedSessionId]);
      await this.audit.log({ action: 'session.refresh_reuse_detected', actorUserId: result.userId, entityType: 'session', entityId: result.reusedSessionId, after: { revoked_all: true } }, tx);
    });
    this.logger.warn({ session_id: result.reusedSessionId }, 'refresh token reuse detected; all sessions revoked');
    throw new Unauthorized('Refresh token reuse detected; all sessions revoked', { reason: 'refresh_reused' });
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    const rows = await this.dbs.db
      .update(iamSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(iamSessions.id, sessionId), eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt)))
      .returning({ id: iamSessions.id });
    await this.revocation.markRevoked(rows.map((r) => r.id));
  }

  /** Thu hồi mọi phiên còn hiệu lực của user (đổi mật khẩu, xoá tài khoản, ghép khách…) – access token hết hiệu lực ngay */
  async revokeAll(userId: string, db: DbOrTx = this.dbs.db): Promise<number> {
    const rows = await db.update(iamSessions).set({ revokedAt: new Date() }).where(and(eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt))).returning({ id: iamSessions.id });
    await this.revocation.markRevoked(rows.map((r) => r.id));
    return rows.length;
  }

  async list(userId: string, currentSessionId: string) {
    const rows = await this.dbs.db
      .select({ id: iamSessions.id, device: iamSessions.device, createdAt: iamSessions.createdAt, lastSeenAt: iamSessions.lastSeenAt })
      .from(iamSessions)
      .where(and(eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date())))
      .orderBy(desc(iamSessions.createdAt));
    return rows.map((r) => ({ id: r.id, device: stripInternal(r.device as Record<string, unknown> | null), created_at: r.createdAt.toISOString(), last_seen_at: r.lastSeenAt?.toISOString() ?? null, current: r.id === currentSessionId }));
  }

  async isActive(sessionId: string): Promise<boolean> {
    const [row] = await this.dbs.db.select({ id: iamSessions.id }).from(iamSessions).where(and(eq(iamSessions.id, sessionId), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date()))).limit(1);
    return !!row;
  }
}

/** Bỏ khoá nội bộ (_prev_rt) trước khi trả về client */
function stripInternal(device: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!device) return null;
  const { _prev_rt: _omit, ...rest } = device;
  return rest;
}
