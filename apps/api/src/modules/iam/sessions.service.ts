import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { JwtService } from '../../shared/auth/jwt.service.js';
import { Unauthorized } from '../../shared/http/errors.js';

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
  constructor(
    private readonly dbs: DbService,
    private readonly jwt: JwtService,
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
    return this.dbs.db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(iamSessions)
        .where(and(eq(iamSessions.refreshTokenHash, hash), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date())))
        .for('update')
        .limit(1);
      if (!session) throw new Unauthorized('Invalid refresh token');
      const next = this.jwt.newRefreshToken();
      const expiresAt = new Date(Date.now() + this.jwt.refreshTtl * 1000);
      await tx.update(iamSessions).set({ refreshTokenHash: next.hash, expiresAt, lastSeenAt: new Date() }).where(eq(iamSessions.id, session.id));
      const [r, g] = await Promise.all([roles(session.userId), isGuest(session.userId)]);
      const accessToken = await this.jwt.signAccess({ sub: session.userId, sid: session.id, roles: r, guest: g });
      return { accessToken, refreshToken: next.token, sessionId: session.id, expiresIn: this.jwt.accessTtl };
    });
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    await this.dbs.db.update(iamSessions).set({ revokedAt: new Date() }).where(and(eq(iamSessions.id, sessionId), eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt)));
  }

  async revokeAll(userId: string, db: DbOrTx = this.dbs.db): Promise<void> {
    await db.update(iamSessions).set({ revokedAt: new Date() }).where(and(eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt)));
  }

  async list(userId: string, currentSessionId: string) {
    const rows = await this.dbs.db
      .select({ id: iamSessions.id, device: iamSessions.device, createdAt: iamSessions.createdAt, lastSeenAt: iamSessions.lastSeenAt })
      .from(iamSessions)
      .where(and(eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date())))
      .orderBy(desc(iamSessions.createdAt));
    return rows.map((r) => ({ id: r.id, device: (r.device as Record<string, unknown> | null) ?? null, created_at: r.createdAt.toISOString(), last_seen_at: r.lastSeenAt?.toISOString() ?? null, current: r.id === currentSessionId }));
  }

  async isActive(sessionId: string): Promise<boolean> {
    const [row] = await this.dbs.db.select({ id: iamSessions.id }).from(iamSessions).where(and(eq(iamSessions.id, sessionId), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date()))).limit(1);
    return !!row;
  }
}
