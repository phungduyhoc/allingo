import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { InsufficientCredits } from '../../shared/http/errors.js';

const { billingCreditBalances, billingCreditLedger } = schema;

export type CreditReason = 'purchase' | 'subscription_grant' | 'referral' | 'promo' | 'consume' | 'refund' | 'expire' | 'admin_adjust' | 'b2b_pool';

/**
 * Credit ledger append-only + số dư (ADR-0011, CLAUDE.md §5.6). Mọi thay đổi đi qua đây trong transaction của nghiệp vụ.
 * Không bao giờ cập nhật trực tiếp billing.credit_balances ngoài service này.
 */
@Injectable()
export class CreditService {
  constructor(private readonly dbs: DbService) {}

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

  /** Hoàn credit khi tác vụ AI thất bại */
  refund(tx: DbOrTx, userId: string, amount: number, ref: { refType?: string; refId?: string; aiTaskId?: string; note?: string }) {
    if (amount <= 0) return Promise.resolve({ balanceAfter: 0, ledgerId: 0 });
    return this.apply(tx, userId, amount, 'refund', ref);
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
