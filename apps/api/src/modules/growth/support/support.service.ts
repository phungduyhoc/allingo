import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, SUPPORT_FIRST_RESPONSE_SLA_HOURS, type SupportTicket, type SupportTicketInput } from '@allingo/schemas';
import type { AuthUser } from '../../../shared/auth/auth.guard.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { Conflict, NotFound } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { GROWTH_METRICS } from '../../../shared/telemetry/metrics.js';
import { CreditService } from '../../billing/index.js';
import { maskEmail, UsersService } from '../../iam/index.js';
import { NotificationService, type ChannelResult } from '../notify/notification.service.js';

const { opsSupportTickets, opsSupportMessages } = schema;
type TicketRow = typeof opsSupportTickets.$inferSelect;
type MessageRow = typeof opsSupportMessages.$inferSelect;

/**
 * Ticket hỗ trợ (S12): người học tạo/trả lời (2 chiều), SLA phản hồi đầu 24 giờ (`first_response_due_at`), admin lọc/trả lời
 * (thông báo `support.reply` in-app + email qua NotificationService) và cấp credit bù (CreditService.adjust – ledger admin_adjust,
 * cùng transaction với tin trả lời + audit user.grant_credits). Nội dung ticket không ghi log.
 */
@Injectable()
export class SupportService {
  private readonly logger = getLogger({ component: 'growth.support' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly credits: CreditService,
    private readonly notify: NotificationService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  private overdue(t: TicketRow, now: Date): boolean {
    return !t.firstRespondedAt && !!t.firstResponseDueAt && t.firstResponseDueAt < now && t.status !== 'closed' && t.status !== 'resolved';
  }

  private ticketDto(t: TicketRow, messages?: MessageRow[]): SupportTicket {
    return {
      id: t.id,
      subject: t.subject,
      category: t.category as SupportTicket['category'],
      status: t.status as SupportTicket['status'],
      priority: t.priority as SupportTicket['priority'],
      first_response_due_at: t.firstResponseDueAt?.toISOString() ?? null,
      first_responded_at: t.firstRespondedAt?.toISOString() ?? null,
      last_message_at: t.lastMessageAt?.toISOString() ?? null,
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
      ...(messages ? { messages: messages.map((m) => ({ id: m.id, author: m.authorKind as 'user', body: m.body, created_at: m.createdAt.toISOString() })) } : {}),
    };
  }

  private async messages(ticketId: string): Promise<MessageRow[]> {
    return this.dbs.db.select().from(opsSupportMessages).where(eq(opsSupportMessages.ticketId, ticketId)).orderBy(asc(opsSupportMessages.createdAt), asc(opsSupportMessages.id));
  }

  async create(user: AuthUser, input: SupportTicketInput, meta: { traceId: string; userAgent?: string | null }) {
    const now = this.now();
    const due = new Date(now.getTime() + SUPPORT_FIRST_RESPONSE_SLA_HOURS * 3_600_000);
    const t = await this.dbs.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(opsSupportTickets)
        .values({ userId: user.id, subject: input.subject, body: input.message, channel: 'inapp', status: 'open', priority: 'normal', category: input.category, context: { trace_id: input.trace_id ?? meta.traceId, request_trace_id: meta.traceId, attempt_id: input.attempt_id ?? null, page_url: input.page_url ?? null, user_agent: meta.userAgent?.slice(0, 200) ?? null }, firstResponseDueAt: due, lastMessageAt: now, createdAt: now, updatedAt: now })
        .returning();
      await tx.insert(opsSupportMessages).values({ ticketId: row!.id, authorUserId: user.id, authorKind: 'user', body: input.message, createdAt: now });
      await this.outbox.write(tx, { aggregateType: 'support_ticket', aggregateId: row!.id, eventType: DOMAIN_EVENTS.SUPPORT_TICKET_CREATED, payload: { ticket_id: row!.id, user_id: user.id, category: input.category } });
      return row!;
    });
    GROWTH_METRICS.feedback.inc({ kind: `ticket_${input.category}` });
    return this.ticketDto(t, await this.messages(t.id));
  }

  async listMine(userId: string, q: { cursor?: string; limit: number }) {
    const conds: SQL[] = [eq(opsSupportTickets.userId, userId)];
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${opsSupportTickets.createdAt}, ${opsSupportTickets.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(opsSupportTickets).where(and(...conds)).orderBy(desc(opsSupportTickets.createdAt), desc(opsSupportTickets.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: page.map((t) => this.ticketDto(t)), next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null };
  }

  private async load(id: string): Promise<TicketRow> {
    const [t] = await this.dbs.db.select().from(opsSupportTickets).where(eq(opsSupportTickets.id, id)).limit(1);
    if (!t) throw new NotFound('support_ticket', id);
    return t;
  }

  async getMine(userId: string, id: string) {
    const t = await this.load(id);
    if (t.userId !== userId) throw new NotFound('support_ticket', id);
    return this.ticketDto(t, await this.messages(id));
  }

  async userReply(userId: string, id: string, message: string) {
    const t = await this.load(id);
    if (t.userId !== userId) throw new NotFound('support_ticket', id);
    if (t.status === 'closed') throw new Conflict('Ticket is closed', { reason: 'ticket_closed' });
    const now = this.now();
    await this.dbs.db.transaction(async (tx) => {
      await tx.insert(opsSupportMessages).values({ ticketId: id, authorUserId: userId, authorKind: 'user', body: message, createdAt: now });
      await tx.update(opsSupportTickets).set({ status: 'open', lastMessageAt: now, closedAt: null }).where(eq(opsSupportTickets.id, id));
    });
    return this.ticketDto(await this.load(id), await this.messages(id));
  }

  // ------------------------------------------------------------------ admin
  private async adminDto(t: TicketRow, withMessages: boolean) {
    const now = this.now();
    const u = t.userId ? await this.users.findById(t.userId) : null;
    return { ...this.ticketDto(t, withMessages ? await this.messages(t.id) : undefined), user: u ? { id: u.id, display_name: u.displayName, email_masked: maskEmail(u.email), status: u.status } : null, assigned_to: t.assignedTo ?? null, overdue: this.overdue(t, now), context: (t.context ?? {}), closed_at: t.closedAt?.toISOString() ?? null };
  }

  async adminList(q: { status?: string; priority?: string; category?: string; overdue?: boolean; user_id?: string; q?: string; cursor?: string; limit: number }) {
    const now = this.now();
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(opsSupportTickets.status, q.status));
    if (q.priority) conds.push(eq(opsSupportTickets.priority, q.priority));
    if (q.category) conds.push(eq(opsSupportTickets.category, q.category));
    if (q.user_id) conds.push(eq(opsSupportTickets.userId, q.user_id));
    if (q.q) conds.push(sql`${opsSupportTickets.subject} ilike ${`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
    if (q.overdue === true) conds.push(sql`${opsSupportTickets.firstRespondedAt} is null and ${opsSupportTickets.firstResponseDueAt} < ${now.toISOString()}::timestamptz and ${opsSupportTickets.status} in ('open','waiting_user')`);
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${opsSupportTickets.createdAt}, ${opsSupportTickets.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(opsSupportTickets).where(conds.length ? and(...conds) : undefined).orderBy(desc(opsSupportTickets.createdAt), desc(opsSupportTickets.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const counts = (await this.dbs.db.execute(sql`select status, count(*)::int as n from ops.support_tickets group by status`)) as unknown as Array<{ status: string; n: number }>;
    const last = page[page.length - 1];
    return { data: await Promise.all(page.map((t) => this.adminDto(t, false))), next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null, counts: { ...Object.fromEntries(counts.map((x) => [x.status, x.n])), overdue: await this.overdueCount(now) } };
  }

  async adminGet(id: string) {
    return this.adminDto(await this.load(id), true);
  }

  async adminPatch(actor: AuthUser, id: string, patch: { status?: string; priority?: string; assigned_to?: string | null }) {
    const before = await this.load(id);
    const set: Partial<typeof opsSupportTickets.$inferInsert> = {};
    if (patch.status) {
      set.status = patch.status;
      set.closedAt = patch.status === 'closed' || patch.status === 'resolved' ? (before.closedAt ?? this.now()) : null;
    }
    if (patch.priority) set.priority = patch.priority;
    if (patch.assigned_to !== undefined) set.assignedTo = patch.assigned_to;
    if (Object.keys(set).length) await this.dbs.db.update(opsSupportTickets).set(set).where(eq(opsSupportTickets.id, id));
    await this.audit.log({ action: 'support.update', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'support_ticket', entityId: id, before: { status: before.status, priority: before.priority, assigned_to: before.assignedTo }, after: { status: patch.status ?? before.status, priority: patch.priority ?? before.priority, assigned_to: patch.assigned_to === undefined ? before.assignedTo : patch.assigned_to } });
    return this.adminGet(id);
  }

  async adminReply(actor: AuthUser, id: string, input: { message: string; channels: Array<'inapp' | 'email'>; status: string; credit?: { delta: number; note: string } }, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const t = await this.load(id);
    if (input.credit && !t.userId) throw new Conflict('Ticket has no user (account deleted)', { reason: 'no_user' });
    const now = this.now();
    const out = await this.dbs.db.transaction(async (tx) => {
      const [msg] = await tx.insert(opsSupportMessages).values({ ticketId: id, authorUserId: actor.id, authorKind: 'agent', body: input.message, createdAt: now }).returning();
      await tx
        .update(opsSupportTickets)
        .set({ status: input.status, lastMessageAt: now, firstRespondedAt: t.firstRespondedAt ?? now, assignedTo: t.assignedTo ?? actor.id, closedAt: input.status === 'closed' || input.status === 'resolved' ? now : null })
        .where(eq(opsSupportTickets.id, id));
      let credit: { delta: number; balance: number; ledger_id: number } | null = null;
      if (input.credit && t.userId) {
        const r = await this.credits.adjust(tx, t.userId, input.credit.delta, { actorId: actor.id, note: `support:${id} ${input.credit.note}` });
        credit = { delta: input.credit.delta, balance: r.balanceAfter, ledger_id: r.ledgerId };
        await this.audit.log({ action: 'user.grant_credits', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'user', entityId: t.userId, after: { delta: input.credit.delta, balance_after: r.balanceAfter, ledger_id: r.ledgerId, source: 'support_ticket', ticket_id: id }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      }
      await this.audit.log({ action: 'support.reply', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'support_ticket', entityId: id, after: { message_id: msg!.id, status: input.status, first_response: !t.firstRespondedAt, credit: credit?.delta ?? 0 } }, tx);
      await this.outbox.write(tx, { aggregateType: 'support_ticket', aggregateId: id, eventType: DOMAIN_EVENTS.SUPPORT_TICKET_REPLIED, payload: { ticket_id: id, user_id: t.userId, message_id: msg!.id, first_response: !t.firstRespondedAt, response_minutes: t.firstRespondedAt ? null : Math.round((now.getTime() - t.createdAt.getTime()) / 60_000) } });
      return { msg: msg!, credit };
    });
    let delivery: ChannelResult[] = [];
    if (t.userId) {
      try {
        delivery = (await this.notify.send(t.userId, 'support.reply', { ticket_id: id, subject: t.subject, message: input.message.slice(0, 2000), credits: out.credit?.delta ?? 0 }, { channels: input.channels, dedupeKey: `support:${out.msg.id}` })).results;
      } catch (err) {
        this.logger.warn({ err: (err as Error).message.slice(0, 200), ticket_id: id }, 'support reply notification failed');
      }
      await this.dbs.db.update(opsSupportMessages).set({ delivery: { results: delivery.map((d) => ({ channel: d.channel, status: d.status, reason: d.reason ?? null })) } }).where(eq(opsSupportMessages.id, out.msg.id));
      if (out.credit) this.outbox.emitLocal('credits.changed', { user_id: t.userId, balance: out.credit.balance });
    }
    return { ...(await this.adminGet(id)), delivery, credit: out.credit };
  }

  async overdueCount(now: Date = this.now()): Promise<number> {
    const [r] = (await this.dbs.db.execute(sql`select count(*)::int as n from ops.support_tickets where first_responded_at is null and first_response_due_at < ${now.toISOString()}::timestamptz and status in ('open','waiting_user')`)) as unknown as Array<{ n: number }>;
    return r?.n ?? 0;
  }

  /** Lịch sử ticket của một người dùng (admin – hồ sơ người dùng) */
  async recentForUser(userId: string, limit = 10) {
    const rows = await this.dbs.db.select().from(opsSupportTickets).where(eq(opsSupportTickets.userId, userId)).orderBy(desc(opsSupportTickets.createdAt)).limit(limit);
    return rows.map((t) => this.ticketDto(t));
  }
}
