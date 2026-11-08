import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, IMPERSONATION_TTL_SECONDS } from '@allingo/schemas';
import type { AuthUser } from '../../shared/auth/auth.guard.js';
import { JwtService } from '../../shared/auth/jwt.service.js';
import { SessionRevocationService } from '../../shared/auth/session-revocation.service.js';
import { RedisService } from '../../shared/cache/redis.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Conflict, Forbidden, NotFound } from '../../shared/http/errors.js';
import { DeletionService } from './deletion.service.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

const { iamUsers, iamUserRoles, iamSessions, iamAuthIdentities, iamMfaFactors, iamDeletionRequests } = schema;
const PRIVILEGED = ['admin', 'superadmin'];
const STAFF = ['admin', 'superadmin', 'teacher', 'editor', 'service', 'org_admin'];

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Che email: 2 ký tự đầu phần tên + *** + @tên miền (`le***@allingo.dev`); ≤ 2 ký tự → `*` */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local!.length <= 2 ? '*' : local!.slice(0, 2)}***@${domain}`;
}

/** Che số điện thoại: giữ mã quốc gia/3 số cuối */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? '***' : `${phone.slice(0, 3)}${'*'.repeat(Math.max(3, phone.length - 6))}${phone.slice(-3)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin người dùng (S12, module iam): tìm kiếm (PII che), hồ sơ cơ bản, khoá/mở (thu hồi mọi phiên qua denylist – hiệu lực
 * ngay), xoá theo yêu cầu (DeletionService), impersonate CHỈ ĐỌC (JWT 10 phút scope=read_only, AuthGuard chặn ghi + audit).
 * Lịch sử attempt/đơn/ticket do module admin ghép từ module tương ứng (CLAUDE.md §5.1).
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly deletion: DeletionService,
    private readonly jwt: JwtService,
    private readonly revocation: SessionRevocationService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private async rolesOf(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!ids.length) return out;
    const rows = await this.dbs.db.select({ userId: iamUserRoles.userId, role: iamUserRoles.roleCode }).from(iamUserRoles).where(inArray(iamUserRoles.userId, ids));
    for (const r of rows) out.set(r.userId, [...new Set([...(out.get(r.userId) ?? []), r.role])]);
    return out;
  }

  private summary(u: typeof iamUsers.$inferSelect, roles: string[]) {
    return { id: u.id, display_name: u.displayName, email_masked: maskEmail(u.email), status: u.status, is_guest: u.isGuest, roles: roles.length ? roles : ['learner'], created_at: u.createdAt.toISOString() };
  }

  async search(actor: AuthUser, q: { q?: string; status?: string; role?: string; cursor?: string; limit: number }, meta: RequestMeta = {}) {
    const conds: SQL[] = [];
    const term = q.q?.trim();
    if (term) {
      if (UUID_RE.test(term)) conds.push(eq(iamUsers.id, term));
      else if (term.includes('@')) conds.push(or(eq(iamUsers.email, term), ilike(iamUsers.email, `${escapeLike(term)}%`))!);
      else conds.push(or(ilike(iamUsers.displayName, `%${escapeLike(term)}%`), ilike(iamUsers.email, `${escapeLike(term)}%`))!);
    }
    if (q.status) conds.push(eq(iamUsers.status, q.status as typeof iamUsers.$inferSelect.status));
    if (q.role) conds.push(sql`exists (select 1 from iam.user_roles r where r.user_id = ${iamUsers.id} and r.role_code = ${q.role})`);
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(or(lt(iamUsers.createdAt, new Date(c.at)), and(eq(iamUsers.createdAt, new Date(c.at)), lt(iamUsers.id, c.id)))!);
    const rows = await this.dbs.db
      .select()
      .from(iamUsers)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(iamUsers.createdAt), desc(iamUsers.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const roles = await this.rolesOf(page.map((u) => u.id));
    // Không ghi chuỗi tìm kiếm (có thể là email) – chỉ loại + số kết quả
    await this.audit.log({ action: 'admin.user_search', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', after: { kind: !term ? 'list' : UUID_RE.test(term) ? 'id' : term.includes('@') ? 'email' : 'name', results: page.length }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    const last = page[page.length - 1];
    return { data: page.map((u) => this.summary(u, roles.get(u.id) ?? [])), next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null };
  }

  /** Hồ sơ cơ bản phía iam (PII che) */
  async profile(userId: string) {
    const u = await this.users.findById(userId);
    if (!u) throw new NotFound('user', userId);
    const roles = (await this.rolesOf([userId])).get(userId) ?? [];
    const [sess] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${iamSessions.lastSeenAt})` })
      .from(iamSessions)
      .where(and(eq(iamSessions.userId, userId), isNull(iamSessions.revokedAt), gt(iamSessions.expiresAt, new Date())));
    const providers = await this.dbs.db.selectDistinct({ p: iamAuthIdentities.provider }).from(iamAuthIdentities).where(eq(iamAuthIdentities.userId, userId));
    const [mfa] = await this.dbs.db.select({ confirmedAt: iamMfaFactors.confirmedAt }).from(iamMfaFactors).where(eq(iamMfaFactors.userId, userId)).limit(1);
    const [del] = await this.dbs.db.select().from(iamDeletionRequests).where(eq(iamDeletionRequests.userId, userId)).orderBy(desc(iamDeletionRequests.requestedAt)).limit(1);
    const last = sess?.last ? new Date(sess.last) : null;
    return {
      ...this.summary(u, roles),
      phone_masked: maskPhone(u.phone),
      ui_locale: u.uiLocale,
      timezone: u.timezone,
      providers: providers.map((p) => p.p),
      active_sessions: sess?.n ?? 0,
      last_seen_at: last ? last.toISOString() : null,
      mfa_enrolled: !!mfa?.confirmedAt,
      deletion: del ? { request_id: del.id, requested_at: del.requestedAt.toISOString(), due_at: del.dueAt.toISOString(), completed_at: del.completedAt?.toISOString() ?? null } : null,
    };
  }

  private async assertManageable(actor: AuthUser, userId: string): Promise<typeof iamUsers.$inferSelect> {
    if (actor.id === userId) throw new Forbidden('Cannot perform this action on yourself', { reason: 'self_action' });
    const u = await this.users.findById(userId);
    if (!u) throw new NotFound('user', userId);
    const roles = await this.users.getRoles(userId);
    if (roles.some((r) => PRIVILEGED.includes(r)) && !actor.roles.includes('superadmin')) throw new Forbidden('Only superadmin can manage admin accounts', { required: ['superadmin'] });
    return u;
  }

  /** Khoá: status suspended + thu hồi mọi phiên (Redis denylist ngay, DB fallback) + mọi token impersonate đang mở */
  async lock(actor: AuthUser, userId: string, reason: string, meta: RequestMeta = {}) {
    const u = await this.assertManageable(actor, userId);
    if (u.status === 'deleted' || u.status === 'pending_deletion') throw new Conflict('Account is being deleted', { reason: 'pending_deletion', status: u.status });
    const revoked = await this.dbs.db.transaction(async (tx) => {
      await tx.update(iamUsers).set({ status: 'suspended' }).where(eq(iamUsers.id, userId));
      const n = await this.sessions.revokeAll(userId, tx);
      await this.audit.log({ action: 'user.locked', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: userId, before: { status: u.status }, after: { status: 'suspended', reason, sessions_revoked: n }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      await this.outbox.write(tx, { aggregateType: 'user', aggregateId: userId, eventType: DOMAIN_EVENTS.USER_LOCKED, payload: { user_id: userId, by: actor.id } });
      return n;
    });
    await this.revokeImpersonations(userId);
    return { user_id: userId, status: 'suspended', sessions_revoked: revoked };
  }

  async unlock(actor: AuthUser, userId: string, reason: string | undefined, meta: RequestMeta = {}) {
    const u = await this.assertManageable(actor, userId);
    if (u.status !== 'suspended') throw new Conflict('Account is not locked', { reason: 'not_locked', status: u.status });
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(iamUsers).set({ status: 'active' }).where(eq(iamUsers.id, userId));
      await this.audit.log({ action: 'user.unlocked', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: userId, before: { status: 'suspended' }, after: { status: 'active', reason: reason ?? null }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      await this.outbox.write(tx, { aggregateType: 'user', aggregateId: userId, eventType: DOMAIN_EVENTS.USER_UNLOCKED, payload: { user_id: userId, by: actor.id } });
    });
    return { user_id: userId, status: 'active' };
  }

  /** Xoá theo yêu cầu (đã xác minh qua kênh hỗ trợ) – cùng luồng DELETE /me (72 giờ), audit có admin id */
  async requestDeletion(actor: AuthUser, userId: string, reason: string, meta: RequestMeta = {}) {
    await this.assertManageable(actor, userId);
    const r = await this.deletion.request(userId, meta);
    await this.audit.log({ action: 'admin.user_deletion_requested', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: userId, after: { request_id: r.request_id, due_at: r.due_at, reason }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    return { status: 'scheduled' as const, due_at: r.due_at, request_id: r.request_id };
  }

  /** Token CHỈ ĐỌC 10 phút; không cấp cho admin/superadmin, chính mình, tài khoản không active */
  async impersonate(actor: AuthUser, userId: string, reason: string, meta: RequestMeta = {}) {
    if (actor.impersonatedBy) throw new Forbidden('Nested impersonation is not allowed', { reason: 'impersonation_read_only' });
    if (actor.id === userId) throw new Forbidden('Cannot impersonate yourself', { reason: 'self_action' });
    const u = await this.users.findById(userId);
    if (!u) throw new NotFound('user', userId);
    const roles = await this.users.getRoles(userId);
    if (roles.some((r) => PRIVILEGED.includes(r))) throw new Forbidden('Cannot impersonate admin accounts', { reason: 'target_privileged' });
    if (u.status !== 'active') throw new Conflict('Account is not active', { reason: 'not_active', status: u.status });
    const impersonationId = randomUUID();
    const token = await this.jwt.signAccess({ sub: userId, sid: impersonationId, roles: roles.filter((r) => !STAFF.includes(r)), guest: u.isGuest, scope: 'read_only', imp: actor.id, ttlSeconds: IMPERSONATION_TTL_SECONDS });
    await this.redis.safe(async (r) => {
      await r.sadd(`imp:active:${userId}`, impersonationId);
      return r.expire(`imp:active:${userId}`, IMPERSONATION_TTL_SECONDS + 60);
    });
    await this.audit.log({ action: 'user.impersonation_started', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: userId, after: { impersonation_id: impersonationId, expires_in: IMPERSONATION_TTL_SECONDS, reason }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    return { access_token: token, token_type: 'Bearer' as const, expires_in: IMPERSONATION_TTL_SECONDS, scope: 'read_only' as const, impersonation_id: impersonationId, user_id: userId };
  }

  private async revokeImpersonations(userId: string): Promise<void> {
    const ids = (await this.redis.safe((r) => r.smembers(`imp:active:${userId}`))) ?? [];
    if (ids.length) await this.revocation.markRevoked(ids);
    await this.redis.safe((r) => r.del(`imp:active:${userId}`));
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
