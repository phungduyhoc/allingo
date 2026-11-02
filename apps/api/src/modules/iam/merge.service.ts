import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import type { DbOrTx } from '../../shared/db/db.module.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { SessionRevocationService } from '../../shared/auth/session-revocation.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';

const { iamUsers, learnEnrollments, learnAttempts, learnXpEvents, learnStreaks, learnSrsCards, learnNotes, learnChatThreads, learnErrorLogEntries, billingCreditBalances, aiAiTasks, iamSessions } = schema;

/**
 * Ghép dữ liệu tài khoản khách vào tài khoản thật (master prompt §4.1 D iam, Sprint 1 S1 hoàn thiện).
 * Chạy trong transaction của đăng ký/đăng nhập. Quy tắc: enrollment trùng chương trình → giữ bản mới hơn, cộng dồn XP/streak dài hơn.
 */
@Injectable()
export class MergeService {
  private readonly logger = getLogger({ component: 'iam.merge' });
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly revocation: SessionRevocationService,
  ) {}

  async mergeGuestInto(tx: DbOrTx, guestId: string, targetId: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<{ attempts: number; enrollments: number }> {
    if (guestId === targetId) return { attempts: 0, enrollments: 0 };
    const [guest] = await tx.select({ id: iamUsers.id, isGuest: iamUsers.isGuest, status: iamUsers.status }).from(iamUsers).where(eq(iamUsers.id, guestId)).limit(1);
    if (!guest || !guest.isGuest || guest.status !== 'active') return { attempts: 0, enrollments: 0 };

    // Enrollments: chuyển những chương trình target chưa có; trùng → giữ bản có updated_at mới hơn (S1), bản kia xoá
    const guestEnrollments = await tx.select().from(learnEnrollments).where(eq(learnEnrollments.userId, guestId));
    let movedEnrollments = 0;
    for (const e of guestEnrollments) {
      const [existing] = await tx.select({ id: learnEnrollments.id, updatedAt: learnEnrollments.updatedAt }).from(learnEnrollments).where(and(eq(learnEnrollments.userId, targetId), eq(learnEnrollments.programCode, e.programCode))).limit(1);
      if (existing) {
        if (e.updatedAt > existing.updatedAt) {
          await tx.delete(learnEnrollments).where(eq(learnEnrollments.id, existing.id));
          await tx.update(learnEnrollments).set({ userId: targetId }).where(eq(learnEnrollments.id, e.id));
          movedEnrollments++;
        } else {
          await tx.delete(learnEnrollments).where(eq(learnEnrollments.id, e.id));
        }
      } else {
        await tx.update(learnEnrollments).set({ userId: targetId }).where(eq(learnEnrollments.id, e.id));
        movedEnrollments++;
      }
    }

    const moved = await tx.update(learnAttempts).set({ userId: targetId }).where(eq(learnAttempts.userId, guestId)).returning({ id: learnAttempts.id });
    await tx.update(learnXpEvents).set({ userId: targetId }).where(eq(learnXpEvents.userId, guestId));
    await tx.update(learnNotes).set({ userId: targetId }).where(eq(learnNotes.userId, guestId));
    await tx.update(learnChatThreads).set({ userId: targetId }).where(eq(learnChatThreads.userId, guestId));
    // S10: sổ lỗi UNIQUE (user_id, question_id) – cộng dồn số lần sai vào mục của tài khoản rồi xoá mục trùng của khách
    await tx.execute(sql`
      UPDATE learn.error_log_entries t SET occurrences = t.occurrences + g.occurrences, last_seen_at = greatest(t.last_seen_at, g.last_seen_at),
             resolved_at = CASE WHEN g.resolved_at IS NULL OR t.resolved_at IS NULL THEN NULL ELSE greatest(t.resolved_at, g.resolved_at) END
        FROM learn.error_log_entries g
       WHERE g.user_id = ${guestId} AND t.user_id = ${targetId} AND g.question_id IS NOT NULL AND g.question_id = t.question_id`);
    await tx.execute(sql`
      DELETE FROM learn.error_log_entries g USING learn.error_log_entries t
       WHERE g.user_id = ${guestId} AND t.user_id = ${targetId} AND g.question_id IS NOT NULL AND g.question_id = t.question_id`);
    await tx.update(learnErrorLogEntries).set({ userId: targetId }).where(eq(learnErrorLogEntries.userId, guestId));
    await tx.update(aiAiTasks).set({ userId: targetId }).where(eq(aiAiTasks.userId, guestId));

    // SRS cards: tránh trùng (user_id, card_type, ref_id) nếu có – xoá bản khách khi target đã có
    await tx.execute(sql`
      DELETE FROM learn.srs_cards g USING learn.srs_cards t
      WHERE g.user_id = ${guestId} AND t.user_id = ${targetId} AND g.card_type = t.card_type AND g.ref_id = t.ref_id`);
    await tx.update(learnSrsCards).set({ userId: targetId }).where(eq(learnSrsCards.userId, guestId));

    // Streak: lấy giá trị lớn hơn
    const [gs] = await tx.select().from(learnStreaks).where(eq(learnStreaks.userId, guestId)).limit(1);
    if (gs) {
      const [ts] = await tx.select().from(learnStreaks).where(eq(learnStreaks.userId, targetId)).limit(1);
      if (!ts) {
        await tx.insert(learnStreaks).values({ ...gs, userId: targetId });
      } else {
        await tx
          .update(learnStreaks)
          .set({ currentStreak: Math.max(ts.currentStreak, gs.currentStreak), longestStreak: Math.max(ts.longestStreak, gs.longestStreak), lastActiveDate: maxDate(ts.lastActiveDate, gs.lastActiveDate), updatedAt: new Date() })
          .where(eq(learnStreaks.userId, targetId));
      }
      await tx.delete(learnStreaks).where(eq(learnStreaks.userId, guestId));
    }

    // Credit khách (nếu có) không chuyển; xoá số dư khách
    await tx.delete(billingCreditBalances).where(and(eq(billingCreditBalances.ownerType, 'user'), eq(billingCreditBalances.ownerId, guestId)));

    // Vô hiệu tài khoản khách
    const guestSessions = await tx.update(iamSessions).set({ revokedAt: new Date() }).where(eq(iamSessions.userId, guestId)).returning({ id: iamSessions.id });
    await this.revocation.markRevoked(guestSessions.map((r) => r.id));
    await tx.update(iamUsers).set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() }).where(eq(iamUsers.id, guestId));

    await this.outbox.write(tx, { aggregateType: 'user', aggregateId: targetId, eventType: DOMAIN_EVENTS.USER_MERGED, payload: { guest_id: guestId, user_id: targetId, attempts: moved.length, enrollments: movedEnrollments } });
    await this.audit.log({ action: 'guest.merged', actorUserId: targetId, entityType: 'user', entityId: targetId, before: { guest_id: guestId }, after: { attempts: moved.length, enrollments: movedEnrollments }, ip: meta.ip, userAgent: meta.userAgent }, tx);
    this.logger.info({ attempts: moved.length, enrollments: movedEnrollments }, 'guest merged');
    return { attempts: moved.length, enrollments: movedEnrollments };
  }
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
