import { randomInt } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { Locale, ProgramCode, User } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { UserDirectory, type UserContact } from '../../shared/events/user-directory.js';
import { Conflict, NotFound } from '../../shared/http/errors.js';

export type IdentityRow = typeof iamAuthIdentities.$inferSelect;
export type AuthProviderCode = IdentityRow['provider'];

const { iamUsers, iamUserRoles, iamAuthIdentities, iamSessions, learnEnrollments } = schema;

export type UserRow = typeof iamUsers.$inferSelect;

/** Bảng chữ mã giới thiệu: bỏ 0/O/1/I/L dễ nhầm */
const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_REGEX = /^[A-HJKMNP-Z2-9]{8}$/;

export function newReferralCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return s;
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    private readonly dbs: DbService,
    private readonly directory: UserDirectory,
  ) {}

  /** S8: danh bạ cho module tầng 1 khác (billing – người mua mặc định trên hoá đơn, đối tượng Free credit tháng) */
  onModuleInit(): void {
    const toContact = (r: UserRow): UserContact => ({ id: r.id, displayName: r.displayName, email: r.email ?? null, locale: r.uiLocale, isGuest: r.isGuest, status: r.status, createdAt: r.createdAt });
    this.directory.register(
      async (id) => {
        const r = await this.findById(id);
        return r ? toContact(r) : null;
      },
      async (ids) => (await this.dbs.db.select().from(iamUsers).where(inArray(iamUsers.id, ids))).map(toContact),
    );
  }

  // ------------------------------------------------------------------ S8: referral & xác minh
  /** Mã giới thiệu của người dùng (cấp lười, UNIQUE `iam.users.referral_code`; trùng → thử mã khác) */
  async referralCode(userId: string): Promise<string> {
    const [row] = await this.dbs.db.select({ code: iamUsers.referralCode }).from(iamUsers).where(eq(iamUsers.id, userId)).limit(1);
    if (!row) throw new NotFound('user', userId);
    if (row.code) return row.code;
    for (let i = 0; i < 5; i++) {
      const code = newReferralCode();
      try {
        const [u] = await this.dbs.db.update(iamUsers).set({ referralCode: sql`coalesce(${iamUsers.referralCode}, ${code})` }).where(eq(iamUsers.id, userId)).returning({ code: iamUsers.referralCode });
        if (u?.code) return u.code;
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code !== '23505' && (err as { code?: string }).code !== '23505') throw err;
      }
    }
    throw new Conflict('Could not allocate referral code');
  }

  async findByReferralCode(code: string, db: DbOrTx = this.dbs.db): Promise<UserRow | null> {
    const c = code.trim().toUpperCase();
    if (!REFERRAL_CODE_REGEX.test(c)) return null;
    const [row] = await db.select().from(iamUsers).where(eq(iamUsers.referralCode, c)).limit(1);
    return row ?? null;
  }

  /**
   * Tài khoản đã xác minh (S8 – điều kiện thưởng referral): có định danh đã xác minh – OTP email/điện thoại (`email`/`phone`)
   * hoặc OAuth có email (Google/Apple/Facebook chỉ trả email đã xác minh). Đăng ký mật khẩu chưa xác minh tới khi đăng nhập OTP.
   */
  async isVerified(userId: string, db: DbOrTx = this.dbs.db): Promise<boolean> {
    const [r] = await db
      .select({ id: iamAuthIdentities.id })
      .from(iamAuthIdentities)
      .where(and(eq(iamAuthIdentities.userId, userId), sql`(${iamAuthIdentities.provider} in ('email','phone') or (${iamAuthIdentities.provider} in ('google','apple','facebook') and ${iamAuthIdentities.email} is not null))`))
      .limit(1);
    return !!r;
  }

  /** id người dùng có vai trò (cảnh báo vận hành tới admin) */
  async idsWithRoles(roles: string[], db: DbOrTx = this.dbs.db): Promise<string[]> {
    const rows = await db.selectDistinct({ id: iamUserRoles.userId }).from(iamUserRoles).innerJoin(iamUsers, eq(iamUsers.id, iamUserRoles.userId)).where(and(inArray(iamUserRoles.roleCode, roles), eq(iamUsers.status, 'active'), isNotNull(iamUsers.email)));
    return rows.map((r) => r.id);
  }

  /** Phiên gần đây (24 giờ) của người dùng – fingerprint thiết bị (băm) và IP, cho chống lạm dụng referral */
  async recentDeviceSignals(userId: string, since: Date, db: DbOrTx = this.dbs.db): Promise<{ fingerprints: string[]; ips: string[] }> {
    const rows = await db
      .select({ fp: sql<string | null>`${iamSessions.device}->>'fp'`, ip: sql<string | null>`host(${iamSessions.ip})` })
      .from(iamSessions)
      .where(and(eq(iamSessions.userId, userId), sql`coalesce(${iamSessions.lastSeenAt}, ${iamSessions.createdAt}) >= ${since.toISOString()}::timestamptz`));
    return { fingerprints: [...new Set(rows.map((r) => r.fp).filter((x): x is string => !!x))], ips: [...new Set(rows.map((r) => r.ip).filter((x): x is string => !!x))] };
  }

  async findById(id: string, db: DbOrTx = this.dbs.db): Promise<UserRow | null> {
    const [row] = await db.select().from(iamUsers).where(eq(iamUsers.id, id)).limit(1);
    return row ?? null;
  }

  async findByEmail(email: string, db: DbOrTx = this.dbs.db): Promise<UserRow | null> {
    const [row] = await db.select().from(iamUsers).where(eq(iamUsers.email, email.trim())).limit(1);
    return row ?? null;
  }

  async getRoles(userId: string, db: DbOrTx = this.dbs.db): Promise<string[]> {
    const rows = await db.select({ role: iamUserRoles.roleCode }).from(iamUserRoles).where(eq(iamUserRoles.userId, userId));
    const roles = rows.map((r) => r.role);
    return roles.length ? roles : ['learner'];
  }

  async createEmailUser(tx: DbOrTx, input: { email: string; passwordHash: string; displayName: string; uiLocale?: Locale }): Promise<UserRow> {
    const existing = await this.findByEmail(input.email, tx);
    if (existing) throw new Conflict('Email already registered', { field: 'email' });
    const [row] = await tx
      .insert(iamUsers)
      .values({ email: input.email.trim(), passwordHash: input.passwordHash, displayName: input.displayName, uiLocale: input.uiLocale ?? 'vi', explainLocale: input.uiLocale ?? 'vi', isGuest: false, status: 'active' })
      .returning();
    await tx.insert(iamUserRoles).values({ userId: row!.id, roleCode: 'learner' }).onConflictDoNothing();
    return row!;
  }

  async findByPhone(phone: string, db: DbOrTx = this.dbs.db): Promise<UserRow | null> {
    const [row] = await db.select().from(iamUsers).where(eq(iamUsers.phone, phone)).limit(1);
    return row ?? null;
  }

  /** Tài khoản tạo qua OAuth/OTP: không có mật khẩu; email chỉ đặt khi nhà cung cấp đã xác minh */
  async createExternalUser(tx: DbOrTx, input: { email?: string | null; phone?: string | null; displayName: string; avatarUrl?: string | null; uiLocale?: Locale }): Promise<UserRow> {
    if (input.email) {
      const existing = await this.findByEmail(input.email, tx);
      if (existing) throw new Conflict('Email already registered', { field: 'email' });
    }
    if (input.phone) {
      const existing = await this.findByPhone(input.phone, tx);
      if (existing) throw new Conflict('Phone already registered', { field: 'phone' });
    }
    const [row] = await tx
      .insert(iamUsers)
      .values({ email: input.email?.trim() ?? null, phone: input.phone ?? null, displayName: input.displayName, avatarUrl: input.avatarUrl ?? null, uiLocale: input.uiLocale ?? 'vi', explainLocale: input.uiLocale ?? 'vi', isGuest: false, status: 'active' })
      .returning();
    await tx.insert(iamUserRoles).values({ userId: row!.id, roleCode: 'learner' }).onConflictDoNothing();
    return row!;
  }

  async findIdentity(provider: AuthProviderCode, providerUid: string, db: DbOrTx = this.dbs.db): Promise<IdentityRow | null> {
    const [row] = await db.select().from(iamAuthIdentities).where(and(eq(iamAuthIdentities.provider, provider), eq(iamAuthIdentities.providerUid, providerUid))).limit(1);
    return row ?? null;
  }

  async linkIdentity(tx: DbOrTx, input: { userId: string; provider: AuthProviderCode; providerUid: string; email?: string | null; rawProfile?: Record<string, unknown> | null }): Promise<IdentityRow> {
    const [row] = await tx
      .insert(iamAuthIdentities)
      .values({ userId: input.userId, provider: input.provider, providerUid: input.providerUid, email: input.email ?? null, rawProfile: input.rawProfile ?? null })
      .onConflictDoUpdate({ target: [iamAuthIdentities.provider, iamAuthIdentities.providerUid], set: { email: input.email ?? null, rawProfile: input.rawProfile ?? null } })
      .returning();
    return row!;
  }

  async listIdentities(userId: string, db: DbOrTx = this.dbs.db): Promise<Array<{ provider: AuthProviderCode; created_at: string }>> {
    const rows = await db.select({ provider: iamAuthIdentities.provider, createdAt: iamAuthIdentities.createdAt }).from(iamAuthIdentities).where(eq(iamAuthIdentities.userId, userId));
    return rows.map((r) => ({ provider: r.provider, created_at: r.createdAt.toISOString() }));
  }

  async grantRole(tx: DbOrTx, input: { userId: string; roleCode: string; programCode?: string | null; grantedBy?: string | null }): Promise<void> {
    await tx.insert(iamUserRoles).values({ userId: input.userId, roleCode: input.roleCode, programCode: input.programCode ?? null, grantedBy: input.grantedBy ?? null }).onConflictDoNothing();
  }

  async revokeRole(tx: DbOrTx, input: { userId: string; roleCode: string; programCode?: string | null }): Promise<number> {
    const rows = await tx
      .delete(iamUserRoles)
      .where(and(eq(iamUserRoles.userId, input.userId), eq(iamUserRoles.roleCode, input.roleCode), input.programCode ? eq(iamUserRoles.programCode, input.programCode) : sql`${iamUserRoles.programCode} IS NULL`))
      .returning({ userId: iamUserRoles.userId });
    return rows.length;
  }

  async createGuest(tx: DbOrTx, displayName: string, uiLocale: Locale = 'vi'): Promise<UserRow> {
    const [row] = await tx.insert(iamUsers).values({ displayName, uiLocale, explainLocale: uiLocale, isGuest: true, status: 'active' }).returning();
    await tx.insert(iamUserRoles).values({ userId: row!.id, roleCode: 'learner' }).onConflictDoNothing();
    return row!;
  }

  async update(userId: string, patch: Partial<Pick<UserRow, 'displayName' | 'avatarUrl' | 'uiLocale' | 'explainLocale' | 'timezone'>>): Promise<UserRow> {
    const [row] = await this.dbs.db
      .update(iamUsers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(iamUsers.id, userId))
      .returning();
    if (!row) throw new NotFound('user', userId);
    return row;
  }

  /** Chương trình đang học = enrollment active cập nhật gần nhất */
  async activeProgram(userId: string, db: DbOrTx = this.dbs.db): Promise<ProgramCode | null> {
    const [row] = await db
      .select({ program: learnEnrollments.programCode })
      .from(learnEnrollments)
      .where(and(eq(learnEnrollments.userId, userId), eq(learnEnrollments.isActive, true)))
      .orderBy(desc(learnEnrollments.updatedAt))
      .limit(1);
    return (row?.program as ProgramCode | undefined) ?? null;
  }

  async toDto(row: UserRow, db: DbOrTx = this.dbs.db): Promise<User> {
    const [roles, activeProgram] = await Promise.all([this.getRoles(row.id, db), this.activeProgram(row.id, db)]);
    return {
      id: row.id,
      email: row.email ?? null,
      phone: row.phone ?? null,
      display_name: row.displayName,
      avatar_url: row.avatarUrl ?? null,
      ui_locale: row.uiLocale as Locale,
      explain_locale: row.explainLocale as Locale,
      timezone: row.timezone,
      is_guest: row.isGuest,
      roles,
      active_program: activeProgram,
      created_at: row.createdAt.toISOString(),
    };
  }

}
