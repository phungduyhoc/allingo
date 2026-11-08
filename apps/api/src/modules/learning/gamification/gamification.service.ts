import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { isValidTimeZone, localDate, zonedDayStart, addDays } from '@allingo/planner';
import { DOMAIN_EVENTS, XP_TABLE, levelForXp, type Badge, type XpKind } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../../shared/db/db.module.js';
import { OutboxService } from '../../../shared/events/outbox.service.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { FeatureGateService } from '../../billing/index.js';
import { UsersService } from '../../iam/index.js';
import { AttemptsService } from '../../test-engine/index.js';
import { applyStudyDay, effectiveStreak, evaluateBadgeRule, type BadgeFacts, type BadgeRule, type StreakState } from './rules.js';

const { learnStreaks, learnXpEvents, learnBadges, learnUserBadges } = schema;
type Tx = Parameters<Parameters<DbService['db']['transaction']>[0]>[0];
const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

export interface AttemptGradedPayload {
  attempt_id: string;
  user_id: string;
  program?: string;
  mode: string;
  xp_earned: number;
  correct?: number;
  total?: number;
  scaled_score?: number | null;
  test_set_kind?: string | null;
}

/**
 * Gamification (Sprint 9 – thay khung Sprint 0 của ProgressService): XP theo bảng `packages/config/xp.ts` (idempotent theo
 * (kind, ref)), chuỗi ngày học theo múi giờ người học + đóng băng Pro (FEATURE_GATES.streak_freeze), rule engine huy hiệu chạy
 * khi có `attempt.graded` (local + outbox relay – khoá advisory theo người dùng) → `user_badges` + outbox `badge.awarded`
 * (growth gửi thông báo in-app). Không gửi thông báo trực tiếp (learning thấp tầng hơn growth – CLAUDE.md §5.1).
 */
@Injectable()
export class GamificationService {
  private readonly logger = getLogger({ component: 'learning.gamification' });

  constructor(
    private readonly dbs: DbService,
    private readonly users: UsersService,
    private readonly gate: FeatureGateService,
    private readonly attempts: AttemptsService,
    private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Múi giờ người học (iam.users.timezone; không hợp lệ → giờ VN) */
  async timezoneOf(userId: string): Promise<string> {
    const u = await this.users.findById(userId);
    return u?.timezone && isValidTimeZone(u.timezone) ? u.timezone : DEFAULT_TZ;
  }

  async todayOf(userId: string): Promise<{ tz: string; today: string }> {
    const tz = await this.timezoneOf(userId);
    return { tz, today: localDate(this.clock.now(), tz) };
  }

  /** Pro có quyền đóng băng chuỗi (entitlement streak_freeze) */
  async canFreeze(userId: string, program = 'toeic'): Promise<boolean> {
    return (await this.gate.context(userId, program)).features.has('streak_freeze');
  }

  private async lockUser(tx: DbOrTx, userId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gamification:${userId}`}))`);
  }

  /** Ghi XP một lần theo (kind, ref_type, ref_id); trả số XP đã ghi (0 nếu trùng) */
  async awardXp(tx: DbOrTx, userId: string, kind: XpKind, amount: number, ref: { type: string; id: string | null }): Promise<number> {
    if (ref.id) {
      const [dup] = await tx
        .select({ id: learnXpEvents.id })
        .from(learnXpEvents)
        .where(and(eq(learnXpEvents.userId, userId), eq(learnXpEvents.kind, kind), eq(learnXpEvents.refType, ref.type), eq(learnXpEvents.refId, ref.id)))
        .limit(1);
      if (dup) return 0;
    }
    if (amount <= 0) return 0;
    await tx.insert(learnXpEvents).values({ userId, kind, amount, refType: ref.type, refId: ref.id, createdAt: new Date(this.clock.now()) });
    return amount;
  }

  /**
   * Ngữ cảnh ngày học (ngày theo múi giờ người học + quyền đóng băng) – S11: GỌI TRƯỚC khi mở transaction. Đọc qua pool chung
   * (users, entitlement) trong lúc đang giữ một kết nối transaction gây deadlock pool khi tải cao (≥ DB_POOL_MAX transaction cùng
   * chờ kết nối thứ hai – phát hiện ở load test S11, docs/perf/report-S11.md).
   */
  async studyDayContext(userId: string, program: string): Promise<{ today: string; canFreeze: boolean }> {
    const [{ today }, canFreeze] = await Promise.all([this.todayOf(userId), this.canFreeze(userId, program)]);
    return { today, canFreeze };
  }

  /** Ghi nhận một ngày học (chuỗi theo giờ người học); +XP streak_day lần đầu trong ngày. Gọi trong transaction đã khoá người dùng. */
  async recordStudyDay(tx: Tx, userId: string, program: string, pre?: { today: string; canFreeze: boolean }): Promise<{ streak: number; incremented: boolean; freezeUsed: boolean }> {
    const { today, canFreeze } = pre ?? (await this.studyDayContext(userId, program));
    const [row] = await tx.select().from(learnStreaks).where(eq(learnStreaks.userId, userId)).for('update').limit(1);
    const prev: StreakState | null = row ? { currentStreak: row.currentStreak, longestStreak: row.longestStreak, lastActiveDate: row.lastActiveDate ?? null, freezeAvailableAt: row.freezeAvailableAt ?? null, freezesUsed: row.freezesUsed } : null;
    const r = applyStudyDay(prev, today, canFreeze);
    if (!r.incremented) return { streak: r.next.currentStreak, incremented: false, freezeUsed: false };
    const values = { currentStreak: r.next.currentStreak, longestStreak: r.next.longestStreak, lastActiveDate: r.next.lastActiveDate, freezeAvailableAt: r.next.freezeAvailableAt, freezesUsed: r.next.freezesUsed, updatedAt: new Date(this.clock.now()) };
    if (row) await tx.update(learnStreaks).set(values).where(eq(learnStreaks.userId, userId));
    else await tx.insert(learnStreaks).values({ userId, ...values });
    await tx.insert(learnXpEvents).values({ userId, kind: 'streak_day', amount: XP_TABLE.streak_day, refType: 'streak', refId: null, createdAt: new Date(this.clock.now()) });
    if (r.freezeUsed) this.logger.info({ streak: r.next.currentStreak }, 'streak freeze used');
    return { streak: r.next.currentStreak, incremented: true, freezeUsed: r.freezeUsed };
  }

  // ------------------------------------------------------------------ sự kiện
  @OnEvent('local.attempt.graded')
  async onLocalGraded(payload: AttemptGradedPayload): Promise<void> {
    await this.onAttemptGraded(payload).catch((err: Error) => this.logger.error({ err: err.message, attempt_id: payload?.attempt_id }, 'xp/streak/badge update failed'));
  }

  @OnEvent('outbox.attempt.graded')
  async onOutboxGraded(ev: { payload: AttemptGradedPayload }): Promise<void> {
    await this.onLocalGraded(ev.payload);
  }

  /** attempt.graded → XP (một lần/attempt) + ngày học + huy hiệu. Idempotent (local + relay cùng tới). */
  async onAttemptGraded(p: AttemptGradedPayload): Promise<{ xp: number; awarded: string[] }> {
    if (!p?.attempt_id || !p.user_id) return { xp: 0, awarded: [] };
    const program = p.program ?? 'toeic';
    const kind: XpKind = p.mode === 'diagnostic' ? 'diagnostic_completed' : p.mode === 'exam' && (p.total ?? 0) >= 100 ? 'attempt_full_test_submitted' : 'attempt_submitted';
    // S11: mọi đọc ngoài transaction làm TRƯỚC (deadlock pool khi tải cao – xem studyDayContext)
    const [pre, base] = await Promise.all([this.studyDayContext(p.user_id, program), this.badgeFactsBase(p.user_id, program)]);
    const awarded = await this.dbs.db.transaction(async (tx) => {
      await this.lockUser(tx, p.user_id);
      const [dup] = await tx.select({ id: learnXpEvents.id }).from(learnXpEvents).where(and(eq(learnXpEvents.refType, 'attempt'), eq(learnXpEvents.refId, p.attempt_id))).limit(1);
      if (dup) return null;
      await tx.insert(learnXpEvents).values({ userId: p.user_id, kind, amount: Math.max(0, p.xp_earned ?? 0), refType: 'attempt', refId: p.attempt_id, createdAt: new Date(this.clock.now()) });
      await this.recordStudyDay(tx, p.user_id, program, pre);
      return this.evaluateBadges(tx, p.user_id, program, base);
    });
    if (awarded === null) return { xp: 0, awarded: [] };
    for (const a of awarded) this.outbox.emitLocal(DOMAIN_EVENTS.BADGE_AWARDED, a);
    return { xp: p.xp_earned ?? 0, awarded: awarded.map((a) => a.badge_code) };
  }

  // ------------------------------------------------------------------ huy hiệu
  /** Phần dữ kiện huy hiệu đọc từ test-engine (pool chung, không đổi trong transaction gamification) */
  async badgeFactsBase(userId: string, program: string) {
    const [graded, fulls, answered, history] = await Promise.all([this.attempts.countGraded(userId, program), this.attempts.gradedCountByKind(userId, 'full'), this.attempts.answeredTotal(userId), this.attempts.statsSource(userId, program)]);
    return { graded, fulls, answered, history };
  }

  async badgeFacts(userId: string, program: string, db: DbOrTx = this.dbs.db, pre?: Awaited<ReturnType<GamificationService['badgeFactsBase']>>): Promise<BadgeFacts> {
    const [base, streak] = await Promise.all([pre ?? this.badgeFactsBase(userId, program), db.select().from(learnStreaks).where(eq(learnStreaks.userId, userId)).limit(1).then((r) => r[0] ?? null)]);
    const { graded, fulls, answered, history } = base;
    const scored = history.filter((a) => a.scaled !== null && (a.mode === 'exam' || a.mode === 'diagnostic')).map((a) => ({ at: a.submittedAt?.getTime() ?? 0, s: Number(a.scaled) }));
    scored.sort((a, b) => a.at - b.at);
    const delta = scored.length >= 2 ? Math.max(...scored.slice(1).map((x) => x.s)) - scored[0]!.s : 0;
    return { attempts_graded: graded, full_tests_graded: fulls, answered_total: answered, longest_streak: streak?.longestStreak ?? 0, current_streak: streak?.currentStreak ?? 0, score_delta: delta };
  }

  /** Rule engine: trao mọi huy hiệu đạt mà chưa có; ghi outbox badge.awarded trong cùng transaction */
  async evaluateBadges(tx: Tx, userId: string, program: string, base?: Awaited<ReturnType<GamificationService['badgeFactsBase']>>): Promise<Array<{ user_id: string; badge_code: string; name: unknown; earned_at: string }>> {
    const [all, mine] = await Promise.all([tx.select().from(learnBadges), tx.select({ code: learnUserBadges.badgeCode }).from(learnUserBadges).where(eq(learnUserBadges.userId, userId))]);
    const have = new Set(mine.map((m) => m.code));
    const pending = all.filter((b) => !have.has(b.code));
    if (!pending.length) return [];
    const facts = await this.badgeFacts(userId, program, tx, base);
    const out: Array<{ user_id: string; badge_code: string; name: unknown; earned_at: string }> = [];
    for (const b of pending) {
      if (!evaluateBadgeRule(b.rule as BadgeRule, facts).earned) continue;
      const earnedAt = new Date(this.clock.now());
      const [ins] = await tx.insert(learnUserBadges).values({ userId, badgeCode: b.code, earnedAt }).onConflictDoNothing().returning({ code: learnUserBadges.badgeCode });
      if (!ins) continue;
      const ev = { user_id: userId, badge_code: b.code, name: b.name, earned_at: earnedAt.toISOString() };
      await this.outbox.write(tx, { aggregateType: 'user', aggregateId: userId, eventType: DOMAIN_EVENTS.BADGE_AWARDED, payload: ev });
      out.push(ev);
    }
    return out;
  }

  /** GET /me/badges: mọi huy hiệu + đã đạt + tiến độ */
  async badges(userId: string, program: string): Promise<{ data: Badge[]; earned_count: number }> {
    const [all, mine, facts] = await Promise.all([
      this.dbs.db.select().from(learnBadges).orderBy(learnBadges.code),
      this.dbs.db.select().from(learnUserBadges).where(eq(learnUserBadges.userId, userId)),
      this.badgeFacts(userId, program),
    ]);
    const earned = new Map(mine.map((m) => [m.badgeCode, m.earnedAt]));
    const data = all.map((b) => {
      const ev = evaluateBadgeRule(b.rule as BadgeRule, facts);
      const at = earned.get(b.code);
      return { code: b.code, name: b.name as Badge['name'], rule: b.rule as Record<string, unknown>, earned: !!at, earned_at: at ? at.toISOString() : null, progress: ev.progress ? (at ? { current: ev.progress.target, target: ev.progress.target } : ev.progress) : null };
    });
    data.sort((a, b) => Number(b.earned) - Number(a.earned) || (b.earned_at ?? '').localeCompare(a.earned_at ?? '') || a.code.localeCompare(b.code));
    return { data, earned_count: data.filter((d) => d.earned).length };
  }

  // ------------------------------------------------------------------ đọc
  async streakView(userId: string, program = 'toeic') {
    const [{ today }, canFreeze, row] = await Promise.all([this.todayOf(userId), this.canFreeze(userId, program), this.dbs.db.select().from(learnStreaks).where(eq(learnStreaks.userId, userId)).limit(1).then((r) => r[0] ?? null)]);
    const s: StreakState | null = row ? { currentStreak: row.currentStreak, longestStreak: row.longestStreak, lastActiveDate: row.lastActiveDate ?? null, freezeAvailableAt: row.freezeAvailableAt ?? null, freezesUsed: row.freezesUsed } : null;
    return { ...effectiveStreak(s, today, canFreeze), last_active_date: s?.lastActiveDate ?? null, freezes_used: s?.freezesUsed ?? 0, today };
  }

  async xpSummary(userId: string): Promise<{ total: number; this_week: number; today: number; level: number; next_level_at: number }> {
    const { tz, today } = await this.todayOf(userId);
    const dayStart = zonedDayStart(today, tz);
    const weekStart = new Date(this.clock.now() - 7 * 86_400_000);
    const [r] = await this.dbs.db
      .select({
        total: sql<number>`coalesce(sum(${learnXpEvents.amount}), 0)`.mapWith(Number),
        week: sql<number>`coalesce(sum(${learnXpEvents.amount}) filter (where ${learnXpEvents.createdAt} >= ${weekStart.toISOString()}::timestamptz), 0)`.mapWith(Number),
        today: sql<number>`coalesce(sum(${learnXpEvents.amount}) filter (where ${learnXpEvents.createdAt} >= ${dayStart.toISOString()}::timestamptz), 0)`.mapWith(Number),
      })
      .from(learnXpEvents)
      .where(eq(learnXpEvents.userId, userId));
    const lv = levelForXp(r?.total ?? 0);
    return { total: r?.total ?? 0, this_week: r?.week ?? 0, today: r?.today ?? 0, level: lv.level, next_level_at: lv.next_at };
  }

  async latestBadges(userId: string, limit = 3): Promise<{ earned: number; total: number; latest: Array<{ code: string; earned_at: string }> }> {
    const [mine, total] = await Promise.all([
      this.dbs.db.select().from(learnUserBadges).where(eq(learnUserBadges.userId, userId)).orderBy(desc(learnUserBadges.earnedAt)),
      this.dbs.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(learnBadges).then((r) => r[0]?.n ?? 0),
    ]);
    return { earned: mine.length, total, latest: mine.slice(0, limit).map((m) => ({ code: m.badgeCode, earned_at: m.earnedAt.toISOString() })) };
  }

  /** Đã học trong ngày `local` (giờ người học): chuỗi đã ghi hôm nay hoặc có bài nộp/lưu nháp trong ngày */
  async studiedOn(userId: string, local: string, tz: string): Promise<boolean> {
    const [row] = await this.dbs.db.select({ last: learnStreaks.lastActiveDate }).from(learnStreaks).where(eq(learnStreaks.userId, userId)).limit(1);
    if (row?.last && row.last >= local) return true;
    return this.attempts.activeBetween(userId, zonedDayStart(local, tz), zonedDayStart(addDays(local, 1), tz));
  }

  /** Ứng viên nhắc chuỗi sắp mất: có chuỗi > 0 và học gần đây (lọc theo giờ người học ở growth) */
  async streakCandidates(sinceDate: string, limit = 5000): Promise<Array<{ userId: string; current: number; lastActiveDate: string }>> {
    const rows = await this.dbs.db
      .select({ userId: learnStreaks.userId, current: learnStreaks.currentStreak, last: learnStreaks.lastActiveDate })
      .from(learnStreaks)
      .where(and(sql`${learnStreaks.currentStreak} > 0`, gte(learnStreaks.lastActiveDate, sinceDate)))
      .limit(limit);
    return rows.filter((r) => r.last).map((r) => ({ userId: r.userId, current: r.current, lastActiveDate: r.last! }));
  }

  /** Huy hiệu theo mã (thông báo) */
  async badgeNames(codes: string[]): Promise<Map<string, unknown>> {
    if (!codes.length) return new Map();
    const rows = await this.dbs.db.select().from(learnBadges).where(inArray(learnBadges.code, codes));
    return new Map(rows.map((r) => [r.code, r.name]));
  }
}
