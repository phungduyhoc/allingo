import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { DbService } from '../../src/shared/db/db.module.js';
import { MailerService } from '../../src/shared/notify/mailer.service.js';
import { GrowthJobsService, hashInviteCode } from '../../src/modules/growth/index.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const STRONG = 'Hoc-vien#S12-xK9q';
const uniq = () => randomBytes(4).toString('hex');
type Api = ReturnType<typeof client>;
const ENV_KEYS = ['JOBS_INLINE'] as const;
const CODE_RE = /ALG-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}/;

/**
 * Sprint 12 – beta kín & phản hồi (PG/Redis cục bộ): danh sách chờ (202, chống trùng, không lộ tồn tại), mời theo đợt có hạn
 * mức/ngày, beta gate (ma trận endpoint), đổi mã → Pro trial 60 ngày + 2.000 credit (idempotent), khảo sát + NPS ngày 7, góp ý
 * kèm ảnh + trace_id, báo lỗi câu → API nội bộ CMS → thông báo người báo, SLA, ticket 2 chiều + trả lời admin cấp credit bù.
 */
describe('S12 beta & support (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let mailer: MailerService;
  let admin: Api;
  const saved: Record<string, string | undefined> = {};
  const emails = [0, 1, 2].map(() => `s12-wl-${uniq()}@example.com`);
  const codes: string[] = [];
  let userA: { api: Api; id: string; email: string };
  let userB: { api: Api; id: string; email: string };
  let ticketId = '';

  const register = async (email = `s12-${uniq()}@example.com`) => {
    const api = client(app);
    const r = await api.call('POST', '/auth/register', { email, password: STRONG, display_name: 'S12 Tester', accept_terms: true });
    expect(r.status).toBe(201);
    return { api, id: r.body.user.id as string, email };
  };
  const setGate = (enabled: boolean, rules: Record<string, unknown> = {}) => admin.call('PUT', '/admin/flags/ff.growth.beta_gate', { enabled, rules });
  const inject = (o: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }) =>
    app.getHttpAdapter().getInstance().inject({ method: o.method, url: `/v1${o.url}`, payload: o.body === undefined ? undefined : JSON.stringify(o.body), headers: { 'content-type': 'application/json', ...(o.headers ?? {}) } });

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.JOBS_INLINE = 'true';
    app = await bootTestApp();
    dbs = app.get(DbService);
    mailer = app.get(MailerService);
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    // Lời mời còn xếp hàng từ lần chạy trước (DB test dùng chung) không được chiếm hạn mức hôm nay
    await dbs.db.execute(sql`update ops.beta_invites set status = 'revoked' where status = 'queued'`);
  });

  afterAll(async () => {
    await setGate(false, {}).catch(() => undefined);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await app?.close();
  });

  describe('danh sách chờ & mời theo đợt', () => {
    it('POST /waitlist → 202 cùng body dù trùng; email sai → 400; một hàng/(email, program)', async () => {
      for (const e of emails) {
        const r = await inject({ method: 'POST', url: '/waitlist', body: { email: e, program: 'toeic', locale: 'vi', consent_marketing: true } });
        expect(r.statusCode).toBe(202);
        expect(r.json()).toEqual({ status: 'accepted' });
      }
      const dup = await inject({ method: 'POST', url: '/waitlist', body: { email: emails[0]!.toUpperCase(), program: 'toeic', locale: 'en', consent_marketing: false } });
      expect(dup.statusCode).toBe(202);
      expect(dup.json()).toEqual({ status: 'accepted' });
      expect((await inject({ method: 'POST', url: '/waitlist', body: { email: 'not-an-email', program: 'toeic' } })).statusCode).toBe(400);
      const rows = (await dbs.db.execute(sql`select email, locale, consent_marketing, status from ops.waitlist_entries where email = ${emails[0]!}`)) as unknown as Array<{ locale: string; consent_marketing: boolean; status: string }>;
      expect(rows).toHaveLength(1);
      // trùng còn waiting → cập nhật locale, đồng ý marketing giữ true (OR)
      expect(rows[0]).toMatchObject({ locale: 'en', consent_marketing: true, status: 'waiting' });
      const list = await admin.call('GET', '/admin/beta/waitlist?program=toeic&status=waiting&limit=100');
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(emails[1]!);
      expect(list.body.data[0].email_masked).toMatch(/\*\*\*@/);
    });

    it('admin chọn từ danh sách chờ → queued; job gửi tôn trọng hạn mức/ngày; email chứa mã (DB chỉ lưu sha256)', async () => {
      const rows = (await dbs.db.execute(sql`select id, email from ops.waitlist_entries where email in (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`)) as unknown as Array<{ id: string; email: string }>;
      const ids = emails.map((e) => rows.find((r) => r.email === e)!.id);
      const created = await admin.call('POST', '/admin/beta/invites', { waitlist_entry_ids: ids, program: 'toeic', batch: `it-${uniq()}` });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ queued: 3, skipped: 0 });
      const again = await admin.call('POST', '/admin/beta/invites', { emails: [emails[0]], program: 'toeic' });
      expect(again.body).toMatchObject({ queued: 0, skipped: 1 });
      // Hạn mức hôm nay = đã gửi + 2 → gửi đúng 2, còn 1 xếp hàng
      const [{ n }] = (await dbs.db.execute(sql`select count(*)::int as n from ops.beta_invites where sent_at >= date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'`)) as unknown as [{ n: number }];
      expect((await setGate(false, { config: { daily_invite_limit: n + 2 } })).status).toBe(200);
      const send = await admin.call('POST', '/admin/beta/invites/send', {});
      expect(send.status).toBe(202);
      expect(send.body.result).toMatchObject({ sent: 2, failed: 0, remaining_today: 0 });
      for (const e of emails.slice(0, 2)) {
        const m = mailer.lastTo(e);
        expect(m?.subject).toMatch(/beta kín|closed beta/);
        const code = CODE_RE.exec(m!.text)?.[0];
        expect(code).toBeDefined();
        codes.push(code!);
      }
      expect(mailer.lastTo(emails[2]!)).toBeUndefined();
      const stored = (await dbs.db.execute(sql`select status, code_hash from ops.beta_invites where email = ${emails[0]!} and status = 'sent'`)) as unknown as Array<{ code_hash: string }>;
      expect(stored[0]!.code_hash).toBe(hashInviteCode(codes[0]!));
      expect(stored[0]!.code_hash).not.toContain(codes[0]!.slice(4, 8));
      const list = await admin.call('GET', '/admin/beta/invites?status=queued');
      expect(list.body.today).toMatchObject({ remaining: 0 });
    });

    it('B6/S147: gửi theo lô – invite_ids (đúng thứ tự, bỏ qua lời mời không còn queued) và batch; tôn trọng limit', async () => {
      const b1 = `it-sel-${uniq()}`;
      const mails = [0, 1, 2].map(() => `s12-sel-${uniq()}@example.com`);
      const other = `s12-sel-other-${uniq()}@example.com`;
      expect((await admin.call('POST', '/admin/beta/invites', { emails: mails, program: 'toeic', batch: b1 })).body).toMatchObject({ queued: 3 });
      expect((await admin.call('POST', '/admin/beta/invites', { emails: [other], program: 'toeic', batch: `it-other-${uniq()}` })).body).toMatchObject({ queued: 1 });
      const rows = (await dbs.db.execute(sql`select id, email from ops.beta_invites where email in (${sql.join([...mails, other].map((e) => sql`${e}`), sql`, `)})`)) as unknown as Array<{ id: string; email: string }>;
      const id = (e: string) => rows.find((r) => r.email === e)!.id;
      const [{ n }] = (await dbs.db.execute(sql`select count(*)::int as n from ops.beta_invites where sent_at >= date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'`)) as unknown as [{ n: number }];
      expect((await setGate(false, { config: { daily_invite_limit: n + 10 } })).status).toBe(200);
      expect((await admin.call('POST', `/admin/beta/invites/${id(mails[1]!)}/revoke`)).status).toBe(200);
      // invite_ids: [mails2, (đã thu hồi), mails0] + limit 1 → chỉ gửi mails2 (thứ tự truyền vào), 1 bỏ qua
      const r = await admin.call('POST', '/admin/beta/invites/send', { invite_ids: [id(mails[2]!), id(mails[1]!), id(mails[0]!)], limit: 1 });
      expect(r.status).toBe(202);
      expect(r.body).toMatchObject({ mode: 'inline', result: { sent: 1, failed: 0, skipped: 1 } });
      expect(mailer.lastTo(mails[2]!)).toBeDefined();
      expect(mailer.lastTo(mails[0]!)).toBeUndefined();
      // batch: chỉ lời mời đang chờ của đợt b1 (mails0); lời mời của đợt khác giữ queued
      const r2 = await admin.call('POST', '/admin/beta/invites/send', { batch: b1 });
      expect(r2.body.result).toMatchObject({ sent: 1, skipped: 0 });
      expect(mailer.lastTo(mails[0]!)).toBeDefined();
      expect(mailer.lastTo(other)).toBeUndefined();
      const st = (await dbs.db.execute(sql`select status from ops.beta_invites where id = ${id(other)}`)) as unknown as Array<{ status: string }>;
      expect(st[0]!.status).toBe('queued');
      expect((await admin.call('POST', '/admin/beta/invites/send', { invite_ids: ['not-a-uuid'] })).status).toBe(400);
      expect((await admin.call('POST', '/admin/beta/invites/send', { batch: '' })).status).toBe(400);
      await admin.call('POST', `/admin/beta/invites/${id(other)}/revoke`);
    });
  });

  describe('beta gate & đổi mã', () => {
    it('gate bật: chưa có quyền → 403 beta_required ở API app; endpoint miễn trừ/công khai/admin vẫn chạy', async () => {
      expect((await setGate(true, { config: { daily_invite_limit: 0 } })).status).toBe(200);
      userA = await register(emails[0]);
      userB = await register(emails[1]);
      const blocked = await userA.api.call('GET', '/me/stats?program=toeic');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toMatchObject({ code: 'beta_required', details: { message_key: 'errors.beta_required', redeem_path: '/beta/redeem' } });
      expect((await userA.api.call('GET', '/me/plan/today?program=toeic')).status).toBe(403);
      expect((await userA.api.call('POST', '/content-reports', { question_version_id: '00000000-0000-4000-8000-000000000000', reason: 'typo' })).status).toBe(403);
      // miễn trừ: hồ sơ tối thiểu, phiên, đồng ý, MFA, beta, hỗ trợ; công khai: flags, programs, legal
      for (const url of ['/me', '/me/sessions', '/me/consents', '/me/mfa', '/beta/status', '/me/support/tickets', '/flags', '/programs', '/legal/policies']) {
        const r = await userA.api.call('GET', url);
        expect([url, r.status]).toEqual([url, 200]);
      }
      expect((await userA.api.call('GET', '/beta/status')).body).toMatchObject({ gate_enabled: true, has_access: false, reason: 'none' });
      const t = await userA.api.call('POST', '/support/tickets', { subject: 'Không đổi được mã mời', message: 'Mình nhập mã nhưng báo lỗi', category: 'account' });
      expect(t.status).toBe(201);
      ticketId = t.body.id;
      // B6/S150: góp ý miễn beta gate (người bị chặn gửi từ trang /beta); tải ảnh vẫn qua gate
      const fb = await userA.api.call('POST', '/feedback', { category: 'bug', message: 'Không vào được app sau khi đăng ký', page_url: '/beta' });
      expect(fb.status).toBe(201);
      expect((await userA.api.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'image/png', size_bytes: 1024 })).status).toBe(403);
      expect((await admin.call('GET', '/me/stats?program=toeic')).status).toBe(200);
      // khách (guest) cũng bị chặn
      const guest = client(app);
      expect((await guest.call('POST', '/auth/guest')).status).toBe(201);
      expect((await guest.call('GET', '/me/stats?program=toeic')).body.error?.code).toBe('beta_required');
      // allowlist rules.user_ids
      const c = await register();
      expect((await c.api.call('GET', '/me/stats?program=toeic')).status).toBe(403);
      await setGate(true, { user_ids: [c.id], config: { daily_invite_limit: 0 } });
      expect((await c.api.call('GET', '/me/stats?program=toeic')).status).toBe(200);
      await setGate(true, { config: { daily_invite_limit: 0 } });
    });

    it('đổi mã → Pro trial 60 ngày + 2.000 credit (ledger promo/beta_invite) + vai trò; vào app ngay (không cần refresh); idempotent', async () => {
      const r = await userA.api.call('POST', '/beta/redeem', { code: codes[0]!.toLowerCase().replaceAll('-', ' ') });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'redeemed', program: 'toeic', trial_skipped: null, credits_granted: 2000, survey_pending: true });
      const days = (new Date(r.body.trial_ends_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(59.9);
      expect(days).toBeLessThan(60.1);
      expect(r.body.balance).toBeGreaterThanOrEqual(2000);
      const ledger = (await dbs.db.execute(sql`select delta, reason::text as reason, ref_type, expires_at from billing.credit_ledger where user_id = ${userA.id} and ref_type = 'beta_invite'`)) as unknown as Array<{ delta: number; reason: string; expires_at: Date | null }>;
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ delta: 2000, reason: 'promo' });
      expect(ledger[0]!.expires_at).not.toBeNull();
      const sub = (await dbs.db.execute(sql`select status::text as status from billing.subscriptions where user_id = ${userA.id}`)) as unknown as Array<{ status: string }>;
      expect(sub.map((s) => s.status)).toContain('trialing');
      expect((await userA.api.call('GET', '/me/stats?program=toeic')).status).toBe(200);
      expect((await userA.api.call('GET', '/beta/status')).body).toMatchObject({ has_access: true, reason: 'invite', survey_completed: false });
      const again = await userA.api.call('POST', '/beta/redeem', { code: codes[0] });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ status: 'already_redeemed', credits_granted: 0, balance: r.body.balance });
      const audit = (await dbs.db.execute(sql`select count(*)::int as n from ops.audit_logs where action = 'beta.redeemed' and actor_user_id = ${userA.id}`)) as unknown as Array<{ n: number }>;
      expect(audit[0]!.n).toBe(1);
    });

    it('mã của người khác → 409 invite_used; mã sai/hết hạn → 400 invite_invalid; đã là tester → 409 already_beta', async () => {
      const used = await userB.api.call('POST', '/beta/redeem', { code: codes[0] });
      expect(used.status).toBe(409);
      expect(used.body.error.details.reason).toBe('invite_used');
      const bad = await userB.api.call('POST', '/beta/redeem', { code: 'ALG-ZZZZ-2345' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.reason).toBe('invite_invalid');
      const expiredCode = 'ALG-EXPD-2345';
      await dbs.db.execute(sql`insert into ops.beta_invites (email, program, status, code_hash, sent_at, expires_at) values (${`s12-exp-${uniq()}@example.com`}, 'toeic', 'sent', ${hashInviteCode(expiredCode)}, now() - interval '20 days', now() - interval '1 day') on conflict do nothing`);
      expect((await userB.api.call('POST', '/beta/redeem', { code: expiredCode })).body.error.details.reason).toBe('invite_invalid');
      const ok = await userB.api.call('POST', '/beta/redeem', { code: codes[1] });
      expect(ok.status).toBe(200);
      const twice = await userA.api.call('POST', '/beta/redeem', { code: codes[1] });
      expect(twice.status).toBe(409);
    });
  });

  describe('khảo sát onboarding + NPS', () => {
    it('khảo sát 5 câu (upsert JSONB); NPS ngày 7 hiện sau 7 ngày, trả lời một lần (idempotent), chưa tới hạn → 409', async () => {
      const bad = await userA.api.call('POST', '/me/beta-survey', { goal: 'job', exam_date: null, current_score: 2000, devices: ['android'], study_minutes_per_day: 30 });
      expect(bad.status).toBe(400);
      const s = await userA.api.call('POST', '/me/beta-survey', { goal: 'job', exam_date: '2027-01-15', current_score: 450, devices: ['android', 'laptop'], study_minutes_per_day: 30 });
      expect(s.status).toBe(200);
      expect(s.body).toMatchObject({ kind: 'beta_onboarding', score: null });
      expect((await userA.api.call('GET', '/me/surveys/pending')).body.data).toEqual([]);
      expect((await userA.api.call('POST', '/me/surveys/nps', { score: 9 })).body.error?.details?.reason).toBe('not_due');
      await dbs.db.execute(sql`update ops.beta_invites set redeemed_at = now() - interval '8 days' where redeemed_by = ${userA.id}`);
      const pending = (await userA.api.call('GET', '/me/surveys/pending')).body.data;
      expect(pending.map((p: { kind: string }) => p.kind)).toEqual(['nps_d7']);
      const nps = await userA.api.call('POST', '/me/surveys/nps', { score: 9, comment: 'Giải thích dễ hiểu' });
      expect(nps.status).toBe(200);
      expect(nps.body).toMatchObject({ kind: 'nps_d7', score: 9 });
      const again = await userA.api.call('POST', '/me/surveys/nps', { score: 3, survey: 'nps_d7' });
      expect(again.body).toMatchObject({ kind: 'nps_d7', score: 9 });
      expect((await userA.api.call('GET', '/me/surveys/pending')).body.data).toEqual([]);
      const rows = (await dbs.db.execute(sql`select kind, answers->>'goal' as goal from ops.survey_responses where user_id = ${userA.id} order by kind`)) as unknown as Array<{ kind: string; goal: string | null }>;
      expect(rows.map((r) => r.kind)).toEqual(['beta_onboarding', 'nps_d7']);
      expect(rows[0]!.goal).toBe('job');
    });

    it('B6/S146: không phải beta tester (đăng ký 8 ngày) và nhân sự (admin, kể cả có vai trò tester) → không có NPS', async () => {
      await setGate(false, { config: { daily_invite_limit: 0 } });
      const plain = await register();
      await dbs.db.execute(sql`update iam.users set created_at = now() - interval '8 days' where id = ${plain.id}`);
      expect((await plain.api.call('GET', '/me/surveys/pending')).body.data).toEqual([]);
      expect((await plain.api.call('POST', '/me/surveys/nps', { score: 8 })).body.error?.details?.reason).toBe('not_due');
      const adminId = (await admin.call('GET', '/me')).body.id as string;
      await dbs.db.execute(sql`insert into iam.user_roles (user_id, role_code) values (${adminId}, 'beta_tester') on conflict do nothing`);
      try {
        expect((await admin.call('GET', '/me/surveys/pending')).body.data).toEqual([]);
      } finally {
        await dbs.db.execute(sql`delete from iam.user_roles where user_id = ${adminId} and role_code = 'beta_tester'`);
      }
      await setGate(true, { config: { daily_invite_limit: 0 } });
    });
  });

  describe('góp ý in-app', () => {
    it('kèm ảnh màn hình (upload riêng tư của chính người gọi) + trace_id tự động; ảnh người khác → 400; admin xem + đổi trạng thái', async () => {
      const up = await userA.api.call('POST', '/uploads/presign', { kind: 'image', mime_type: 'image/png', size_bytes: 2048 });
      expect(up.status).toBe(201);
      const f = await userA.api.call('POST', '/feedback', { category: 'bug', message: 'Nút nộp bài bị che trên điện thoại', page_url: '/toeic/exam/123', screenshot_upload_id: up.body.resource_id, app_version: 'web-0.9.0' });
      expect(f.status).toBe(201);
      expect(f.body.trace_id).toBe(f.headers['x-trace-id']);
      const tp = randomBytes(16).toString('hex');
      const f2 = await userA.api.call('POST', '/feedback', { category: 'idea', message: 'Thêm chế độ tối', trace_id: tp });
      expect(f2.body.trace_id).toBe(tp);
      const other = await userB.api.call('POST', '/feedback', { category: 'bug', message: 'thử ảnh người khác', screenshot_upload_id: up.body.resource_id });
      expect(other.status).toBe(400);
      const list = await admin.call('GET', '/admin/feedback?status=new&limit=50');
      const item = list.body.data.find((x: { id: string }) => x.id === f.body.id);
      expect(item).toMatchObject({ category: 'bug', user_id: userA.id, trace_id: f.body.trace_id, screenshot: { media_asset_id: up.body.resource_id } });
      expect(item.context).not.toHaveProperty('email');
      const patched = await admin.call('PATCH', `/admin/feedback/${f.body.id}`, { status: 'triaged' });
      expect(patched.body.status).toBe('triaged');
    });
  });

  describe('báo lỗi câu hỏi → CMS', () => {
    let qvId = '';
    let reportId = '';
    it('tạo (một báo cáo mở/người/phiên bản), SLA 48 giờ; API nội bộ CMS kéo + đổi trạng thái (token sai → 401)', async () => {
      const [qv] = (await dbs.db.execute(sql`select v.id from catalog.question_versions v join catalog.questions q on q.current_version_id = v.id where q.status = 'published' limit 1`)) as unknown as Array<{ id: string }>;
      qvId = qv!.id;
      const r = await userA.api.call('POST', '/content-reports', { question_version_id: qvId, reason: 'wrong_answer', message: 'Đáp án đúng phải là B' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'open', duplicate: false });
      reportId = r.body.id;
      const hours = (new Date(r.body.sla_due_at).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      const dup = await userA.api.call('POST', '/content-reports', { question_version_id: qvId, reason: 'typo' });
      expect(dup.body).toMatchObject({ id: reportId, duplicate: true });
      expect((await userA.api.call('POST', '/content-reports', { question_version_id: '00000000-0000-4000-8000-000000000000', reason: 'typo' })).status).toBe(404);
      expect((await inject({ method: 'GET', url: '/internal/content-reports?updated_since=2020-01-01T00:00:00Z', headers: { 'x-internal-token': 'wrong-token' } })).statusCode).toBe(401);
      const sync = await inject({ method: 'GET', url: `/internal/content-reports?updated_since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`, headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token' } });
      expect(sync.statusCode).toBe(200);
      const item = sync.json().data.find((x: { id: string }) => x.id === reportId);
      expect(item).toMatchObject({ question_version_id: qvId, reason: 'wrong_answer', status: 'open', overdue: false });
      expect(item.reports_for_question).toBeGreaterThanOrEqual(1);
    });

    it('CMS đổi "Đã sửa" → API ghi audit + người báo nhận in-app; quá hạn SLA → overdue + gauge', async () => {
      const r = await inject({ method: 'POST', url: `/internal/content-reports/${reportId}/status`, body: { status: 'fixed', resolution_note: 'Đã sửa đáp án ở v2', resolved_by_email: 'teacher@allingo.dev' }, headers: { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'fixed', resolution_note: 'Đã sửa đáp án ở v2', overdue: false });
      // listener chạy bất đồng bộ sau commit (local event) – chờ tối đa 5 s
      await expect.poll(async () => (await dbs.db.execute(sql`select channel::text as channel, status from ops.notifications where user_id = ${userA.id} and template_code = 'content.report_resolved'`)) as unknown as Array<{ channel: string; status: string }>, { timeout: 5000 }).toEqual([{ channel: 'inapp', status: 'sent' }]);
      // B6/S148: người báo chưa làm câu này trong bài đã nộp → liên kết về trung tâm hỗ trợ (không tự trỏ /notifications)
      const [n1] = (await dbs.db.execute(sql`select payload->>'url' as url from ops.notifications where user_id = ${userA.id} and template_code = 'content.report_resolved'`)) as unknown as Array<{ url: string }>;
      expect(n1!.url).toBe('/support');
      const b = await userB.api.call('POST', '/content-reports', { question_version_id: qvId, reason: 'unclear' });
      await dbs.db.execute(sql`update ops.content_reports set sla_due_at = now() - interval '1 hour' where id = ${b.body.id}`);
      const overdue = await admin.call('GET', '/admin/content/reports?overdue=true&limit=100');
      expect(overdue.body.data.some((x: { id: string; overdue: boolean }) => x.id === b.body.id && x.overdue)).toBe(true);
      const sla = await app.get(GrowthJobsService).slaCheck();
      expect(sla.content_reports_overdue).toBeGreaterThanOrEqual(1);
      const metrics = await inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token'}` } });
      expect(metrics.body).toContain('support_sla_overdue{kind="content_report"}');
      const teacher = client(app);
      await teacher.call('POST', '/auth/login', { email: 'teacher@allingo.dev', password: PASSWORD });
      const patched = await teacher.call('PATCH', `/admin/content/reports/${b.body.id}`, { status: 'rejected', resolution_note: 'Câu rõ nghĩa' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ status: 'rejected', overdue: false });
    });

    it('B6/S148: báo lỗi câu trong bài đã nộp → thông báo trỏ /attempts/{id}/review?focus=<question_version_id>', async () => {
      const sets = await userB.api.call('GET', '/programs/toeic/test-sets?kind=mini');
      const part5 = sets.body.data.find((t: { code: string }) => t.code === 'toeic-mini-part5-01');
      const att = await userB.api.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: part5.id }, { 'idempotency-key': `s148-${uniq()}` });
      expect(att.status).toBe(201);
      const q0 = att.body.questions[0] as { question_id: string; question_version_id: string };
      expect((await userB.api.call('PUT', `/attempts/${att.body.id}/answers`, { answers: [{ question_id: q0.question_id, answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 3000 }] })).status).toBe(204);
      expect((await userB.api.call('POST', `/attempts/${att.body.id}/submit`)).status).toBe(200);
      const rep = await userB.api.call('POST', '/content-reports', { question_version_id: q0.question_version_id, reason: 'typo' });
      expect(rep.status).toBe(201);
      const r = await admin.call('PATCH', `/admin/content/reports/${rep.body.id}`, { status: 'fixed', resolution_note: 'Đã sửa chính tả' });
      expect(r.status).toBe(200);
      await expect
        .poll(async () => ((await dbs.db.execute(sql`select payload->>'url' as url from ops.notifications where user_id = ${userB.id} and template_code = 'content.report_resolved' and payload->>'report_id' = ${rep.body.id}`)) as unknown as Array<{ url: string }>)[0]?.url ?? null, { timeout: 5000 })
        .toBe(`/attempts/${att.body.id}/review?focus=${q0.question_version_id}`);
    });
  });

  describe('ticket hỗ trợ 2 chiều', () => {
    it('người học xem ticket; admin lọc quá hạn, trả lời (in-app + email) + cấp credit bù; người học trả lời → mở lại; đóng → 409', async () => {
      const mine = await userA.api.call('GET', '/me/support/tickets');
      expect(mine.body.data[0]).toMatchObject({ id: ticketId, status: 'open', category: 'account' });
      expect((await userB.api.call('GET', `/me/support/tickets/${ticketId}`)).status).toBe(404);
      await dbs.db.execute(sql`update ops.support_tickets set first_response_due_at = now() - interval '1 hour' where id = ${ticketId}`);
      const list = await admin.call('GET', `/admin/support/tickets?overdue=true&user_id=${userA.id}`);
      expect(list.body.data.map((t: { id: string }) => t.id)).toContain(ticketId);
      expect(list.body.data[0].user).toMatchObject({ id: userA.id, email_masked: expect.stringMatching(/\*\*\*@example\.com$/) });
      const before = (await admin.call('GET', `/admin/users/${userA.id}/credits/ledger`)).body.balance as number;
      const reply = await admin.call('POST', `/admin/support/tickets/${ticketId}/messages`, { message: 'Bạn thử lại giúp mình, mã đã được kích hoạt.', credit: { delta: 100, note: 'Bù lỗi đổi mã' } });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({ status: 'waiting_user', overdue: false, credit: { delta: 100, balance: before + 100 } });
      expect(reply.body.first_responded_at).not.toBeNull();
      expect(reply.body.delivery.map((d: { channel: string; status: string }) => `${d.channel}:${d.status}`).sort()).toEqual(['email:sent', 'inapp:sent']);
      expect(mailer.lastTo(userA.email)?.subject).toContain('Không đổi được mã mời');
      const ledger = (await dbs.db.execute(sql`select reason::text as reason, delta from billing.credit_ledger where user_id = ${userA.id} and reason = 'admin_adjust' order by id desc limit 1`)) as unknown as Array<{ reason: string; delta: number }>;
      expect(ledger[0]).toMatchObject({ reason: 'admin_adjust', delta: 100 });
      const audit = (await dbs.db.execute(sql`select count(*)::int as n from ops.audit_logs where action = 'user.grant_credits' and entity_id = ${userA.id}`)) as unknown as Array<{ n: number }>;
      expect(audit[0]!.n).toBeGreaterThanOrEqual(1);
      const back = await userA.api.call('POST', `/support/tickets/${ticketId}/messages`, { message: 'Được rồi, cảm ơn!' });
      expect(back.status).toBe(201);
      expect(back.body.status).toBe('open');
      expect(back.body.messages.map((m: { author: string }) => m.author)).toEqual(['user', 'agent', 'user']);
      expect((await admin.call('PATCH', `/admin/support/tickets/${ticketId}`, { status: 'closed', priority: 'low' })).body).toMatchObject({ status: 'closed', priority: 'low' });
      const closed = await userA.api.call('POST', `/support/tickets/${ticketId}/messages`, { message: 'Còn lỗi' });
      expect(closed.status).toBe(409);
      expect(closed.body.error.details.reason).toBe('ticket_closed');
    });
  });
});
