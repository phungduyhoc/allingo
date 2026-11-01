import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { Locale, ProgramCode, User } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { Conflict, NotFound } from '../../shared/http/errors.js';

const { iamUsers, iamUserRoles, learnEnrollments } = schema;

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

  /** Đánh dấu yêu cầu xoá (job purge xử lý sau 72 giờ – Sprint 1) */
  async requestDeletion(userId: string): Promise<void> {
    await this.dbs.db.transaction(async (tx) => {
      await tx.insert(schema.iamDeletionRequests).values({ userId, dueAt: sql`now() + interval '72 hours'` });
      await tx.update(iamUsers).set({ status: 'pending_deletion', updatedAt: new Date() }).where(eq(iamUsers.id, userId));
      await tx.update(schema.iamSessions).set({ revokedAt: new Date() }).where(eq(schema.iamSessions.userId, userId));
    });
  }
}
