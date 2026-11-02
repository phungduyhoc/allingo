import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS, type ReferralConfig, type ReferralLanding, type ReferralStage, type ReferralSummary } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService } from '../../../shared/db/db.module.js';
import { AuditService } from '../../../shared/events/audit.service.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { Forbidden } from '../../../shared/http/errors.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { CreditService, FeatureFlagService } from '../../billing/index.js';
import { UsersService } from '../../iam/index.js';
import { detectReferralAbuse, isRetryableSkip, maskName, referralRewardDecision, resolveReferralConfig } from './referral-rules.js';

const { iamReferrals } = schema;
type ReferralRow = typeof iamReferrals.$inferSelect;

export const REFERRAL_FLAG = 'ff.growth.referral';
const PRO_KINDS = new Set(['monthly', 'yearly', 'lifetime', 'combo']);
const UTM = 'utm_source=referral&utm_medium=share&utm_campaign=referral';

interface ReferralMeta {
  skipped?: Partial<Record<ReferralStage, string>>;
  rewards?: Partial<Record<ReferralStage, { referrer: number; referee: number; at: string }>>;
  utm?: Record<string, string>;
}

const vnMonthStart = (d: Date) => {
  const t = new Date(d.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - 7 * 3600_000);
};

/**
 * Referral (growth, Sprint 8 – ADR-0030). growth sở hữu `iam.referrals` (bảng nằm schema iam theo DDL, nghiệp vụ ở growth);
 * mã giới thiệu và tín hiệu thiết bị đọc qua UsersService (iam), credit qua CreditService (billing).
 * Chuỗi trạng thái qua outbox (local + relay): `user.registered` có `referral_code` → joined; `attempt.graded` đầu tiên → started;
 * `order.paid` gói Pro → upgraded. Thưởng credit hai chiều theo cấu hình ở mốc started và upgraded (ledger reason `referral`).
 * Chống lạm dụng: cùng thiết bị/IP 24 giờ (blocked_reason), tối đa monthly_cap lần thưởng/tháng/người giới thiệu, tài khoản chưa
 * xác minh không thưởng (cấp bù ở mốc sau khi đã xác minh).
 */
@Injectable()
export class ReferralService {
  private readonly logger = getLogger({ component: 'growth.referral' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly credits: CreditService,
    private readonly flags: FeatureFlagService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date(this.clock.now());
  }

  async config(): Promise<{ enabled: boolean; config: ReferralConfig }> {
    const f = await this.flags.get(REFERRAL_FLAG);
    return { enabled: f?.enabled ?? false, config: resolveReferralConfig(f?.rules?.config) };
  }

  private shareBase(): string {
    return (this.env.REFERRAL_SHARE_BASE_URL ?? `${this.env.API_PUBLIC_URL.replace(/\/+$/, '')}/v1/r`).replace(/\/+$/, '');
  }

  link(code: string): string {
    return `${this.shareBase()}/${code}?${UTM}`;
  }

  landingUrl(code: string): string {
    return `${this.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/register?ref=${encodeURIComponent(code)}&${UTM}`;
  }

  ogImage(): string {
    return this.env.REFERRAL_OG_IMAGE_URL ?? `${this.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/og/referral.png`;
  }

  // ------------------------------------------------------------------ GET /me/referral
  async summary(user: { id: string; isGuest: boolean }): Promise<ReferralSummary> {
    if (user.isGuest) throw new Forbidden('Guest accounts cannot refer – register first', { reason: 'guest_account' });
    const code = await this.users.referralCode(user.id);
    const { enabled, config } = await this.config();
    const now = this.now();
    const monthStart = vnMonthStart(now);
    const [stats] = await this.dbs.db
      .select({
        joined: sql<number>`count(*)::int`,
        started: sql<number>`count(*) filter (where ${iamReferrals.status} in ('started','upgraded'))::int`,
        upgraded: sql<number>`count(*) filter (where ${iamReferrals.status} = 'upgraded')::int`,
        monthRewards: sql<number>`(count(*) filter (where ${iamReferrals.creditedJoinAt} >= ${monthStart.toISOString()}::timestamptz) + count(*) filter (where ${iamReferrals.creditedUpgradeAt} >= ${monthStart.toISOString()}::timestamptz))::int`,
        skipped: sql<number>`(count(*) filter (where ${iamReferrals.blockedReason} is not null) + count(*) filter (where ${iamReferrals.blockedReason} is null and jsonb_typeof(${iamReferrals.metadata}->'skipped') = 'object' and ${iamReferrals.metadata}->'skipped' <> '{}'::jsonb))::int`,
      })
      .from(iamReferrals)
      .where(eq(iamReferrals.referrerUserId, user.id));
    const recent = await this.dbs.db.select().from(iamReferrals).where(eq(iamReferrals.referrerUserId, user.id)).orderBy(desc(iamReferrals.createdAt)).limit(20);
    const names = await Promise.all(recent.map((r) => (r.refereeUserId ? this.users.findById(r.refereeUserId) : Promise.resolve(null))));
    const link = this.link(code);
    const { title, description } = this.ogText(config);
    return {
      code,
      link,
      landing_url: this.landingUrl(code),
      share: {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
        // Zalo không có URL chia sẻ công khai không cần OA – web dùng Zalo Share SDK với data-href = link
        zalo: link,
        messenger: `fb-messenger://share/?link=${encodeURIComponent(link)}`,
        text: `${description} ${link}`,
      },
      og: { title, description, image: this.ogImage() },
      enabled,
      joined: stats?.joined ?? 0,
      started: stats?.started ?? 0,
      upgraded: stats?.upgraded ?? 0,
      credits_earned: await this.credits.sumByReason(user.id, 'referral'),
      rewards: { this_month: stats?.monthRewards ?? 0, monthly_cap: config.monthly_cap, skipped: stats?.skipped ?? 0 },
      config: { rewards: config.rewards, monthly_cap: config.monthly_cap },
      recent: recent.map((r, i) => ({
        id: r.id,
        display_name: maskName(names[i]?.displayName),
        status: r.status,
        joined_at: r.createdAt.toISOString(),
        started_at: r.startedAt?.toISOString() ?? null,
        upgraded_at: r.upgradedAt?.toISOString() ?? null,
        rewarded: { started: !!r.creditedJoinAt, upgraded: !!r.creditedUpgradeAt },
        blocked_reason: (r.blockedReason as 'self_referral' | 'duplicate_device' | 'duplicate_ip' | null) ?? null,
      })),
    };
  }

  private ogText(config: ReferralConfig): { title: string; description: string } {
    const credits = config.rewards.started.referee;
    return { title: 'Luyện thi TOEIC · IELTS · JLPT · HSK cùng AI – Allingo', description: credits > 0 ? `Nhận ${credits} credit AI miễn phí khi bắt đầu luyện thi với Allingo.` : 'Luyện đề đúng định dạng, AI giải thích từng câu.' };
  }

  // ------------------------------------------------------------------ trang chia sẻ (công khai)
  async landing(code: string): Promise<ReferralLanding> {
    const { config } = await this.config();
    const referrer = await this.users.findByReferralCode(code);
    const c = code.trim().toUpperCase();
    const { title, description } = this.ogText(config);
    return {
      code: c,
      valid: !!referrer && referrer.status === 'active',
      referrer_name: referrer ? maskName(referrer.displayName) : null,
      reward: { referee_started: config.rewards.started.referee, referee_upgraded: config.rewards.upgraded.referee },
      og: { title, description, image: this.ogImage(), url: this.link(c) },
      register_url: this.landingUrl(c),
    };
  }

  /** HTML tối thiểu cho crawler Facebook/Zalo (OG) + chuyển hướng về trang đăng ký của web (giữ UTM) */
  async landingHtml(code: string, query: Record<string, string | undefined>): Promise<string> {
    const l = await this.landing(code);
    const u = new URL(l.register_url);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) if (query[k]) u.searchParams.set(k, String(query[k]).slice(0, 100));
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const target = esc(u.toString());
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(l.og.title)}</title><meta name="robots" content="noindex"><meta property="og:type" content="website"><meta property="og:title" content="${esc(l.og.title)}"><meta property="og:description" content="${esc(l.og.description)}"><meta property="og:image" content="${esc(l.og.image)}"><meta property="og:url" content="${esc(l.og.url)}"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${target}"></head><body><p><a href="${target}">Allingo</a></p></body></html>`;
  }

  // ------------------------------------------------------------------ chuỗi outbox
  /** user.registered có referral_code → joined (idempotent theo referee UNIQUE), đánh dấu lạm dụng */
  async onRegistered(p: { user_id?: string; referral_code?: string | null; device_fp?: string | null; ip?: string | null }): Promise<{ referral_id: string | null; blocked: string | null; created: boolean }> {
    if (!p?.user_id || !p.referral_code) return { referral_id: null, blocked: null, created: false };
    const referrer = await this.users.findByReferralCode(p.referral_code);
    if (!referrer || referrer.id === p.user_id || referrer.status !== 'active') return { referral_id: null, blocked: null, created: false };
    const [existing] = await this.dbs.db.select().from(iamReferrals).where(eq(iamReferrals.refereeUserId, p.user_id)).limit(1);
    if (existing) return { referral_id: existing.id, blocked: existing.blockedReason ?? null, created: false };
    const { config } = await this.config();
    const now = this.now();
    const since = new Date(now.getTime() - config.abuse_window_hours * 3600_000);
    const fp = p.device_fp ?? null;
    const ip = p.ip ?? null;
    const signals = await this.users.recentDeviceSignals(referrer.id, since);
    const [counts] = await this.dbs.db
      .select({
        sameFp: fp ? sql<number>`count(*) filter (where ${iamReferrals.deviceFingerprint} = ${fp})::int` : sql<number>`0`,
        sameIp: ip ? sql<number>`count(*) filter (where ${iamReferrals.referrerUserId} = ${referrer.id} and host(${iamReferrals.ip}) = ${ip})::int` : sql<number>`0`,
      })
      .from(iamReferrals)
      .where(and(gte(iamReferrals.createdAt, since), or(fp ? eq(iamReferrals.deviceFingerprint, fp) : sql`false`, ip ? sql`host(${iamReferrals.ip}) = ${ip}` : sql`false`)));
    const blocked = detectReferralAbuse({ refereeFp: fp, refereeIp: ip, referrerSignals: signals, recentSameFp: counts?.sameFp ?? 0, recentSameReferrerIp: counts?.sameIp ?? 0 });
    const [row] = await this.dbs.db
      .insert(iamReferrals)
      .values({ referrerUserId: referrer.id, refereeUserId: p.user_id, code: p.referral_code.trim().toUpperCase(), status: 'joined', deviceFingerprint: fp, ip, blockedReason: blocked, metadata: {}, createdAt: now })
      .onConflictDoNothing()
      .returning();
    if (!row) return { referral_id: null, blocked: null, created: false };
    if (blocked) await this.audit.log({ action: 'referral.blocked', entityType: 'referral', entityId: row.id, after: { reason: blocked, referrer_id: referrer.id } });
    this.logger.info({ referral_id: row.id, blocked }, 'referral joined');
    return { referral_id: row.id, blocked, created: true };
  }

  /** attempt.graded của người được giới thiệu → started (lần đầu) + thưởng mốc started */
  async onAttemptGraded(p: { user_id?: string }): Promise<void> {
    if (!p?.user_id) return;
    const [r] = await this.dbs.db.select().from(iamReferrals).where(eq(iamReferrals.refereeUserId, p.user_id)).limit(1);
    if (!r) return;
    if (r.status === 'joined') await this.dbs.db.update(iamReferrals).set({ status: 'started', startedAt: this.now() }).where(and(eq(iamReferrals.id, r.id), eq(iamReferrals.status, 'joined')));
    if (!r.creditedJoinAt) await this.reward(r.id, 'started');
  }

  /** order.paid gói Pro của người được giới thiệu → upgraded + thưởng (cấp bù started nếu chưa) */
  async onOrderPaid(p: { user_id?: string; plan_kind?: string }): Promise<void> {
    if (!p?.user_id || !p.plan_kind || !PRO_KINDS.has(p.plan_kind)) return;
    const [r] = await this.dbs.db.select().from(iamReferrals).where(eq(iamReferrals.refereeUserId, p.user_id)).limit(1);
    if (!r) return;
    const now = this.now();
    if (r.status !== 'upgraded') await this.dbs.db.update(iamReferrals).set({ status: 'upgraded', upgradedAt: now, startedAt: r.startedAt ?? now }).where(and(eq(iamReferrals.id, r.id), ne(iamReferrals.status, 'upgraded')));
    if (!r.creditedJoinAt) await this.reward(r.id, 'started');
    if (!r.creditedUpgradeAt) await this.reward(r.id, 'upgraded');
  }

  /**
   * Thưởng một mốc trong một transaction (khoá hàng referral): credit hai chiều (ledger `referral`, ref referral), đặt
   * credited_join_at (started) / credited_upgrade_at (upgraded), outbox `referral.rewarded`. Bỏ qua → metadata.skipped[stage].
   */
  async reward(referralId: string, stage: ReferralStage): Promise<{ granted: boolean; reason?: string }> {
    const { enabled, config } = await this.config();
    const now = this.now();
    const monthStart = vnMonthStart(now);
    const events: Array<Record<string, unknown>> = [];
    const out = await this.dbs.db.transaction(async (tx) => {
      const [r] = await tx.select().from(iamReferrals).where(eq(iamReferrals.id, referralId)).limit(1).for('update');
      if (!r || !r.refereeUserId) return { granted: false, reason: 'not_found' };
      const meta = (r.metadata ?? {}) as ReferralMeta;
      const prevSkip = meta.skipped?.[stage];
      if (prevSkip && !isRetryableSkip(prevSkip)) return { granted: false, reason: prevSkip };
      const credited = stage === 'started' ? !!r.creditedJoinAt : !!r.creditedUpgradeAt;
      const [{ n: monthCount } = { n: 0 }] = await tx
        .select({ n: sql<number>`(count(*) filter (where ${iamReferrals.creditedJoinAt} >= ${monthStart.toISOString()}::timestamptz) + count(*) filter (where ${iamReferrals.creditedUpgradeAt} >= ${monthStart.toISOString()}::timestamptz))::int` })
        .from(iamReferrals)
        .where(and(eq(iamReferrals.referrerUserId, r.referrerUserId), or(isNotNull(iamReferrals.creditedJoinAt), isNotNull(iamReferrals.creditedUpgradeAt))));
      const [refereeVerified, referrerVerified] = await Promise.all([this.users.isVerified(r.refereeUserId, tx), this.users.isVerified(r.referrerUserId, tx)]);
      const d = referralRewardDecision({ stage, alreadyCredited: credited, enabled, blockedReason: r.blockedReason ?? null, refereeVerified, referrerVerified, config, referrerRewardsThisMonth: monthCount });
      if (!d.grant) {
        if (d.reason !== 'already_credited') {
          const skipped = { ...(meta.skipped ?? {}), [stage]: d.reason };
          await tx.update(iamReferrals).set({ metadata: { ...meta, skipped } }).where(eq(iamReferrals.id, r.id));
        }
        return { granted: false, reason: d.reason };
      }
      const note = (side: 'referrer' | 'referee') => `${stage}:${side}`;
      if (d.referrer > 0) await this.credits.grant(tx, r.referrerUserId, d.referrer, 'referral', { refType: 'referral', refId: r.id, note: note('referrer') });
      if (d.referee > 0) await this.credits.grant(tx, r.refereeUserId, d.referee, 'referral', { refType: 'referral', refId: r.id, note: note('referee') });
      const skipped = { ...(meta.skipped ?? {}) };
      delete skipped[stage];
      const rewards = { ...(meta.rewards ?? {}), [stage]: { referrer: d.referrer, referee: d.referee, at: now.toISOString() } };
      await tx
        .update(iamReferrals)
        .set({ ...(stage === 'started' ? { creditedJoinAt: now } : { creditedUpgradeAt: now }), metadata: { ...meta, skipped, rewards } })
        .where(eq(iamReferrals.id, r.id));
      const payload = { referral_id: r.id, stage, referrer_user_id: r.referrerUserId, referee_user_id: r.refereeUserId, referrer_credits: d.referrer, referee_credits: d.referee };
      await this.outbox.write(tx, { aggregateType: 'referral', aggregateId: r.id, eventType: DOMAIN_EVENTS.REFERRAL_REWARDED, payload });
      events.push(payload);
      return { granted: true };
    });
    for (const e of events) {
      this.outbox.emitLocal(DOMAIN_EVENTS.REFERRAL_REWARDED, e);
      this.outbox.emitLocal('credits.changed', { user_id: e.referrer_user_id, balance: null });
      this.outbox.emitLocal('credits.changed', { user_id: e.referee_user_id, balance: null });
    }
    if (out.granted) this.logger.info({ referral_id: referralId, stage }, 'referral rewarded');
    else this.logger.debug({ referral_id: referralId, stage, reason: out.reason }, 'referral reward skipped');
    return out;
  }

  /** Lượt giới thiệu của người dùng (test/admin) */
  async listFor(referrerId: string): Promise<ReferralRow[]> {
    return this.dbs.db.select().from(iamReferrals).where(eq(iamReferrals.referrerUserId, referrerId)).orderBy(desc(iamReferrals.createdAt));
  }

  /** Lượt giới thiệu của người được giới thiệu trong khoảng (test) */
  async forReferee(refereeId: string): Promise<ReferralRow | null> {
    const [r] = await this.dbs.db.select().from(iamReferrals).where(eq(iamReferrals.refereeUserId, refereeId)).limit(1);
    return r ?? null;
  }

  /** Số lượt tạo trong khoảng (theo dõi) */
  async countBetween(from: Date, to: Date): Promise<number> {
    const [r] = await this.dbs.db.select({ n: sql<number>`count(*)::int` }).from(iamReferrals).where(and(gte(iamReferrals.createdAt, from), lt(iamReferrals.createdAt, to)));
    return r?.n ?? 0;
  }
}
