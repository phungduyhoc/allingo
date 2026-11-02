import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { LedgerEntry } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { decodeCursor, encodeCursor } from '../../shared/http/cursor.js';
import { Conflict, InsufficientCredits } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { remainingFor, type LedgerLike } from './credit-lots.js';

const { billingCreditBalances, billingCreditLedger } = schema;

export type CreditReason = 'purchase' | 'subscription_grant' | 'referral' | 'promo' | 'consume' | 'refund' | 'expire' | 'admin_adjust' | 'b2b_pool';

/**
 * Credit ledger append-only + số dư (ADR-0011, CLAUDE.md §5.6). Mọi thay đổi đi qua đây trong transaction của nghiệp vụ.
 * Không bao giờ cập nhật trực tiếp billing.credit_balances ngoài service này.
 */
@Injectable()
export class CreditService {
  private readonly logger = getLogger({ component: 'billing.credits' });
  constructor(
    private readonly dbs: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async balance(userId: string, db: DbOrTx = this.dbs.db): Promise<number> {
    const [row] = await db.select({ balance: billingCreditBalances.balance }).from(billingCreditBalances).where(and(eq(billingCreditBalances.ownerType, 'user'), eq(billingCreditBalances.ownerId, userId))).limit(1);
    return row?.balance ?? 0;
  }

  /** Khoá hàng số dư (FOR UPDATE) – tạo nếu chưa có */
  private async lockBalance(tx: DbOrTx, userId: string): Promise<number> {
    await tx.insert(billingCreditBalances).values({ ownerType: 'user', ownerId: userId, balance: 0 }).onConflictDoNothing();
    const [row] = await tx.select({ balance: billingCreditBalances.balance }).from(billingCreditBalances).where(and(eq(billingCreditBalances.ownerType, 'user'), eq(billingCreditBalances.ownerId, userId))).for('update');
    return row?.balance ?? 0;
  }

  private async apply(tx: DbOrTx, userId: string, delta: number, reason: CreditReason, ref: { refType?: string; refId?: string; aiTaskId?: string; note?: string; expiresAt?: Date }): Promise<{ balanceAfter: number; ledgerId: number }> {
    const current = await this.lockBalance(tx, userId);
    const after = current + delta;
    if (after < 0) throw new InsufficientCredits({ required: -delta, balance: current });
    const [ledger] = await tx
      .insert(billingCreditLedger)
      .values({ userId, delta, balanceAfter: after, reason, refType: ref.refType ?? null, refId: ref.refId ?? null, aiTaskId: ref.aiTaskId ?? null, note: ref.note ?? null, expiresAt: ref.expiresAt ?? null })
      .returning({ id: billingCreditLedger.id });
    await tx.update(billingCreditBalances).set({ balance: after, updatedAt: new Date() }).where(and(eq(billingCreditBalances.ownerType, 'user'), eq(billingCreditBalances.ownerId, userId)));
    return { balanceAfter: after, ledgerId: Number(ledger!.id) };
  }

  /** Trừ credit (amount > 0). Ném InsufficientCredits (402) nếu không đủ. */
  charge(tx: DbOrTx, userId: string, amount: number, ref: { refType?: string; refId?: string; aiTaskId?: string; note?: string }) {
    if (amount <= 0) return Promise.resolve({ balanceAfter: 0, ledgerId: 0 });
    return this.apply(tx, userId, -amount, 'consume', ref);
  }

  /** Cộng credit (mua gói, cấp tháng, referral, admin) */
  grant(tx: DbOrTx, userId: string, amount: number, reason: Exclude<CreditReason, 'consume' | 'refund' | 'expire'>, ref: { refType?: string; refId?: string; note?: string; expiresAt?: Date }) {
    return this.apply(tx, userId, amount, reason, ref);
  }

  /** Khoá hàng số dư (FOR UPDATE) trong transaction của nghiệp vụ – cho kiểm tra idempotent trước khi cấp (S8) */
  lock(tx: DbOrTx, userId: string): Promise<number> {
    return this.lockBalance(tx, userId);
  }

  /**
   * Điều chỉnh thủ công của admin (S8, reason `admin_adjust`): delta > 0 cộng (có thể có hạn), delta < 0 trừ nhưng KHÔNG làm số
   * dư âm (409 `insufficient_balance`). `refType = admin`, `refId` = admin thực hiện, `note` = lý do bắt buộc.
   */
  async adjust(tx: DbOrTx, userId: string, delta: number, ref: { actorId: string; note: string; expiresAt?: Date }): Promise<{ balanceAfter: number; ledgerId: number }> {
    const current = await this.lockBalance(tx, userId);
    if (current + delta < 0) throw new Conflict('Adjustment would make the balance negative', { reason: 'insufficient_balance', balance: current, delta });
    return this.apply(tx, userId, delta, 'admin_adjust', { refType: 'admin', refId: ref.actorId, note: ref.note, expiresAt: delta > 0 ? ref.expiresAt : undefined });
  }

  /** Tổng delta theo lý do (vd credit nhận từ referral) */
  async sumByReason(userId: string, reason: CreditReason): Promise<number> {
    const [r] = await this.dbs.db.select({ n: sql<number>`coalesce(sum(${billingCreditLedger.delta}), 0)::int` }).from(billingCreditLedger).where(and(eq(billingCreditLedger.userId, userId), eq(billingCreditLedger.reason, reason)));
    return r?.n ?? 0;
  }

  /** Hoàn credit khi tác vụ AI thất bại */
  refund(tx: DbOrTx, userId: string, amount: number, ref: { refType?: string; refId?: string; aiTaskId?: string; note?: string }) {
    if (amount <= 0) return Promise.resolve({ balanceAfter: 0, ledgerId: 0 });
    return this.apply(tx, userId, amount, 'refund', ref);
  }

  /**
   * Thu hồi credit (số âm) KHÔNG làm số dư âm (A92): trừ min(amount, số dư hiện tại); phần thiếu (đã tiêu) chỉ ghi vào `note`.
   * Dùng cho hoàn tiền đơn (`refund`) và hết hạn lô (`expire`). Trả số thực trừ và phần thiếu.
   */
  async revoke(tx: DbOrTx, userId: string, amount: number, reason: 'refund' | 'expire', ref: { refType: string; refId: string; note?: string }): Promise<{ revoked: number; shortfall: number; balanceAfter: number }> {
    if (amount <= 0) return { revoked: 0, shortfall: 0, balanceAfter: await this.balance(userId, tx) };
    const current = await this.lockBalance(tx, userId);
    const revoked = Math.min(amount, current);
    const shortfall = amount - revoked;
    if (revoked === 0) return { revoked: 0, shortfall, balanceAfter: current };
    const note = [ref.note, shortfall > 0 ? `shortfall=${shortfall}` : null].filter(Boolean).join(' ') || null;
    const r = await this.apply(tx, userId, -revoked, reason, { refType: ref.refType, refId: ref.refId, note: note ?? undefined });
    return { revoked, shortfall, balanceAfter: r.balanceAfter };
  }

  /** Dòng ledger của người dùng (thứ tự id) để phân bổ lô – gọi trong tx đã khoá số dư */
  async ledgerRows(userId: string, db: DbOrTx = this.dbs.db): Promise<LedgerLike[]> {
    const rows = await db
      .select({ id: billingCreditLedger.id, delta: billingCreditLedger.delta, reason: billingCreditLedger.reason, refType: billingCreditLedger.refType, refId: billingCreditLedger.refId, expiresAt: billingCreditLedger.expiresAt, createdAt: billingCreditLedger.createdAt })
      .from(billingCreditLedger)
      .where(eq(billingCreditLedger.userId, userId))
      .orderBy(asc(billingCreditLedger.id));
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  /** Phần credit còn lại của các lô do một tham chiếu cấp (vd `order:<id>`, `subscription:<id>`) */
  async remainingOf(tx: DbOrTx, userId: string, ref: { refType: string; refId: string }): Promise<number> {
    return remainingFor(await this.ledgerRows(userId, tx), ref);
  }

  /**
   * Job credit.expire: lô có `expires_at ≤ now` (gói credit 12 tháng) chưa có dòng `expire` cùng tham chiếu → ghi `expire`
   * đúng phần còn lại (FIFO theo hạn, credit-lots.ts). Idempotent: dòng `expire` theo (ref_type, ref_id); chỉ quét lô hết hạn
   * trong 60 ngày gần nhất (lô đã tiêu hết không ghi dòng 0).
   */
  async expireDue(now: Date = new Date(this.clock.now())): Promise<{ lots: number; expired: number }> {
    const lots = await this.dbs.db
      .select({ id: billingCreditLedger.id, userId: billingCreditLedger.userId, refType: billingCreditLedger.refType, refId: billingCreditLedger.refId })
      .from(billingCreditLedger)
      .where(
        and(
          gt(billingCreditLedger.delta, 0),
          isNotNull(billingCreditLedger.expiresAt),
          lte(billingCreditLedger.expiresAt, now),
          gt(billingCreditLedger.expiresAt, new Date(now.getTime() - 60 * 86_400_000)),
          isNotNull(billingCreditLedger.refId),
          sql`not exists (select 1 from billing.credit_ledger e where e.reason = 'expire' and e.ref_type = ${billingCreditLedger.refType} and e.ref_id = ${billingCreditLedger.refId} and e.user_id = ${billingCreditLedger.userId})`,
        ),
      )
      .orderBy(asc(billingCreditLedger.id))
      .limit(500);
    let expired = 0;
    for (const lot of lots) {
      if (!lot.userId || !lot.refType || !lot.refId) continue;
      const userId = lot.userId;
      const ref = { refType: lot.refType, refId: lot.refId };
      expired += await this.dbs.db.transaction(async (tx) => {
        await this.lockBalance(tx, userId);
        const [done] = await tx.select({ id: billingCreditLedger.id }).from(billingCreditLedger).where(and(eq(billingCreditLedger.userId, userId), eq(billingCreditLedger.reason, 'expire'), eq(billingCreditLedger.refType, ref.refType), eq(billingCreditLedger.refId, ref.refId))).limit(1);
        if (done) return 0;
        const remaining = await this.remainingOf(tx, userId, ref);
        if (remaining <= 0) return 0;
        const r = await this.revoke(tx, userId, remaining, 'expire', { ...ref, note: `lot=${Number(lot.id)}` });
        return r.revoked;
      });
    }
    if (expired) this.logger.info({ lots: lots.length, expired }, 'credit lots expired');
    return { lots: lots.length, expired };
  }

  /** GET /me/credits/ledger – cursor theo id giảm dần */
  async ledgerPage(userId: string, cursor: string | undefined, limit: number): Promise<{ data: LedgerEntry[]; next_cursor: string | null }> {
    const c = decodeCursor<{ id: number }>(cursor);
    const rows = await this.dbs.db
      .select()
      .from(billingCreditLedger)
      .where(and(eq(billingCreditLedger.userId, userId), c?.id ? lt(billingCreditLedger.id, BigInt(c.id)) : undefined))
      .orderBy(desc(billingCreditLedger.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      data: page.map((r) => ({ id: Number(r.id), delta: r.delta, balance_after: r.balanceAfter, reason: r.reason, ref: r.refType ? { type: r.refType, id: r.refId ?? null } : null, expires_at: r.expiresAt?.toISOString() ?? null, note: r.note ?? null, created_at: r.createdAt.toISOString() })),
      next_cursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1]!.id) }) : null,
    };
  }

  /** Kiểm tra đủ credit trước khi gọi model (không khoá) */
  async hasAtLeast(userId: string, amount: number): Promise<boolean> {
    return (await this.balance(userId)) >= amount;
  }

  async ledger(userId: string, limit = 50) {
    return this.dbs.db.select().from(billingCreditLedger).where(eq(billingCreditLedger.userId, userId)).orderBy(desc(billingCreditLedger.id)).limit(limit);
  }

  async expiringSoon(userId: string, withinDays = 30): Promise<Array<{ amount: number; expires_at: string }>> {
    const rows = await this.dbs.db
      .select({ delta: billingCreditLedger.delta, expiresAt: billingCreditLedger.expiresAt })
      .from(billingCreditLedger)
      .where(and(eq(billingCreditLedger.userId, userId), isNotNull(billingCreditLedger.expiresAt), gt(billingCreditLedger.delta, 0), sql`${billingCreditLedger.expiresAt} < now() + make_interval(days => ${withinDays})`))
      .orderBy(billingCreditLedger.expiresAt);
    return rows.map((r) => ({ amount: r.delta, expires_at: r.expiresAt!.toISOString() }));
  }
}
