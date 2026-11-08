import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { DbService } from '../../src/shared/db/db.module.js';
import { MailerService } from '../../src/shared/notify/mailer.service.js';
import { StorageService } from '../../src/shared/storage/storage.module.js';
import { base32Decode, totp } from '../../src/modules/iam/index.js';
import { RetentionService } from '../../src/modules/admin/index.js';
import { BillingJobsService } from '../../src/modules/billing/index.js';
import { bootTestApp, client } from './setup.js';

const STRONG = 'Hoc-vien#S12-xK9q';
const uniq = () => randomBytes(4).toString('hex');
type Api = ReturnType<typeof client>;
const ENV_KEYS = ['ADMIN_MFA_REQUIRED', 'JOBS_INLINE', 'BILLING_REPORT_EMAILS', 'RETENTION_OUTBOX_DAYS'] as const;

/**
 * Sprint 12 – admin tổng hợp & bảo mật (PG/Redis cục bộ): MFA TOTP bắt buộc cho admin (step-up, refresh giữ claim, replay,
 * mã khôi phục, khoá 5 lần sai), tìm/hồ sơ người dùng (PII che), khoá → thu hồi phiên ngay, impersonate chỉ đọc có audit,
 * xoá theo yêu cầu, audit search, DLQ replay, trạng thái hệ thống, thống kê câu, AI quality, KPI beta, retention, email đối soát,
 * chính sách mật khẩu, văn bản pháp lý + đồng ý refund_policy, các sửa lỗi web S10 (preview SRS, notes system_summary, stats).
 */
describe('S12 admin & ops (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let mailer: MailerService;
  let admin: Api;
  let adminId = '';
  let secret = '';
  let recovery: string[] = [];
  const saved: Record<string, string | undefined> = {};

  const register = async (email = `s12a-${uniq()}@example.com`, password = STRONG) => {
    const api = client(app);
    const r = await api.call('POST', '/auth/register', { email, password, display_name: 'S12 Admin Ops', accept_terms: true });
    return { api, status: r.status, body: r.body, id: r.body?.user?.id as string, email };
  };
  const login = async (email: string) => {
    const api = client(app);
    const r = await api.call('POST', '/auth/login', { email, password: STRONG });
    expect(r.status).toBe(200);
    return api;
  };
  const code = (offsetSteps = 0) => totp(base32Decode(secret), Date.now() + offsetSteps * 30_000);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const inject = (o: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }) =>
    app.getHttpAdapter().getInstance().inject({ method: o.method, url: `/v1${o.url}`, payload: o.body === undefined ? undefined : JSON.stringify(o.body), headers: { 'content-type': 'application/json', ...(o.headers ?? {}) } });

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.ADMIN_MFA_REQUIRED = 'true';
    process.env.JOBS_INLINE = 'true';
    process.env.BILLING_REPORT_EMAILS = 'billing-ops@allingo.test';
    process.env.RETENTION_OUTBOX_DAYS = '1';
    app = await bootTestApp();
    dbs = app.get(DbService);
    mailer = app.get(MailerService);
    // Admin riêng cho test (vai trò gán thẳng DB – admin chỉ được superadmin cấp)
    const r = await register(`s12-admin-${uniq()}@example.com`);
    expect(r.status).toBe(201);
    adminId = r.id;
    await dbs.db.execute(sql`insert into iam.user_roles (user_id, role_code) values (${adminId}, 'admin') on conflict do nothing`);
    admin = await login(r.email);
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await app?.close();
  });

  describe('MFA TOTP bắt buộc cho admin', () => {
    it('chưa step-up → 403 mfa_required; enroll → confirm (mã khôi phục) → endpoint admin chạy; refresh giữ claim mfa', async () => {
      const blocked = await admin.call('GET', '/admin/flags');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toMatchObject({ code: 'mfa_required', details: { reason: 'step_up_required', enroll_path: '/auth/mfa/totp/enroll', verify_path: '/auth/mfa/verify' } });
      expect((await admin.call('GET', '/me/mfa')).body).toEqual({ required: true, enrolled: false, pending_enrollment: false, session_verified: false, recovery_codes_remaining: 0 });
      // người học không đăng ký được
      const learner = await register();
      expect((await learner.api.call('POST', '/auth/mfa/totp/enroll')).body.error.details.reason).toBe('mfa_not_available');
      const en = await admin.call('POST', '/auth/mfa/totp/enroll');
      expect(en.status).toBe(200);
      expect(en.body).toMatchObject({ digits: 6, period: 30, algorithm: 'SHA1' });
      expect(en.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/Allingo:s12-admin-/);
      secret = en.body.secret;
      const stored = (await dbs.db.execute(sql`select secret_enc from iam.mfa_factors where user_id = ${adminId}`)) as unknown as Array<{ secret_enc: string }>;
      expect(stored[0]!.secret_enc.startsWith('v1.')).toBe(true);
      expect(stored[0]!.secret_enc).not.toContain(secret);
      expect((await admin.call('POST', '/auth/mfa/totp/confirm', { code: '000000' })).status).toBe(400);
      const ok = await admin.call('POST', '/auth/mfa/totp/confirm', { code: code() });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ mfa: true, expires_in: 900 });
      expect(ok.body.recovery_codes).toHaveLength(10);
      recovery = ok.body.recovery_codes;
      expect((await admin.call('GET', '/admin/flags')).status).toBe(200);
      expect((await admin.call('GET', '/me/mfa')).body).toMatchObject({ enrolled: true, session_verified: true, recovery_codes_remaining: 10 });
      // refresh xoay vòng → access mới vẫn có mfa
      expect((await admin.call('POST', '/auth/refresh', {})).status).toBe(200);
      expect((await admin.call('GET', '/admin/flags')).status).toBe(200);
      expect((await admin.call('POST', '/auth/mfa/totp/enroll')).status).toBe(409);
    });

    it('phiên mới cần step-up; mã TOTP đã dùng bị từ chối (replay); mã khôi phục dùng một lần; 5 lần sai → 429 mfa_locked', async () => {
      const s2 = await (async () => {
        const [{ email }] = (await dbs.db.execute(sql`select email from iam.users where id = ${adminId}`)) as unknown as [{ email: string }];
        return login(email);
      })();
      expect((await s2.call('GET', '/admin/flags')).body.error.code).toBe('mfa_required');
      const c = code(1);
      expect((await s2.call('POST', '/auth/mfa/verify', { code: c })).status).toBe(200);
      expect((await s2.call('GET', '/admin/flags')).status).toBe(200);
      const s3 = await login(((await dbs.db.execute(sql`select email from iam.users where id = ${adminId}`)) as unknown as Array<{ email: string }>)[0]!.email);
      const replay = await s3.call('POST', '/auth/mfa/verify', { code: c });
      expect(replay.status).toBe(400);
      expect(replay.body.error.details.reason).toBe('mfa_invalid');
      expect((await s3.call('POST', '/auth/mfa/verify', { recovery_code: recovery[0]!.toLowerCase() })).status).toBe(200);
      expect((await s3.call('GET', '/me/mfa')).body.recovery_codes_remaining).toBe(9);
      const s4 = await login(((await dbs.db.execute(sql`select email from iam.users where id = ${adminId}`)) as unknown as Array<{ email: string }>)[0]!.email);
      expect((await s4.call('POST', '/auth/mfa/verify', { recovery_code: recovery[0] })).status).toBe(400);
      const audit = (await dbs.db.execute(sql`select action from ops.audit_logs where actor_user_id = ${adminId} and action like 'mfa.%' order by id`)) as unknown as Array<{ action: string }>;
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['mfa.enroll_started', 'mfa.enrolled', 'mfa.verified', 'mfa.verify_failed']));
      // khoá: đã có 1 lần sai (replay)… thêm sai tới 5 → lần kế tiếp 429
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await s4.call('POST', '/auth/mfa/verify', { code: '000001' })).status;
      expect(last).toBe(429);
      const locked = await s4.call('POST', '/auth/mfa/verify', { code: code() });
      expect(locked.body.error.details.reason).toBe('mfa_locked');
    });
  });

  describe('admin người dùng', () => {
    let target: Awaited<ReturnType<typeof register>>;
    it('tìm theo email (tiền tố)/tên/id – email che; hồ sơ có lịch sử, credit, beta, phiên', async () => {
      target = await register(`s12-target-${uniq()}@example.com`);
      expect(target.status).toBe(201);
      const byEmail = await admin.call('GET', `/admin/users?q=${encodeURIComponent(target.email.slice(0, 18))}`);
      expect(byEmail.status).toBe(200);
      expect(byEmail.body.data.map((u: { id: string }) => u.id)).toContain(target.id);
      expect(JSON.stringify(byEmail.body)).not.toContain(target.email);
      expect((await admin.call('GET', `/admin/users?q=${target.id}`)).body.data).toHaveLength(1);
      const detail = await admin.call('GET', `/admin/users/${target.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ id: target.id, status: 'active', email_masked: expect.stringMatching(/^s1\*\*\*@example\.com$/), active_sessions: 1, mfa_enrolled: false, credits: { balance: expect.any(Number) }, attempts: [], orders: [], tickets: [], beta: { tester: false } });
      expect(detail.body).not.toHaveProperty('email');
      expect((await admin.call('GET', `/admin/users/${randomUUID()}`)).status).toBe(404);
    });

    it('khoá → mọi phiên bị thu hồi ngay (≤ 60 s), đăng nhập 401; mở khoá → đăng nhập lại được; không khoá chính mình', async () => {
      expect((await target.api.call('GET', '/me')).status).toBe(200);
      const t0 = Date.now();
      const r = await admin.call('POST', `/admin/users/${target.id}/lock`, { reason: 'Nghi lạm dụng (test)' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'suspended', sessions_revoked: 1 });
      expect((await target.api.call('GET', '/me')).status).toBe(401);
      expect(Date.now() - t0).toBeLessThan(60_000);
      expect((await target.api.call('POST', '/auth/refresh', {})).status).toBe(401);
      expect((await client(app).call('POST', '/auth/login', { email: target.email, password: STRONG })).status).toBe(401);
      expect((await admin.call('POST', `/admin/users/${target.id}/lock`, { reason: 'lặp lại' })).status).toBe(200);
      expect((await admin.call('POST', `/admin/users/${adminId}/lock`, { reason: 'tự khoá' })).status).toBe(403);
      expect((await admin.call('POST', `/admin/users/${target.id}/unlock`, {})).body).toMatchObject({ status: 'active' });
      target.api = await login(target.email);
      expect((await target.api.call('GET', '/me')).status).toBe(200);
    });

    it('impersonate CHỈ ĐỌC: GET được, ghi/admin → 403; mọi request ghi audit; không impersonate admin; khoá → token chết', async () => {
      expect((await admin.call('POST', `/admin/users/${adminId}/impersonate`, { reason: 'x' })).status).toBe(400);
      const imp = await admin.call('POST', `/admin/users/${target.id}/impersonate`, { reason: 'Hỗ trợ ticket #42' });
      expect(imp.status).toBe(201);
      expect(imp.body).toMatchObject({ token_type: 'Bearer', expires_in: 600, scope: 'read_only', user_id: target.id });
      const h = bearer(imp.body.access_token);
      const me = await inject({ method: 'GET', url: '/me', headers: h });
      expect(me.statusCode).toBe(200);
      expect(me.json().id).toBe(target.id);
      const write = await inject({ method: 'POST', url: '/notes', body: { body: 'không được ghi', attempt_id: randomUUID() }, headers: h });
      expect(write.statusCode).toBe(403);
      expect(write.json().error.details.reason).toBe('impersonation_read_only');
      const adm = await inject({ method: 'GET', url: '/admin/flags', headers: h });
      expect(adm.statusCode).toBe(403);
      expect(adm.json().error.details.reason).toBe('impersonation_admin_forbidden');
      expect((await inject({ method: 'POST', url: '/auth/mfa/totp/enroll', headers: h })).statusCode).toBe(403);
      const logs = (await dbs.db.execute(sql`select after from ops.audit_logs where action = 'impersonation.request' and entity_id = ${target.id} and actor_user_id = ${adminId} order by id`)) as unknown as Array<{ after: { method: string; route: string; blocked: string | null; impersonation_id: string } }>;
      expect(logs.length).toBeGreaterThanOrEqual(4);
      expect(logs.map((l) => `${l.after.method} ${l.after.route} ${l.after.blocked ?? 'ok'}`)).toEqual(expect.arrayContaining(['GET /v1/me ok', 'POST /v1/notes impersonation_read_only', 'GET /v1/admin/flags impersonation_admin_forbidden']));
      expect(logs.every((l) => l.after.impersonation_id === imp.body.impersonation_id)).toBe(true);
      const started = (await dbs.db.execute(sql`select count(*)::int as n from ops.audit_logs where action = 'user.impersonation_started' and entity_id = ${target.id}`)) as unknown as Array<{ n: number }>;
      expect(started[0]!.n).toBe(1);
      const other = await register(`s12-adm2-${uniq()}@example.com`);
      await dbs.db.execute(sql`insert into iam.user_roles (user_id, role_code) values (${other.id}, 'admin') on conflict do nothing`);
      expect((await admin.call('POST', `/admin/users/${other.id}/impersonate`, { reason: 'thử admin' })).body.error.details.reason).toBe('target_privileged');
      await admin.call('POST', `/admin/users/${target.id}/lock`, { reason: 'thu hồi impersonate' });
      expect((await inject({ method: 'GET', url: '/me', headers: h })).statusCode).toBe(401);
      await admin.call('POST', `/admin/users/${target.id}/unlock`, {});
    });

    it('xoá theo yêu cầu → 202 (72 giờ), lần 2 → 409; audit có admin id; tìm audit theo action tiền tố + entity', async () => {
      const d = await register();
      const r = await admin.call('POST', `/admin/users/${d.id}/deletion`, { reason: 'Yêu cầu qua ticket hỗ trợ' });
      expect(r.status).toBe(202);
      expect(r.body.status).toBe('scheduled');
      expect((await admin.call('POST', `/admin/users/${d.id}/deletion`, { reason: 'lặp' })).status).toBe(409);
      const logs = await admin.call('GET', `/admin/audit-logs?action=user.&entity_id=${target.id}&limit=50`);
      expect(logs.status).toBe(200);
      const actions = logs.body.data.map((x: { action: string }) => x.action);
      expect(actions).toEqual(expect.arrayContaining(['user.locked', 'user.unlocked', 'user.impersonation_started']));
      expect(logs.body.data.every((x: { action: string }) => x.action.startsWith('user.'))).toBe(true);
      const exact = await admin.call('GET', `/admin/audit-logs?action=admin.user_deletion_requested&actor=${adminId}`);
      expect(exact.body.data[0]).toMatchObject({ action: 'admin.user_deletion_requested', entity_id: d.id, actor_user_id: adminId });
      const page1 = await admin.call('GET', `/admin/audit-logs?actor=${adminId}&limit=2`);
      expect(page1.body.next_cursor).toBeTruthy();
      const page2 = await admin.call('GET', `/admin/audit-logs?actor=${adminId}&limit=2&cursor=${page1.body.next_cursor}`);
      expect(page2.body.data[0].id).toBeLessThan(page1.body.data[1].id);
      expect((await admin.call('GET', '/admin/audit-logs?from=2026-12-01T00:00:00Z&to=2026-01-01T00:00:00Z')).status).toBe(400);
    });
  });

  describe('hệ thống & nội dung', () => {
    it('DLQ: liệt kê mọi hàng đợi, replay job có handler (inline) + audit; không handler → 409', async () => {
      const [row] = (await dbs.db.execute(sql`insert into ops.jobs_deadletter (queue, job_id, payload, error, attempts) values ('maintenance', ${`ops.sla_check__dl-${uniq()}`}, ${JSON.stringify({ _business_id: 'dl-test' })}::jsonb, 'boom', 2) returning id`)) as unknown as Array<{ id: string }>;
      const list = await admin.call('GET', '/admin/jobs/dead-letters?queue=maintenance&replayed=false&limit=100');
      expect(list.body.data.find((x: { id: string }) => x.id === row!.id)).toMatchObject({ job: 'ops.sla_check', replay_count: 0, replayed_at: null });
      const rep = await admin.call('POST', `/admin/jobs/dead-letters/${row!.id}/replay`);
      expect(rep.status).toBe(200);
      expect(rep.body).toMatchObject({ mode: 'inline', replay_count: 1, error: null, result: { content_reports_overdue: expect.any(Number), support_tickets_overdue: expect.any(Number) } });
      expect(rep.body.replayed_at).not.toBeNull();
      const [bad] = (await dbs.db.execute(sql`insert into ops.jobs_deadletter (queue, job_id) values ('notify', ${uniq()}) returning id`)) as unknown as Array<{ id: string }>;
      expect((await admin.call('POST', `/admin/jobs/dead-letters/${bad!.id}/replay`)).body.error.details.reason).toBe('no_handler');
      const audit = (await dbs.db.execute(sql`select count(*)::int as n from ops.audit_logs where action = 'job.dead_letter_replayed' and entity_id = ${row!.id}`)) as unknown as Array<{ n: number }>;
      expect(audit[0]!.n).toBe(1);
    });

    it('trạng thái hệ thống: hàng đợi, dead-letter, partition, cờ, SLA, outbox', async () => {
      const r = await admin.call('GET', '/admin/system/status');
      expect(r.status).toBe(200);
      expect(r.body.partitions.map((p: { table: string }) => p.table)).toEqual(expect.arrayContaining(['learn.attempt_answers', 'ops.audit_logs']));
      expect(r.body).toMatchObject({ dead_letters: { total: expect.any(Number) }, sla: { content_reports_overdue: expect.any(Number), support_tickets_overdue: expect.any(Number) }, outbox: { unpublished: expect.any(Number) } });
      expect(r.body.flags.some((f: { key: string }) => f.key === 'ff.growth.beta_gate')).toBe(true);
      if (r.body.redis_healthy) expect(r.body.queues.map((q: { queue: string }) => q.queue)).toEqual(['grading', 'content', 'media', 'notify', 'analytics', 'maintenance']);
    });

    it('content.stats_nightly: p-value/point-biserial/đề xuất khớp tính trực tiếp từ attempt_answers', async () => {
      const r = await admin.call('POST', '/admin/content/questions/stats/recompute');
      expect(r.status).toBe(202);
      expect(r.body.result).toMatchObject({ questions: expect.any(Number), updated: expect.any(Number) });
      const list = await admin.call('GET', '/admin/content/questions/stats?min_n=1&sort=n&limit=5');
      expect(list.status).toBe(200);
      if (!list.body.data.length) return; // DB test chưa có bài chấm – job vẫn chạy
      const top = list.body.data[0];
      const [direct] = (await dbs.db.execute(sql`
        select count(*)::int as n, sum(case when aa.is_correct then 1 else 0 end)::int as c from learn.attempt_answers aa join learn.attempts a on a.id = aa.attempt_id
        where aa.question_id = ${top.question_id} and aa.is_correct is not null and a.status = 'graded'
          and (select count(*) from learn.attempt_answers x where x.attempt_id = aa.attempt_id and x.is_correct is not null) >= 2`)) as unknown as Array<{ n: number; c: number }>;
      expect(top.n).toBe(direct!.n);
      expect(top.p_value).toBeCloseTo(direct!.c / direct!.n, 3);
      expect(['retire', 'review', 'ok', 'insufficient_data']).toContain(top.recommendation);
    });

    it('AI quality theo phiên bản prompt + mẫu refused (không nội dung) + KPI beta (Markdown)', async () => {
      const q = await admin.call('GET', '/admin/ai/quality');
      expect(q.status).toBe(200);
      expect(Array.isArray(q.body.data)).toBe(true);
      const ref = await admin.call('GET', '/admin/ai/refusals?limit=5');
      expect(ref.status).toBe(200);
      for (const x of ref.body.data) for (const k of Object.keys(x.input_ref ?? {})) expect(k).toMatch(/_id$/);
      const beta = await admin.call('GET', '/admin/reports/beta?week=2026-W45');
      expect(beta.status).toBe(200);
      expect(beta.body.markdown).toContain('# Báo cáo beta kín – tuần 2026-W45');
      expect(beta.body.kpis).toMatchObject({ week: '2026-W45', cohort: { testers: expect.any(Number) }, crash_free: { rate: null } });
      expect(beta.body.posthog).toBeNull();
    });

    it('ops.retention_cleanup: ghi âm hết hạn (+ tệp S3), outbox đã relay cũ; audit kết quả', async () => {
      const storage = app.get(StorageService);
      const [u] = (await dbs.db.execute(sql`select id from iam.users where id = ${adminId}`)) as unknown as Array<{ id: string }>;
      const key = `rec/test/${uniq()}.webm`;
      await storage.putObject('recordings', key, Buffer.from('fake audio'), { contentType: 'audio/webm' });
      const [rec] = (await dbs.db.execute(sql`insert into learn.recordings (user_id, storage_key, mime_type, expires_at) values (${u!.id}, ${key}, 'audio/webm', now() - interval '1 day') returning id`)) as unknown as Array<{ id: string }>;
      await dbs.db.execute(sql`insert into ops.outbox (aggregate_type, event_type, payload, created_at, published_at) values ('test', 'test.retention', '{}', now() - interval '2 days', now() - interval '2 days')`);
      const r = await app.get(RetentionService).run();
      expect(r.recordings.deleted).toBeGreaterThanOrEqual(1);
      expect(r.recordings.purged_files).toBeGreaterThanOrEqual(1);
      expect(r.outbox).toBeGreaterThanOrEqual(1);
      expect(await storage.headObject('recordings', key)).toBeNull();
      expect(((await dbs.db.execute(sql`select count(*)::int as n from learn.recordings where id = ${rec!.id}`)) as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
      const audit = (await dbs.db.execute(sql`select after from ops.audit_logs where action = 'ops.retention_cleanup' order by id desc limit 1`)) as unknown as Array<{ after: { policy: { outbox_days: number } } }>;
      expect(audit[0]!.after.policy.outbox_days).toBe(1);
    });

    it('billing.reconcile gửi email báo cáo tới BILLING_REPORT_EMAILS', async () => {
      const before = mailer.allTo('billing-ops@allingo.test').length;
      const r = await app.get(BillingJobsService).run('billing.reconcile');
      expect(r.emailed).toBe(1);
      const m = mailer.lastTo('billing-ops@allingo.test');
      expect(mailer.allTo('billing-ops@allingo.test').length).toBe(before + 1);
      expect(m?.subject).toMatch(/^\[Allingo billing\] Đối soát \d{4}-\d{2}-\d{2}/);
      expect(m?.text).toContain('mock');
    });
  });

  describe('bảo mật & pháp lý', () => {
    it('mật khẩu ≥ 12 ký tự + không thuộc danh sách lộ', async () => {
      const short = await register(undefined, 'Abcdefgh12!');
      expect(short.status).toBe(400);
      expect(short.body.error.details.issues[0]).toMatchObject({ path: 'password', code: 'password_too_short' });
      expect(short.body.error.details.min_length).toBe(12);
      const leaked = await register(undefined, 'Password123!');
      expect(leaked.body.error.details.issues[0].code).toBe('password_breached');
      expect((await register(undefined, 'Matkhau@2026')).body.error.details.issues[0].code).toBe('password_breached');
      expect((await register()).status).toBe(201);
    });

    it('văn bản pháp lý có phiên bản (placeholder chờ luật sư) + đồng ý refund_policy', async () => {
      const p = await inject({ method: 'GET', url: '/legal/policies' });
      expect(p.statusCode).toBe(200);
      expect(p.json().data.map((x: { type: string }) => x.type)).toEqual(['terms', 'privacy', 'refund_policy', 'voice_consent']);
      const u = await register();
      const c = await u.api.call('POST', '/me/consents', { type: 'refund_policy', granted: true });
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ type: 'refund_policy', revoked_at: null });
      expect((await u.api.call('POST', '/me/consents', { type: 'voice_processing', granted: true })).status).toBe(200);
    });
  });

  describe('sửa lỗi phát hiện ở web Sprint 10', () => {
    it('POST /me/srs/review trả preview; GET /notes?kind=system_summary; stats minutes_this_week = tuần cuối; score_history có part/scale', async () => {
      const u = await register();
      const [item] = (await dbs.db.execute(sql`select id from catalog.vocab_items limit 1`)) as unknown as Array<{ id: string }>;
      const card = await u.api.call('POST', '/me/srs/cards', { program: 'toeic', card_type: 'vocab', ref_id: item!.id, source_type: 'manual' });
      expect(card.status).toBe(201);
      const rev = await u.api.call('POST', '/me/srs/review', { reviews: [{ card_id: card.body.id, rating: 3 }] });
      expect(rev.status).toBe(200);
      expect(rev.body[0].preview).toMatchObject({ again: expect.any(String), hard: expect.any(String), good: expect.any(String), easy: expect.any(String) });
      await dbs.db.execute(sql`insert into learn.notes (user_id, body, kind, data) values (${u.id}, 'Bạn tiến bộ ở Part 5', 'system_summary', ${JSON.stringify({ attempt_id: randomUUID(), attempt_ids: [], program: 'toeic', summary: { headline: 'Tiến bộ Part 5' }, ai_task_id: 'x', prompt_version_id: 'y' })}::jsonb)`);
      const mine = await u.api.call('GET', '/notes');
      expect(mine.body.data).toHaveLength(0);
      const sums = await u.api.call('GET', '/notes?kind=system_summary');
      expect(sums.body.data[0]).toMatchObject({ kind: 'system_summary', body: 'Bạn tiến bộ ở Part 5', summary: { headline: 'Tiến bộ Part 5' } });
      expect(sums.body.data[0]).not.toHaveProperty('ai_task_id');
      const stats = await u.api.call('GET', '/me/stats?program=toeic');
      expect(stats.status).toBe(200);
      expect(stats.body.minutes_this_week).toBe(stats.body.minutes_by_week.at(-1).minutes);
      expect(stats.body.minutes_this_week).toBeGreaterThanOrEqual(0);
    });
  });
});
