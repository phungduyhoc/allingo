import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { Locale, ProgramCode, User } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { Conflict, NotFound } from '../../shared/http/errors.js';

export type IdentityRow = typeof iamAuthIdentities.$inferSelect;
export type AuthProviderCode = IdentityRow['provider'];

const { iamUsers, iamUserRoles, iamAuthIdentities, learnEnrollments } = schema;

export type UserRow = typeof iamUsers.$inferSelect;

@Injectable()
export class UsersService {
  constructor(private readonly dbs: DbService) {}

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
