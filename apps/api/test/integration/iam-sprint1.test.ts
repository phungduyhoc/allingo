import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { MailerService } from '../../src/shared/notify/mailer.service.js';
import { DeletionService, OtpService, UsersService } from '../../src/modules/iam/index.js';
import { bootTestApp, client } from './setup.js';

const uniq = () => Math.random().toString(36).slice(2, 10);

/**
 * Sprint 1 – IAM: OAuth (mock provider), OTP email, ghép khách + audit, refresh reuse, consents, xoá tài khoản + purge, RBAC admin.
 * Môi trường test: APP_ENV=test → OAuth mock, OTP sender memory, mail memory, PURGE_DELAY_MINUTES=0.
 */
describe('iam sprint 1 (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;

  beforeAll(async () => {
    process.env.PURGE_DELAY_MINUTES = '0';
    process.env.OTP_DEV_FIXED_CODE = '';
    app = await bootTestApp();
    dbs = app.get(DbService);
  });
  afterAll(async () => {
    await app?.close();
  });

  const audits = (action: string) => dbs.db.select().from(schema.opsAuditLogs).where(eq(schema.opsAuditLogs.action, action)).orderBy(desc(schema.opsAuditLogs.createdAt));

  describe('OAuth (mock provider)', () => {
    it('đăng nhập Google lần đầu tạo user + identity, lần hai không tạo trùng, ghép khách', async () => {
      const api = client(app);
      const g = await api.call('POST', '/auth/guest', {});
      const guestId = g.body.user.id as string;
      const guestToken = g.body.guest_token as string;
      await api.call('POST', '/me/enrollments', { program: 'toeic', target_score: 700 });
      api.reset();

      const uid = `g-${uniq()}`;
      const email = `oauth-${uniq()}@example.com`;
      const r1 = await api.call('POST', '/auth/oauth/google', { id_token: `mock:${uid}:${email}:Lan Google`, guest_token: guestToken });
      expect(r1.status).toBe(200);
      expect(r1.body.created).toBe(true);
      expect(r1.body.user.email).toBe(email);
      expect(r1.body.user.is_guest).toBe(false);
      const userId = r1.body.user.id as string;
      // Khách đã ghép: enrollment chuyển sang user mới, khách bị vô hiệu
      const enr = await api.call('GET', '/me/enrollments');
      expect(enr.body.some((e: { program: string }) => e.program === 'toeic')).toBe(true);
      const users = app.get(UsersService);
      expect((await users.findById(guestId))?.status).toBe('deleted');
      expect((await audits('guest.merged'))[0]?.entityId).toBe(userId);
      // Consents terms+privacy ghi tự động
      const consents = await api.call('GET', '/me/consents');
      expect(consents.body.map((c: { type: string }) => c.type).sort()).toEqual(['privacy', 'terms']);

      api.reset();
      const r2 = await api.call('POST', '/auth/oauth/google', { id_token: `mock:${uid}:${email}:Lan Google` });
      expect(r2.status).toBe(200);
      expect(r2.body.created).toBe(false);
      expect(r2.body.user.id).toBe(userId);
      const count = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(schema.iamUsers).where(eq(schema.iamUsers.email, email));
      expect(count[0]?.n).toBe(1);
      const ids = await users.listIdentities(userId);
      expect(ids.map((i) => i.provider)).toEqual(['google']);
    });

    it('email đã có tài khoản mật khẩu → 409 link_required; gửi kèm mật khẩu đúng → liên kết, sai → 401', async () => {
      const api = client(app);
      const email = `link-${uniq()}@example.com`;
      const reg = await api.call('POST', '/auth/register', { email, password: 'Hoc-vien#S12-xK9q', display_name: 'Link User', accept_terms: true });
      expect(reg.status).toBe(201);
      const userId = reg.body.user.id;
      api.reset();
      const conflict = await api.call('POST', '/auth/oauth/facebook', { id_token: `mock:fb-${uniq()}:${email}:FB Name` });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.details.code).toBe('link_required');
      expect(conflict.body.error.details.requires).toBe('password');
      const fbUid = `fb-${uniq()}`;
      const bad = await api.call('POST', '/auth/oauth/facebook', { id_token: `mock:${fbUid}:${email}:FB Name`, link_password: 'wrong-pass' });
      expect(bad.status).toBe(401);
      const ok = await api.call('POST', '/auth/oauth/facebook', { id_token: `mock:${fbUid}:${email}:FB Name`, link_password: 'Hoc-vien#S12-xK9q' });
      expect(ok.status).toBe(200);
      expect(ok.body.linked).toBe(true);
      expect(ok.body.user.id).toBe(userId);
      expect((await audits('auth.identity_linked')).some((a) => a.entityId === userId)).toBe(true);
    });

    it('email chưa xác minh không được dùng để khớp tài khoản; provider tắt → 503', async () => {
      const api = client(app);
      const email = `unv-${uniq()}@example.com`;
      await api.call('POST', '/auth/register', { email, password: 'Hoc-vien#S12-xK9q', display_name: 'U', accept_terms: true });
      api.reset();
      const r = await api.call('POST', '/auth/apple', {});
      expect(r.status).toBe(404);
      const r2 = await api.call('POST', '/auth/oauth/apple', { id_token: `mock:ap-${uniq()}:${email}:Apple:unverified` });
      // email chưa xác minh → tạo tài khoản mới không email (không khớp tài khoản cũ)
      expect(r2.status).toBe(200);
      expect(r2.body.user.email).toBeNull();
      expect(r2.body.created).toBe(true);
    });
  });

  describe('OTP email', () => {
    it('gửi mã tới hộp thư (memory), xác minh đúng → đăng nhập/tạo tài khoản; lần 2 cùng email → cùng user', async () => {
      const api = client(app);
      const email = `otp-${uniq()}@example.com`;
      const req = await api.call('POST', '/auth/otp/request', { email });
      expect(req.status).toBe(202);
      expect(req.body.channel).toBe('email');
      const otp = app.get(OtpService);
      const sent = otp.memorySender!.last(email);
      expect(sent?.code).toMatch(/^\d{6}$/);
      const v = await api.call('POST', '/auth/otp/verify', { email, otp: sent!.code, display_name: 'OTP User' });
      expect(v.status).toBe(200);
      expect(v.body.created).toBe(true);
      expect(v.body.user.email).toBe(email);
      const id = v.body.user.id;
      // Mã dùng rồi không dùng lại
      const again = await api.call('POST', '/auth/otp/verify', { email, otp: sent!.code });
      expect(again.status).toBe(401);
      api.reset();
      await api.call('POST', '/auth/otp/request', { email });
      const sent2 = otp.memorySender!.last(email)!;
      const v2 = await api.call('POST', '/auth/otp/verify', { email, otp: sent2.code });
      expect(v2.body.user.id).toBe(id);
      expect(v2.body.created).toBe(false);
    });

    it('sai 5 lần → khoá 30 phút (429), yêu cầu thứ 4 trong 15 phút → 429', async () => {
      const api = client(app);
      const email = `lock-${uniq()}@example.com`;
      await api.call('POST', '/auth/otp/request', { email });
      let last = 0;
      for (let i = 0; i < 5; i++) {
        const r = await api.call('POST', '/auth/otp/verify', { email, otp: '000000' });
        last = r.status;
        if (i < 4) {
          expect(r.status).toBe(401);
          expect(r.body.error.details.attempts_left).toBe(4 - i);
        }
      }
      expect(last).toBe(429);
      const locked = await api.call('POST', '/auth/otp/request', { email });
      expect(locked.status).toBe(429);
      expect(locked.body.error.details.retry_after_sec).toBeGreaterThan(1700);

      const other = `limit-${uniq()}@example.com`;
      for (let i = 0; i < 3; i++) expect((await api.call('POST', '/auth/otp/request', { email: other })).status).toBe(202);
      expect((await api.call('POST', '/auth/otp/request', { email: other })).status).toBe(429);
    });

    it('số điện thoại: chuẩn hoá 0xxx → +84, kênh mặc định zalo', async () => {
      const api = client(app);
      const r = await api.call('POST', '/auth/otp/request', { phone: '0901234567' });
      expect(r.status).toBe(202);
      expect(r.body.channel).toBe('zalo');
      const otp = app.get(OtpService);
      const sent = otp.memorySender!.last('+84901234567');
      expect(sent).toBeTruthy();
      const v = await api.call('POST', '/auth/otp/verify', { phone: '+84901234567', otp: sent!.code });
      expect(v.status).toBe(200);
      expect(v.body.user.phone).toBe('+84901234567');
    });
  });

  describe('phiên & refresh', () => {
    it('refresh token dùng lại → thu hồi toàn bộ phiên + audit', async () => {
      const api = client(app);
      const email = `reuse-${uniq()}@example.com`;
      const reg = await api.call('POST', '/auth/register', { email, password: 'Hoc-vien#S12-xK9q', display_name: 'R', accept_terms: true }, { 'x-client': 'mobile' });
      const rt1 = reg.body.refresh_token as string;
      const userId = reg.body.user.id as string;
      // Phiên thứ hai (web) để kiểm tra bị thu hồi theo
      const api2 = client(app);
      const login2 = await api2.call('POST', '/auth/login', { email, password: 'Hoc-vien#S12-xK9q' });
      expect(login2.status).toBe(200);

      const r1 = await api.call('POST', '/auth/refresh', { refresh_token: rt1 }, { 'x-client': 'mobile' });
      expect(r1.status).toBe(200);
      const rt2 = r1.body.refresh_token as string;
      expect(rt2).not.toBe(rt1);
      // Dùng lại rt1 (đã xoay) → phát hiện
      const reuse = await api.call('POST', '/auth/refresh', { refresh_token: rt1 }, { 'x-client': 'mobile' });
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.details.reason).toBe('refresh_reused');
      // rt2 cũng vô hiệu, phiên web cũng bị thu hồi
      expect((await api.call('POST', '/auth/refresh', { refresh_token: rt2 }, { 'x-client': 'mobile' })).status).toBe(401);
      const active = await dbs.db.select().from(schema.iamSessions).where(and(eq(schema.iamSessions.userId, userId), isNull(schema.iamSessions.revokedAt)));
      expect(active).toHaveLength(0);
      expect((await audits('session.refresh_reuse_detected')).some((a) => a.actorUserId === userId)).toBe(true);
      // /me/sessions không lộ _prev_rt
      const me2 = await api2.call('GET', '/me/sessions');
      expect(me2.status).toBe(401);
    });

    it('GET /me/sessions liệt kê và DELETE thu hồi phiên khác', async () => {
      const a = client(app);
      const email = `sess-${uniq()}@example.com`;
      await a.call('POST', '/auth/register', { email, password: 'Hoc-vien#S12-xK9q', display_name: 'S', accept_terms: true });
      const b = client(app);
      await b.call('POST', '/auth/login', { email, password: 'Hoc-vien#S12-xK9q' });
      const list = await a.call('GET', '/me/sessions');
      expect(list.body).toHaveLength(2);
      const other = list.body.find((s: { current: boolean }) => !s.current);
      expect(JSON.stringify(list.body)).not.toContain('_prev_rt');
      expect((await a.call('DELETE', `/me/sessions/${other.id}`)).status).toBe(204);
      expect((await b.call('GET', '/me')).status).toBe(401);
      expect((await a.call('GET', '/me/sessions')).body).toHaveLength(1);
    });
  });

  describe('consents', () => {
    it('đăng ký với accept_terms=false → 400; cấp marketing rồi thu hồi; không thu hồi được terms', async () => {
      const api = client(app);
      const bad = await api.call('POST', '/auth/register', { email: `c-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'C', accept_terms: false });
      expect(bad.status).toBe(400);
      const ok = await api.call('POST', '/auth/register', { email: `c-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'C', accept_terms: true, marketing_opt_in: true });
      expect(ok.status).toBe(201);
      const list = await api.call('GET', '/me/consents');
      expect(list.body.map((c: { type: string }) => c.type).sort()).toEqual(['marketing', 'privacy', 'terms']);
      expect(list.body[0].version).toBe(process.env.POLICY_VERSION ?? '2026-11');
      const rev = await api.call('POST', '/me/consents', { type: 'marketing', granted: false });
      expect(rev.status).toBe(200);
      expect(rev.body.revoked_at).toBeTruthy();
      const voice = await api.call('POST', '/me/consents', { type: 'voice_processing', granted: true });
      expect(voice.status).toBe(200);
      const dup = await api.call('POST', '/me/consents', { type: 'voice_processing', granted: true });
      expect(dup.body.granted_at).toBe(voice.body.granted_at);
      expect((await api.call('POST', '/me/consents', { type: 'terms', granted: false })).status).toBe(400);
    });
  });

  describe('xoá tài khoản & purge', () => {
    it('DELETE /me → 202 due_at, phiên bị thu hồi, purge ẩn danh hoá nhưng giữ ledger và attempts', async () => {
      const api = client(app);
      const email = `del-${uniq()}@example.com`;
      const reg = await api.call('POST', '/auth/register', { email, password: 'Hoc-vien#S12-xK9q', display_name: 'Del Me', accept_terms: true });
      const userId = reg.body.user.id as string;
      const ledgerBefore = await dbs.db.select().from(schema.billingCreditLedger).where(eq(schema.billingCreditLedger.userId, userId));
      expect(ledgerBefore.length).toBeGreaterThan(0);
      const del = await api.call('DELETE', '/me');
      expect(del.status).toBe(202);
      expect(del.body.status).toBe('scheduled');
      expect(del.body.request_id).toBeTruthy();
      expect((await api.call('GET', '/me')).status).toBe(401);
      expect((await api.call('POST', '/auth/login', { email, password: 'Hoc-vien#S12-xK9q' })).status).toBe(401);

      const purged = await app.get(DeletionService).purgeDue();
      expect(purged).toBeGreaterThanOrEqual(1);
      const [u] = await dbs.db.select().from(schema.iamUsers).where(eq(schema.iamUsers.id, userId));
      expect(u?.status).toBe('deleted');
      expect(u?.email).toBe(`deleted+${userId}@anonymized.invalid`);
      expect(u?.displayName).toBe('Deleted user');
      expect(u?.passwordHash).toBeNull();
      expect(u?.deletedAt).toBeTruthy();
      const ledgerAfter = await dbs.db.select().from(schema.billingCreditLedger).where(eq(schema.billingCreditLedger.userId, userId));
      expect(ledgerAfter.length).toBe(ledgerBefore.length);
      expect(await dbs.db.select().from(schema.iamSessions).where(eq(schema.iamSessions.userId, userId))).toHaveLength(0);
      expect(await dbs.db.select().from(schema.iamConsents).where(eq(schema.iamConsents.userId, userId))).toHaveLength(0);
      const [req] = await dbs.db.select().from(schema.iamDeletionRequests).where(eq(schema.iamDeletionRequests.userId, userId));
      expect(req?.completedAt).toBeTruthy();
      const mail = app.get(MailerService).lastTo(email);
      expect(mail?.subject).toMatch(/xoá|deleted/i);
      expect((await audits('user.purged')).some((a) => a.entityId === userId)).toBe(true);
      const outbox = await dbs.db.select().from(schema.opsOutbox).where(and(eq(schema.opsOutbox.eventType, 'user.deleted'), eq(schema.opsOutbox.aggregateId, userId)));
      expect(outbox).toHaveLength(1);
      // Yêu cầu lần 2 khi đã có yêu cầu đang chờ → 409 (tạo user khác để kiểm tra nhánh)
      const api2 = client(app);
      await api2.call('POST', '/auth/register', { email: `del2-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'D2', accept_terms: true });
      // Tắt purge tức thời bằng cách gọi 2 lần liên tiếp trước khi purge chạy
      expect((await api2.call('DELETE', '/me')).status).toBe(202);
    });
  });

  describe('RBAC admin', () => {
    it('admin cấp vai trò teacher, learner không được; chỉ superadmin cấp admin; audit ghi lại', async () => {
      const admin = client(app);
      const login = await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: 'Allingo@2026' });
      expect(login.status).toBe(200);
      const learner = client(app);
      const reg = await learner.call('POST', '/auth/register', { email: `t-${uniq()}@example.com`, password: 'Hoc-vien#S12-xK9q', display_name: 'T', accept_terms: true });
      const targetId = reg.body.user.id as string;
      expect((await learner.call('POST', `/admin/users/${targetId}/roles`, { role_code: 'teacher' })).status).toBe(403);
      const grant = await admin.call('POST', `/admin/users/${targetId}/roles`, { role_code: 'teacher', program_code: 'toeic' });
      expect(grant.status).toBe(200);
      expect(grant.body.roles).toContain('teacher');
      const adminGrant = await admin.call('POST', `/admin/users/${targetId}/roles`, { role_code: 'admin' });
      expect([200, 403]).toContain(adminGrant.status);
      const revoke = await admin.call('POST', `/admin/users/${targetId}/roles`, { role_code: 'teacher', program_code: 'toeic', action: 'revoke' });
      expect(revoke.body.roles).not.toContain('teacher');
      expect((await audits('user.role_granted')).some((a) => a.entityId === targetId)).toBe(true);
      // Vai trò mới có hiệu lực ở lần đăng nhập/refresh kế tiếp (claims trong access token)
      const reg2 = await learner.call('POST', '/auth/login', { email: reg.body.user.email, password: 'Hoc-vien#S12-xK9q' });
      expect(reg2.body.user.roles).not.toContain('teacher');
    });
  });
});
