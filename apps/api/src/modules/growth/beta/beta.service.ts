import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { BETA_GATE_FLAG, BETA_TESTER_ROLE, DOMAIN_EVENTS, type AdminBetaInviteCreate, type BetaRedeemResult, type BetaStatus, type WaitlistInput } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import type { AuthUser } from '../../../shared/auth/auth.guard.js';
import { RedisService } from '../../../shared/cache/redis.module.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/cursor.js';
import { Conflict, Forbidden, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { MailerService } from '../../../shared/notify/mailer.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { GROWTH_METRICS } from '../../../shared/telemetry/metrics.js';
import { BetaGrantService, CreditService, EntitlementService, FeatureFlagService } from '../../billing/index.js';
import { maskEmail, UsersService } from '../../iam/index.js';
import { renderNotification } from '../notify/renderer.js';
import { S12_TEMPLATES } from '../notify/s12-templates.js';
import { betaAccessDecision, generateInviteCode, hashInviteCode, remainingInvites, resolveBetaConfig, vnDayStart, type BetaConfig } from './beta-rules.js';

const { opsWaitlistEntries, opsBetaInvites, opsSurveyResponses } = schema;
const PROGRAM_NAMES: Record<string, string> = { toeic: 'TOEIC', ielts: 'IELTS', jlpt: 'JLPT', hsk: 'HSK' };
const MAX_SEND_ATTEMPTS = 3;

type InviteRow = typeof opsBetaInvites.$inferSelect;

/**
 * Beta kín (S12, ADR-0035): danh sách chờ (POST /waitlist – không lộ tồn tại), mã mời đơn dùng một lần (chỉ lưu sha256),
 * gửi theo đợt ≤ `daily_invite_limit`/ngày giờ VN (job beta.invites_send), đổi mã → Pro trial + credit (billing BetaGrantService)
 * + vai trò `beta_tester`, beta gate `ff.growth.beta_gate` (cache quyền 5′ dương / 30 s âm). Không log email/mã.
 */
@Injectable()
export class BetaService {
  private readonly logger = getLogger({ component: 'growth.beta' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly redis: RedisService,
    private readonly flags: FeatureFlagService,
    private readonly grants: BetaGrantService,
    private readonly entitlements: EntitlementService,
    private readonly credits: CreditService,
    private readonly users: UsersService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  async config(): Promise<{ enabled: boolean; userIds: string[]; cfg: BetaConfig }> {
    const f = await this.flags.get(BETA_GATE_FLAG);
    return { enabled: !!f?.enabled, userIds: f?.rules?.user_ids ?? [], cfg: resolveBetaConfig(f?.rules?.config) };
  }

  // ------------------------------------------------------------------ quyền beta (guard)
  private akey(userId: string): string {
    return `beta:access:${userId}`;
  }

  /** Đã đổi mã (vai trò beta_tester trong DB) – cache Redis 5′ (dương) / 30 s (âm) */
  async redeemed(userId: string): Promise<boolean> {
    const hit = await this.redis.safe((r) => r.get(this.akey(userId)));
    if (hit === '1') return true;
    if (hit === '0') return false;
    const ok = (await this.users.getRoles(userId)).includes(BETA_TESTER_ROLE);
    await this.redis.safe((r) => r.set(this.akey(userId), ok ? '1' : '0', 'EX', ok ? 300 : 30));
    return ok;
  }

  async invalidateAccess(userId: string): Promise<void> {
    await this.redis.safe((r) => r.del(this.akey(userId)));
  }

  async access(user: Pick<AuthUser, 'id' | 'roles'>): Promise<{ allowed: boolean; reason: BetaStatus['reason'] }> {
    const { enabled, userIds } = await this.config();
    const quick = betaAccessDecision({ gateEnabled: enabled, roles: user.roles, allowlisted: userIds.includes(user.id), redeemed: false });
    if (quick.allowed) return quick;
    return betaAccessDecision({ gateEnabled: enabled, roles: user.roles, allowlisted: false, redeemed: await this.redeemed(user.id) });
  }

  async status(user: AuthUser | undefined): Promise<BetaStatus> {
    const { enabled } = await this.config();
    if (!user) return { gate_enabled: enabled, has_access: null, reason: 'anonymous', redeemed_at: null, trial_ends_at: null, survey_completed: null };
    const a = await this.access(user);
    const [inv] = await this.dbs.db.select().from(opsBetaInvites).where(eq(opsBetaInvites.redeemedBy, user.id)).limit(1);
    const [survey] = await this.dbs.db.select({ id: opsSurveyResponses.id }).from(opsSurveyResponses).where(and(eq(opsSurveyResponses.userId, user.id), eq(opsSurveyResponses.kind, 'beta_onboarding'))).limit(1);
    const grant = (inv?.grantResult ?? {}) as { trial_ends_at?: string | null };
    return { gate_enabled: enabled, has_access: a.allowed, reason: a.reason, redeemed_at: inv?.redeemedAt?.toISOString() ?? null, trial_ends_at: grant.trial_ends_at ?? null, survey_completed: !!survey };
  }

  /** Ngày bắt đầu beta của người dùng (đổi mã) – mốc NPS ngày 7/14 */
  async redeemedAt(userId: string): Promise<Date | null> {
    const [inv] = await this.dbs.db.select({ at: opsBetaInvites.redeemedAt }).from(opsBetaInvites).where(eq(opsBetaInvites.redeemedBy, userId)).limit(1);
    return inv?.at ?? null;
  }

  // ------------------------------------------------------------------ danh sách chờ
  private ipHash(ip: string | null | undefined): string | null {
    if (!ip) return null;
    return createHash('sha256').update(`${this.env.ANALYTICS_HASH_SALT ?? this.env.AUTH_SECRET}:waitlist:${ip}`).digest('hex').slice(0, 32);
  }

  /** Luôn trả cùng kết quả (202) – trùng chỉ cập nhật locale/đồng ý khi còn `waiting` */
  async joinWaitlist(input: WaitlistInput, meta: { ip?: string | null }): Promise<{ status: 'accepted' }> {
    const email = input.email.trim().toLowerCase();
    const rows = (await this.dbs.db.execute(sql`
      insert into ops.waitlist_entries (email, program, locale, consent_marketing, source, ip_hash)
      values (${email}, ${input.program}, ${input.locale}, ${input.consent_marketing}, ${input.source ?? null}, ${this.ipHash(meta.ip)})
      on conflict (email, program) do update set locale = excluded.locale,
        consent_marketing = ops.waitlist_entries.consent_marketing or excluded.consent_marketing
        where ops.waitlist_entries.status = 'waiting'
      returning id, (xmax = 0) as inserted`)) as unknown as Array<{ id: string; inserted: boolean }>;
    const r = rows[0];
    if (r?.inserted) {
      await this.outbox.write(this.dbs.db, { aggregateType: 'waitlist', aggregateId: r.id, eventType: DOMAIN_EVENTS.WAITLIST_JOINED, payload: { entry_id: r.id, program: input.program, locale: input.locale, consent_marketing: input.consent_marketing } });
      GROWTH_METRICS.waitlist.inc({ program: input.program });
    }
    return { status: 'accepted' };
  }

  async listWaitlist(q: { program?: string; status?: string; cursor?: string; limit: number }) {
    const conds: SQL[] = [];
    if (q.program) conds.push(eq(opsWaitlistEntries.program, q.program));
    if (q.status) conds.push(eq(opsWaitlistEntries.status, q.status));
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${opsWaitlistEntries.createdAt}, ${opsWaitlistEntries.id}) > (${c.at}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(opsWaitlistEntries).where(conds.length ? and(...conds) : undefined).orderBy(asc(opsWaitlistEntries.createdAt), asc(opsWaitlistEntries.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const counts = (await this.dbs.db.execute(sql`select status, count(*)::int as n from ops.waitlist_entries ${q.program ? sql`where program = ${q.program}` : sql``} group by status`)) as unknown as Array<{ status: string; n: number }>;
    const last = page[page.length - 1];
    return {
      data: page.map((e) => ({ id: e.id, email_masked: maskEmail(e.email) ?? '***', program: e.program, locale: e.locale, consent_marketing: e.consentMarketing, source: e.source ?? null, status: e.status, created_at: e.createdAt.toISOString() })),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
      counts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
    };
  }

  // ------------------------------------------------------------------ lời mời
  inviteDto(r: InviteRow) {
    return { id: r.id, email_masked: maskEmail(r.email) ?? '***', program: r.program, status: r.status as 'queued', batch: r.batch ?? null, sent_at: r.sentAt?.toISOString() ?? null, expires_at: r.expiresAt?.toISOString() ?? null, redeemed_at: r.redeemedAt?.toISOString() ?? null, redeemed_by: r.redeemedBy ?? null, send_attempts: r.sendAttempts, last_error: r.lastError ?? null, created_at: r.createdAt.toISOString() };
  }

  async createInvites(actor: AuthUser, input: AdminBetaInviteCreate, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const batch = input.batch ?? `manual-${vnDayStart(this.now()).toISOString().slice(0, 10)}`;
    const targets: Array<{ email: string; entryId: string | null; locale: string }> = [];
    if (input.waitlist_entry_ids?.length) {
      const entries = await this.dbs.db.select().from(opsWaitlistEntries).where(inArray(opsWaitlistEntries.id, input.waitlist_entry_ids));
      // Giữ thứ tự admin chọn (FIFO khi gửi theo đợt)
      const order = new Map(input.waitlist_entry_ids.map((id, i) => [id, i]));
      entries.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      for (const e of entries) if (e.status === 'waiting') targets.push({ email: e.email.toLowerCase(), entryId: e.id, locale: e.locale });
    }
    for (const e of input.emails ?? []) targets.push({ email: e.trim().toLowerCase(), entryId: null, locale: input.locale });
    const seen = new Set<string>();
    let queued = 0;
    for (const t of targets) {
      if (seen.has(t.email)) continue;
      seen.add(t.email);
      const [row] = await this.dbs.db
        .insert(opsBetaInvites)
        .values({ email: t.email, waitlistEntryId: t.entryId, program: input.program, locale: t.locale, status: 'queued', batch, createdBy: actor.id })
        .onConflictDoNothing()
        .returning({ id: opsBetaInvites.id });
      if (!row) continue;
      queued++;
      if (t.entryId) await this.dbs.db.update(opsWaitlistEntries).set({ status: 'invited' }).where(eq(opsWaitlistEntries.id, t.entryId));
    }
    const skipped = targets.length - queued;
    await this.audit.log({ action: 'beta.invites_created', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'beta_invite', after: { queued, skipped, batch, program: input.program }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    return { queued, skipped, batch };
  }

  async listInvites(q: { status?: string; batch?: string; cursor?: string; limit: number }) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(opsBetaInvites.status, q.status));
    if (q.batch) conds.push(eq(opsBetaInvites.batch, q.batch));
    const c = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${opsBetaInvites.createdAt}, ${opsBetaInvites.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.dbs.db.select().from(opsBetaInvites).where(conds.length ? and(...conds) : undefined).orderBy(desc(opsBetaInvites.createdAt), desc(opsBetaInvites.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const { cfg } = await this.config();
    const sentToday = await this.sentSince(vnDayStart(this.now()));
    const counts = (await this.dbs.db.execute(sql`select status, count(*)::int as n from ops.beta_invites group by status`)) as unknown as Array<{ status: string; n: number }>;
    const last = page[page.length - 1];
    return {
      data: page.map((r) => this.inviteDto(r)),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
      today: { sent: sentToday, limit: cfg.daily_invite_limit, remaining: remainingInvites(cfg.daily_invite_limit, sentToday) },
      counts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
    };
  }

  async revokeInvite(actor: AuthUser, id: string) {
    const [row] = await this.dbs.db.select().from(opsBetaInvites).where(eq(opsBetaInvites.id, id)).limit(1);
    if (!row) throw new NotFound('beta_invite', id);
    if (row.status === 'redeemed') throw new Conflict('Invite already redeemed', { reason: 'invite_used' });
    const [after] = await this.dbs.db.update(opsBetaInvites).set({ status: 'revoked' }).where(eq(opsBetaInvites.id, id)).returning();
    if (row.waitlistEntryId) await this.dbs.db.update(opsWaitlistEntries).set({ status: 'waiting' }).where(and(eq(opsWaitlistEntries.id, row.waitlistEntryId), eq(opsWaitlistEntries.status, 'invited')));
    await this.audit.log({ action: 'beta.invite_revoked', actorUserId: actor.id, actorRole: actor.roles.join(','), entityType: 'beta_invite', entityId: id, before: { status: row.status } });
    return this.inviteDto(after!);
  }

  private async sentSince(from: Date): Promise<number> {
    const [r] = await this.dbs.db.select({ n: sql<number>`count(*)::int` }).from(opsBetaInvites).where(and(isNotNull(opsBetaInvites.sentAt), gte(opsBetaInvites.sentAt, from)));
    return r?.n ?? 0;
  }

  /**
   * Job beta.invites_send: hết hạn mã quá hạn, rồi gửi lời mời `queued` theo thứ tự xếp hàng tới khi đủ hạn mức hôm nay
   * (giờ VN). Mỗi lời mời: sinh mã → lưu sha256 + sent → gửi email; lỗi gửi → trả về `queued` (hoặc `failed` sau 3 lần).
   */
  async sendDue(opts: { limit?: number; now?: Date } = {}): Promise<{ sent: number; failed: number; expired: number; remaining_today: number }> {
    const now = opts.now ?? this.now();
    const expired = await this.expireDue(now);
    const { cfg } = await this.config();
    let budget = remainingInvites(cfg.daily_invite_limit, await this.sentSince(vnDayStart(now)), opts.limit);
    let sent = 0;
    let failed = 0;
    while (budget > 0) {
      const claimed = await this.dbs.db.transaction(async (tx) => {
        const [row] = await tx.select().from(opsBetaInvites).where(eq(opsBetaInvites.status, 'queued')).orderBy(asc(opsBetaInvites.createdAt), asc(opsBetaInvites.id)).limit(1).for('update', { skipLocked: true });
        if (!row) return null;
        const code = generateInviteCode();
        const expiresAt = new Date(now.getTime() + cfg.invite_ttl_days * 86_400_000);
        await tx.update(opsBetaInvites).set({ status: 'sent', codeHash: hashInviteCode(code), sentAt: now, expiresAt, sendAttempts: row.sendAttempts + 1, lastError: null }).where(eq(opsBetaInvites.id, row.id));
        return { row, code, expiresAt };
      });
      if (!claimed) break;
      budget--;
      const r = await this.sendInviteEmail(claimed.row, claimed.code, claimed.expiresAt, cfg);
      if (r.delivered) {
        sent++;
        GROWTH_METRICS.betaInvites.inc({ result: 'sent' });
        await this.outbox.write(this.dbs.db, { aggregateType: 'beta_invite', aggregateId: claimed.row.id, eventType: DOMAIN_EVENTS.BETA_INVITED, payload: { invite_id: claimed.row.id, program: claimed.row.program, batch: claimed.row.batch } });
      } else {
        failed++;
        GROWTH_METRICS.betaInvites.inc({ result: 'failed' });
        const attempts = claimed.row.sendAttempts + 1;
        await this.dbs.db.update(opsBetaInvites).set({ status: attempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'queued', codeHash: null, sentAt: null, expiresAt: null, lastError: (r.error ?? 'send failed').slice(0, 300) }).where(eq(opsBetaInvites.id, claimed.row.id));
      }
    }
    if (sent || failed || expired) this.logger.info({ sent, failed, expired }, 'beta.invites_send');
    return { sent, failed, expired, remaining_today: remainingInvites(cfg.daily_invite_limit, await this.sentSince(vnDayStart(now))) };
  }

  private async sendInviteEmail(row: InviteRow, code: string, expiresAt: Date, cfg: BetaConfig): Promise<{ delivered: boolean; error?: string }> {
    const def = S12_TEMPLATES['beta.invite'];
    const web = this.env.WEB_PUBLIC_URL.replace(/\/+$/, '');
    const rendered = renderNotification(def, row.locale, { code, program_name: PROGRAM_NAMES[row.program] ?? row.program.toUpperCase(), trial_days: cfg.trial_days, credits: cfg.credits, expires_at: expiresAt.toISOString() }, { appUrl: `${web}/${row.locale === 'en' ? 'en' : 'vi'}`, manageUrl: `${web}/support`, unsubscribeUrl: null });
    return this.mailer.send({ to: row.email, subject: rendered.subject, text: rendered.text, html: rendered.html, tags: { kind: 'beta_invite', batch: row.batch ?? 'none' } });
  }

  async expireDue(now: Date = this.now()): Promise<number> {
    const rows = await this.dbs.db.update(opsBetaInvites).set({ status: 'expired' }).where(and(eq(opsBetaInvites.status, 'sent'), lt(opsBetaInvites.expiresAt, now))).returning({ id: opsBetaInvites.id });
    return rows.length;
  }

  // ------------------------------------------------------------------ đổi mã
  async redeem(user: AuthUser, code: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<BetaRedeemResult> {
    if (user.isGuest) throw new Forbidden('Sign up before redeeming an invitation', { reason: 'guest_not_allowed' });
    const now = this.now();
    const { cfg } = await this.config();
    const hash = hashInviteCode(code);
    const invalid = () => new ValidationFailed({ reason: 'invite_invalid', issues: [{ path: 'code', code: 'invite_invalid', message: 'invitation code is invalid or expired' }] }, 'Invalid invitation code');
    let fresh = false;
    const out = await this.dbs.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(opsBetaInvites).where(eq(opsBetaInvites.codeHash, hash)).for('update').limit(1);
      if (!inv) throw invalid();
      if (inv.status === 'redeemed') {
        if (inv.redeemedBy !== user.id) throw new Conflict('Invitation code already used', { reason: 'invite_used' });
        return { inv, grant: inv.grantResult };
      }
      if (inv.status !== 'sent' || !inv.expiresAt || inv.expiresAt < now) throw invalid();
      const [other] = await tx.select({ id: opsBetaInvites.id }).from(opsBetaInvites).where(eq(opsBetaInvites.redeemedBy, user.id)).limit(1);
      if (other) throw new Conflict('You already joined the beta', { reason: 'already_beta' });
      const grant = await this.grants.grant(tx, user.id, { inviteId: inv.id, program: inv.program, trialDays: cfg.trial_days, credits: cfg.credits, creditValidDays: cfg.credit_valid_days, now });
      await this.users.grantRole(tx, { userId: user.id, roleCode: BETA_TESTER_ROLE });
      const grantResult = { subscription_id: grant.subscription_id, trial_ends_at: grant.trial_ends_at, trial_skipped: grant.trial_skipped, credits: grant.credits_granted, ledger_id: grant.ledger_id };
      const [after] = await tx.update(opsBetaInvites).set({ status: 'redeemed', redeemedBy: user.id, redeemedAt: now, grantResult }).where(eq(opsBetaInvites.id, inv.id)).returning();
      if (inv.waitlistEntryId) await tx.update(opsWaitlistEntries).set({ status: 'joined' }).where(eq(opsWaitlistEntries.id, inv.waitlistEntryId));
      await this.audit.log({ action: 'beta.redeemed', actorUserId: user.id, actorRole: user.roles.join(','), entityType: 'beta_invite', entityId: inv.id, after: { program: inv.program, ...grantResult }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }, tx);
      await this.outbox.write(tx, { aggregateType: 'beta_invite', aggregateId: inv.id, eventType: DOMAIN_EVENTS.BETA_REDEEMED, payload: { invite_id: inv.id, user_id: user.id, program: inv.program, credits: grant.credits_granted, trial: !grant.trial_skipped } });
      fresh = true;
      return { inv: after!, grant: grantResult };
    });
    if (fresh) {
      await this.entitlements.invalidate(user.id);
      await this.redis.safe((r) => r.set(this.akey(user.id), '1', 'EX', 300));
      this.outbox.emitLocal('credits.changed', { user_id: user.id });
      this.outbox.emitLocal('entitlements.changed', { user_id: user.id });
      this.outbox.emitLocal(DOMAIN_EVENTS.BETA_REDEEMED, { invite_id: out.inv.id, user_id: user.id, program: out.inv.program });
      GROWTH_METRICS.betaInvites.inc({ result: 'redeemed' });
    }
    const [survey] = await this.dbs.db.select({ id: opsSurveyResponses.id }).from(opsSurveyResponses).where(and(eq(opsSurveyResponses.userId, user.id), eq(opsSurveyResponses.kind, 'beta_onboarding'))).limit(1);
    const g = (out.grant ?? {}) as { trial_ends_at?: string | null; trial_skipped?: 'already_pro' | null; credits?: number };
    const balance = await this.credits.balance(user.id);
    return { status: fresh ? 'redeemed' : 'already_redeemed', invite_id: out.inv.id, program: out.inv.program, trial_ends_at: g.trial_ends_at ?? null, trial_skipped: g.trial_skipped ?? null, credits_granted: fresh ? (g.credits ?? 0) : 0, balance, survey_pending: !survey };
  }
}
