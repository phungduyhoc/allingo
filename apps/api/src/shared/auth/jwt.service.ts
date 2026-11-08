import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { ENV, type Env } from '../../config/env.js';

export interface AccessClaims extends JWTPayload {
  sub: string;
  sid: string;
  roles: string[];
  guest: boolean;
  /** S12: phiên đã xác minh TOTP (step-up admin) */
  mfa?: boolean;
  /** S12: token impersonate chỉ đọc */
  scope?: 'read_only';
  /** S12: id admin đang impersonate */
  imp?: string;
}
export interface AccessClaimsInput {
  sub: string;
  sid: string;
  roles: string[];
  guest: boolean;
  mfa?: boolean;
  scope?: 'read_only';
  imp?: string;
  /** Ghi đè thời hạn (giây) – impersonate 10 phút */
  ttlSeconds?: number;
}
export interface GuestTokenClaims extends JWTPayload {
  sub: string;
  purpose: 'guest';
}

/** JWT HS256 access 15 phút + refresh token ngẫu nhiên (băm SHA-256 lưu DB), theo ADR-0009/0020 */
@Injectable()
export class JwtService {
  private readonly key: Uint8Array;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.AUTH_SECRET);
  }

  get accessTtl(): number {
    return this.env.JWT_ACCESS_TTL_SECONDS;
  }
  get refreshTtl(): number {
    return this.env.JWT_REFRESH_TTL_SECONDS;
  }

  async signAccess(claims: AccessClaimsInput): Promise<string> {
    const extra: Record<string, unknown> = {};
    if (claims.mfa) extra.mfa = true;
    if (claims.scope) extra.scope = claims.scope;
    if (claims.imp) extra.imp = claims.imp;
    return new SignJWT({ roles: claims.roles, guest: claims.guest, sid: claims.sid, ...extra })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer('allingo')
      .setAudience('allingo-api')
      .setIssuedAt()
      .setExpirationTime(`${claims.ttlSeconds ?? this.env.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'allingo', audience: 'allingo-api', algorithms: ['HS256'] });
      if (!payload.sub || typeof payload.sid !== 'string') return null;
      return payload as AccessClaims;
    } catch {
      return null;
    }
  }

  /** Token phiên khách để ghép tiến độ khi đăng ký (30 ngày) */
  async signGuestToken(userId: string, ttlSeconds: number): Promise<string> {
    return new SignJWT({ purpose: 'guest' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer('allingo')
      .setAudience('allingo-guest')
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyGuestToken(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'allingo', audience: 'allingo-guest', algorithms: ['HS256'] });
      return payload.sub && payload.purpose === 'guest' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashToken(token) };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
