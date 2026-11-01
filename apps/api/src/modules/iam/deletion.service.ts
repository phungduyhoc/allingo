import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { PersonalDataRegistry } from '../../shared/events/personal-data.registry.js';
import { Conflict } from '../../shared/http/errors.js';
import { MailerService } from '../../shared/notify/mailer.service.js';
import { StorageService } from '../../shared/storage/storage.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { SessionsService } from './sessions.service.js';

const { iamUsers, iamDeletionRequests, iamSessions, iamAuthIdentities, iamConsents, learnRecordings, learnNotes, learnChatThreads } = schema;

/**
 * Xoá tài khoản theo PDPL (CLAUDE.md §9): DELETE /me tạo iam.deletion_requests (due = now + PURGE_DELAY_MINUTES, mặc định 72 giờ),
 * thu hồi mọi phiên, trạng thái pending_deletion. Job `iam.purge` (worker) quét yêu cầu đến hạn:
 * ẩn danh hoá iam.users (giữ id vì billing.credit_ledger/orders tham chiếu – lý do pháp lý), xoá auth_identities/sessions/consents,
 * xoá ghi âm S3 + learn.recordings, dữ liệu đăng ký qua PersonalDataRegistry (ảnh người học), xoá ghi chú & hội thoại gia sư; giữ attempts/ledger dưới user_id ẩn danh; email xác nhận; outbox user.deleted.
 */
@Injectable()
export class DeletionService {
  private readonly logger = getLogger({ component: 'iam.deletion' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly personalData: PersonalDataRegistry,
    private readonly mailer: MailerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async request(userId: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<{ request_id: string; due_at: string }> {
    return this.dbs.db.transaction(async (tx) => {
      const [pending] = await tx.select().from(iamDeletionRequests).where(and(eq(iamDeletionRequests.userId, userId), isNull(iamDeletionRequests.completedAt))).limit(1);
      if (pending) throw new Conflict('Deletion already requested', { request_id: pending.id, due_at: pending.dueAt.toISOString() });
      const dueAt = new Date(Date.now() + this.env.PURGE_DELAY_MINUTES * 60_000);
      const [row] = await tx.insert(iamDeletionRequests).values({ userId, dueAt }).returning();
      await tx.update(iamUsers).set({ status: 'pending_deletion', updatedAt: new Date() }).where(eq(iamUsers.id, userId));
      await this.sessions.revokeAll(userId, tx);
      await this.audit.log({ action: 'user.deletion_requested', actorUserId: userId, entityType: 'user', entityId: userId, after: { due_at: dueAt.toISOString() }, ip: meta.ip, userAgent: meta.userAgent }, tx);
      return { request_id: row!.id, due_at: dueAt.toISOString() };
    });
  }

  /** Quét và thực thi các yêu cầu đến hạn (job iam.purge). Trả số tài khoản đã xoá. */
  async purgeDue(now = new Date()): Promise<number> {
    const due = await this.dbs.db.select().from(iamDeletionRequests).where(and(isNull(iamDeletionRequests.completedAt), lte(iamDeletionRequests.dueAt, now)));
    let done = 0;
    for (const req of due) {
      try {
        await this.purgeOne(req.id, req.userId);
        done++;
      } catch (err) {
        this.logger.error({ request_id: req.id, err: (err as Error).message }, 'purge failed');
      }
    }
    return done;
  }

  async purgeOne(requestId: string, userId: string): Promise<void> {
    // 1) Xoá tệp ghi âm trước (ngoài transaction, idempotent); tệp lỗi sẽ thử lại ở lần quét sau vì request chưa completed
    const recs = await this.dbs.db.select({ id: learnRecordings.id, key: learnRecordings.storageKey }).from(learnRecordings).where(eq(learnRecordings.userId, userId));
    for (const r of recs) {
      const ok = await this.storage.deleteObject('recordings', r.key);
      if (!ok) throw new Error(`cannot delete recording ${r.id}`);
    }
    // Dữ liệu cá nhân do module khác sở hữu (vd ảnh người học – speech) qua sổ đăng ký; lỗi → thử lại lần quét sau
    const purged = await this.personalData.purgeAll(userId);
    const [user] = await this.dbs.db.select({ email: iamUsers.email, uiLocale: iamUsers.uiLocale }).from(iamUsers).where(eq(iamUsers.id, userId)).limit(1);
    const email = user?.email ?? null;

    // 2) Ẩn danh hoá + xoá dữ liệu cá nhân trong một transaction
    await this.dbs.db.transaction(async (tx) => {
      await tx.delete(learnRecordings).where(eq(learnRecordings.userId, userId));
      await tx.delete(learnNotes).where(eq(learnNotes.userId, userId));
      await tx.delete(learnChatThreads).where(eq(learnChatThreads.userId, userId));
      await tx.delete(iamAuthIdentities).where(eq(iamAuthIdentities.userId, userId));
      await tx.delete(iamSessions).where(eq(iamSessions.userId, userId));
      await tx.delete(iamConsents).where(eq(iamConsents.userId, userId));
      await tx
        .update(iamUsers)
        .set({
          email: `deleted+${userId}@anonymized.invalid`,
          phone: null,
          passwordHash: null,
          displayName: 'Deleted user',
          avatarUrl: null,
          birthYear: null,
          status: 'deleted',
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(iamUsers.id, userId));
      await tx.update(iamDeletionRequests).set({ completedAt: new Date() }).where(eq(iamDeletionRequests.id, requestId));
      await this.audit.log({ action: 'user.purged', entityType: 'user', entityId: userId, after: { recordings: recs.length, ...purged } }, tx);
      await this.outbox.write(tx, { aggregateType: 'user', aggregateId: userId, eventType: DOMAIN_EVENTS.USER_DELETED, payload: { user_id: userId, request_id: requestId } });
    });

    // 3) Email xác nhận (địa chỉ lấy trước khi ẩn danh; không log)
    if (email && !email.endsWith('@anonymized.invalid')) {
      const en = user?.uiLocale === 'en';
      await this.mailer.send({
        to: email,
        subject: en ? 'Your Allingo account has been deleted' : 'Tài khoản Allingo của bạn đã được xoá',
        text: en
          ? 'Your account and personal data have been deleted as requested. Billing records are retained in anonymized form as required by law.'
          : 'Tài khoản và dữ liệu cá nhân của bạn đã được xoá theo yêu cầu. Hồ sơ thanh toán được giữ ở dạng ẩn danh theo quy định pháp luật.',
      });
    }
  }
}
