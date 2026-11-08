import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { partitionCoverage, schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { RedisService } from '../../src/shared/cache/redis.module.js';
import { QueueService, TRACEPARENT_FIELD } from '../../src/shared/queue/queue.module.js';
import { runWithContext } from '../../src/shared/telemetry/request-context.js';
import { AuditService } from '../../src/shared/events/audit.service.js';
import { FeatureFlagService } from '../../src/modules/billing/index.js';
import { ENV, type Env } from '../../src/config/env.js';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const uniq = () => randomBytes(4).toString('hex');
type Api = ReturnType<typeof client>;
const ENV_KEYS = ['RATE_LIMIT_MAX', 'RATE_LIMIT_BUCKET_MULTIPLIER', 'AUTH_MIN_RESPONSE_MS', 'JOBS_INLINE', 'CSRF_TRUSTED_ORIGINS'] as const;

/**
 * Sprint 11 – vận hành & bảo mật trên PG/Redis cục bộ: trace propagation (header + envelope + job BullMQ), /v1/metrics (RED,
 * DB, hàng đợi, partition, cache), header bảo mật, CSRF cookie-auth, giới hạn tốc độ toàn cục + token bucket, khoá đăng nhập,
 * thời gian phản hồi đều, feature flag + kill-switch < 60 s (kể cả replica khác qua pub/sub), độ phủ partition.
 */
describe('S11 ops & security (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let admin: Api;
  let env: Env;
  let miniSetId = '';
  const saved: Record<string, string | undefined> = {};
  const inject = (o: { method: 'GET' | 'POST' | 'PUT'; url: string; body?: unknown; headers?: Record<string, string>; ip?: string; cookies?: Record<string, string> }) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: o.method, url: `/v1${o.url}`, payload: o.body === undefined ? undefined : JSON.stringify(o.body), headers: { 'content-type': 'application/json', ...(o.headers ?? {}) }, remoteAddress: o.ip ?? '127.0.0.1', cookies: o.cookies });
  const newUser = async () => {
    const api = client(app);
    const email = `s11-${uniq()}@example.com`;
    const r = await api.call('POST', '/auth/register', { email, password: 'Hoc-vien#S12-xK9q', display_name: 'S11', accept_terms: true });
    expect(r.status).toBe(201);
    return { api, id: r.body.user.id as string, email, token: r.body.access_token as string };
  };

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.RATE_LIMIT_MAX = '20';
    process.env.RATE_LIMIT_BUCKET_MULTIPLIER = '1';
    process.env.AUTH_MIN_RESPONSE_MS = '150';
    process.env.JOBS_INLINE = 'true';
    app = await bootTestApp();
    dbs = app.get(DbService);
    env = app.get(ENV);
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    for (const k of ['ff.ai.explain', 'ff.ai.tutor', 'ff.ai.diagnose']) await admin.call('PUT', `/admin/flags/${k}`, { enabled: true, rules: {} });
    const sets = await admin.call('GET', '/programs/toeic/test-sets?kind=mini');
    miniSetId = sets.body.data.find((t: { code: string }) => t.code === 'toeic-mini-part5-01').id;
  });

  afterAll(async () => {
    for (const k of ['ff.ai.explain', 'ff.ai.tutor', 'ff.ai.diagnose']) await admin?.call('PUT', `/admin/flags/${k}`, { enabled: true, rules: {} });
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await app?.close();
  });

  describe('trace propagation', () => {
    it('traceparent của client → x-trace-id + error.trace_id (GET 404 và POST có body); không có → 32 hex', async () => {
      const traceId = randomBytes(16).toString('hex');
      const tp = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
      const nf = await inject({ method: 'GET', url: '/attempts/00000000-0000-4000-8000-000000000000/review', headers: { traceparent: tp, authorization: `Bearer ${(await newUser()).token}` } });
      expect(nf.headers['x-trace-id']).toBe(traceId);
      expect(nf.json().error.trace_id).toBe(traceId);
      const bad = await inject({ method: 'POST', url: '/auth/login', body: { email: `nobody-${uniq()}@example.com`, password: 'wrong-password-1' }, headers: { traceparent: tp } });
      expect(bad.statusCode).toBe(401);
      expect(bad.json().error.trace_id).toBe(traceId);
      const plain = await inject({ method: 'GET', url: '/flags' });
      expect(plain.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
      // x-request-id không an toàn bị bỏ qua (chống chèn log)
      const inj = await inject({ method: 'GET', url: '/flags', headers: { 'x-request-id': 'abc\nlevel=error' } });
      expect(inj.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
    });

    it('job BullMQ mang traceparent của request (API → worker cùng trace)', async () => {
      const q = app.get(QueueService);
      const traceId = randomBytes(16).toString('hex');
      const biz = `s11-${uniq()}`;
      const ok = await runWithContext({ traceId, spanId: randomBytes(8).toString('hex'), sampled: true }, () => q.enqueue('maintenance', 's11.noop', biz, { x: 1 }, { delay: 3_600_000 }));
      expect(ok).toBe(true);
      const job = await q.get('maintenance').getJob(`s11.noop__${biz}`);
      expect(String(job?.data[TRACEPARENT_FIELD])).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
      expect(job?.data.x).toBe(1);
      await job?.remove();
    });
  });

  describe('/v1/metrics (Prometheus)', () => {
    it('cần token; có RED theo mẫu route (không id thô), DB, hàng đợi, partition, cache, process', async () => {
      const u = await newUser();
      const a = await u.api.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: miniSetId }, { 'idempotency-key': crypto.randomUUID() });
      expect(a.status).toBe(201);
      expect((await u.api.call('PUT', `/attempts/${a.body.id}/answers`, { answers: [{ question_id: a.body.questions[0].question_id, answer: { type: 'mcq_single', selected: 'A' } }] })).status).toBe(204);
      expect((await inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
      const m = await inject({ method: 'GET', url: '/metrics', headers: { 'x-internal-token': env.INTERNAL_API_TOKEN } });
      expect(m.statusCode).toBe(200);
      const text = m.body;
      expect(text).toMatch(/http_server_request_duration_seconds_bucket\{method="PUT",route="\/v1\/attempts\/:attemptId\/answers",status="204",le="0\.2"\} \d+/);
      expect(text).toContain('http_server_requests_total{method="POST",route="/v1/attempts",status="201"}');
      expect(text).not.toContain(a.body.id);
      expect(text).not.toContain(u.email);
      for (const name of ['db_connections{state="active"}', 'db_max_connections', 'db_pool_max{pool="primary"}', 'db_query_duration_seconds_bucket', 'bullmq_queue_jobs{queue="grading",state="waiting"}', 'bullmq_queue_oldest_waiting_seconds{queue="grading"}', 'bullmq_deadletter_jobs{queue="grading"}', 'db_partition_months_ahead{table="learn.attempt_answers"}', 'cache_requests_total', 'process_resident_memory_bytes', 'nodejs_eventloop_lag_p99_seconds', 'allingo_build_info']) {
        expect(text, name).toContain(name);
      }
    });
  });

  describe('hardening HTTP', () => {
    it('header bảo mật: CSP khoá JSON, HSTS, nosniff, chống frame, no-referrer; phản hồi có phiên no-store', async () => {
      const r = await inject({ method: 'GET', url: '/flags' });
      expect(r.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      expect(String(r.headers['strict-transport-security'])).toContain('max-age=31536000');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      const me = await admin.call('GET', '/me');
      expect(me.headers['cache-control']).toBe('no-store');
    });

    it('CSRF: cookie + Origin lạ/null/cross-site → 403 csrf_origin_mismatch; Origin web → OK; bearer không bị ảnh hưởng; login CSRF chặn', async () => {
      const u = await newUser();
      const cookies = u.api.cookies();
      const note = { body: 'ghi chú CSRF' };
      const evil = await inject({ method: 'POST', url: '/notes', body: note, cookies, headers: { origin: 'https://evil.example' } });
      expect(evil.statusCode).toBe(403);
      expect(evil.json().error).toMatchObject({ code: 'forbidden', details: { reason: 'csrf_origin_mismatch' } });
      expect((await inject({ method: 'POST', url: '/notes', body: note, cookies, headers: { origin: 'null' } })).statusCode).toBe(403);
      expect((await inject({ method: 'POST', url: '/notes', body: note, cookies, headers: { 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
      expect((await inject({ method: 'POST', url: '/notes', body: note, cookies, headers: { origin: 'http://localhost:3000' } })).statusCode).toBe(201);
      expect((await inject({ method: 'POST', url: '/notes', body: note, headers: { origin: 'https://evil.example', authorization: `Bearer ${u.token}` } })).statusCode).toBe(201);
      const login = await inject({ method: 'POST', url: '/auth/login', body: { email: u.email, password: 'Hoc-vien#S12-xK9q' }, headers: { origin: 'https://evil.example' } });
      expect(login.statusCode).toBe(403);
      expect((await inject({ method: 'POST', url: '/auth/login', body: { email: u.email, password: 'Hoc-vien#S12-xK9q' }, headers: { origin: 'http://localhost:3000' } })).statusCode).toBe(200);
    });
  });

  describe('giới hạn tốc độ', () => {
    it('toàn cục theo IP (Redis store): vượt RATE_LIMIT_MAX → 429 rate_limited + Retry-After + envelope; IP allowlist không bị giới hạn', async () => {
      const ip = `203.0.113.${(randomBytes(1)[0]! % 200) + 20}`;
      await app.get(RedisService).client.del(`${env.QUEUE_PREFIX}:rlg:${ip}`).catch(() => undefined);
      const codes: number[] = [];
      let last = null as Awaited<ReturnType<typeof inject>> | null;
      for (let i = 0; i < 22; i++) {
        last = await inject({ method: 'GET', url: '/flags', ip });
        codes.push(last.statusCode);
      }
      expect(codes.filter((c) => c === 200).length).toBe(20);
      expect(last!.statusCode).toBe(429);
      expect(last!.json().error).toMatchObject({ code: 'rate_limited', details: { scope: 'global_ip' } });
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      expect(last!.headers['x-ratelimit-limit']).toBe('20');
      for (let i = 0; i < 25; i++) expect((await inject({ method: 'GET', url: '/flags' })).statusCode).toBe(200);
    });

    it('token bucket theo người dùng: submit > 10/phút → 429 bucket submit (trước khi chạm DB attempt)', async () => {
      const u = await newUser();
      const codes: number[] = [];
      let last: { status: number; body: { error?: { details?: Record<string, unknown> } }; headers: Record<string, unknown> } | null = null;
      for (let i = 0; i < 11; i++) {
        last = await u.api.call('POST', `/attempts/${crypto.randomUUID()}/submit`);
        codes.push(last.status);
      }
      expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
      expect(last!.status).toBe(429);
      expect(last!.body.error?.details).toMatchObject({ bucket: 'submit' });
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      // người khác không bị ảnh hưởng
      expect((await (await newUser()).api.call('POST', `/attempts/${crypto.randomUUID()}/submit`)).status).toBe(404);
    });
  });

  describe('đăng nhập: khoá bất thường + thời gian đều', () => {
    it('10 lần sai → khoá (kể cả mật khẩu đúng) 429 login_locked + audit; email không tồn tại khoá y hệt', async () => {
      const u = await newUser();
      for (let i = 0; i < 10; i++) expect((await inject({ method: 'POST', url: '/auth/login', body: { email: u.email, password: `wrong-${i}-pass` } })).statusCode).toBe(401);
      const locked = await inject({ method: 'POST', url: '/auth/login', body: { email: u.email, password: 'Hoc-vien#S12-xK9q' } });
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error).toMatchObject({ code: 'rate_limited', details: { reason: 'login_locked' } });
      const audits = await dbs.db.select().from(schema.opsAuditLogs).where(and(eq(schema.opsAuditLogs.action, 'auth.login_locked'), eq(schema.opsAuditLogs.entityId, u.id)));
      expect(audits).toHaveLength(1);
      const ghost = `ghost-${uniq()}@example.com`;
      for (let i = 0; i < 10; i++) expect((await inject({ method: 'POST', url: '/auth/login', body: { email: ghost, password: `wrong-${i}-pass` } })).statusCode).toBe(401);
      expect((await inject({ method: 'POST', url: '/auth/login', body: { email: ghost, password: 'x-wrong-pass' } })).json().error.details.reason).toBe('login_locked');
      void app.get(AuditService);
    });

    it('thời gian phản hồi ≥ AUTH_MIN_RESPONSE_MS cho email có/không tồn tại và OTP (không phân biệt được theo thời gian)', async () => {
      const u = await newUser();
      const time = async (body: unknown, url = '/auth/login') => {
        const t = performance.now();
        const r = await inject({ method: 'POST', url, body });
        return { ms: performance.now() - t, status: r.statusCode };
      };
      const exist = await time({ email: u.email, password: 'wrong-password-x' });
      const ghost = await time({ email: `ghost-${uniq()}@example.com`, password: 'wrong-password-x' });
      expect(exist.status).toBe(401);
      expect(ghost.status).toBe(401);
      expect(exist.ms).toBeGreaterThanOrEqual(148);
      expect(ghost.ms).toBeGreaterThanOrEqual(148);
      const otp = await time({ email: `otp-${uniq()}@example.com`, channel: 'email' }, '/auth/otp/request');
      expect(otp.status).toBe(202);
      expect(otp.ms).toBeGreaterThanOrEqual(148);
    });
  });

  describe('feature flags & kill-switch', () => {
    it('GET /admin/flags, GET /admin/flags/{key}, 404; GET /flags ẩn danh chỉ boolean công khai', async () => {
      const list = await admin.call('GET', '/admin/flags');
      expect(list.status).toBe(200);
      const explain = list.body.data.find((f: { key: string }) => f.key === 'ff.ai.explain');
      expect(explain).toMatchObject({ enabled: true, public: true });
      expect(list.body.data.find((f: { key: string }) => f.key === 'ff.growth.beta_gate')?.public).toBe(false);
      expect((await admin.call('GET', '/admin/flags/ff.ai.explain')).body).toMatchObject({ key: 'ff.ai.explain', enabled: true });
      expect((await admin.call('GET', '/admin/flags/ff.nope.missing')).status).toBe(404);
      const u = await newUser();
      expect((await u.api.call('GET', '/admin/flags')).status).toBe(403);
      const pub = await inject({ method: 'GET', url: '/flags' });
      expect(pub.statusCode).toBe(200);
      expect(pub.json().flags['ff.ai.explain']).toBe(true);
      expect(pub.json().flags['ff.growth.beta_gate']).toBeUndefined();
      expect(JSON.stringify(pub.json())).not.toContain('user_ids');
      expect(pub.headers['cache-control']).toBe('private, no-cache');
      expect(pub.json().ttl_sec).toBe(30);
    });

    it('ff.ai.explain tắt → POST /ai/explain 503 feature_disabled (+Retry-After, message_key) ngay (< 60 s), replica khác qua pub/sub < 2 s; bật lại → chạy', async () => {
      const u = await newUser();
      const a = await u.api.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: miniSetId }, { 'idempotency-key': crypto.randomUUID() });
      const qv = a.body.questions[0].question_version_id as string;
      // "replica" thứ hai: instance FeatureFlagService riêng, cùng DB/Redis, đã nóng cache (bật)
      const flags = app.get(FeatureFlagService);
      const replica = new FeatureFlagService(env, dbs, app.get(AuditService), app.get(RedisService));
      replica.onModuleInit();
      await new Promise((r) => setTimeout(r, 300));
      expect(await replica.isEnabled('ff.ai.explain', { userId: u.id })).toBe(true);
      expect(await flags.isEnabled('ff.ai.explain', { userId: u.id })).toBe(true);
      const t0 = Date.now();
      expect((await admin.call('PUT', '/admin/flags/ff.ai.explain', { enabled: false })).status).toBe(200);
      const off = await u.api.call('POST', '/ai/explain', { question_version_id: qv, chosen_option: 'A' });
      const effectMs = Date.now() - t0;
      expect(off.status).toBe(503);
      expect(off.body.error).toMatchObject({ code: 'feature_disabled', details: { flag: 'ff.ai.explain', message_key: 'errors.feature_disabled' } });
      expect(off.headers['retry-after']).toBe('60');
      expect(effectMs).toBeLessThan(60_000);
      let replicaOff = false;
      for (let i = 0; i < 20 && !replicaOff; i++) {
        replicaOff = !(await replica.isEnabled('ff.ai.explain', { userId: u.id }));
        if (!replicaOff) await new Promise((r) => setTimeout(r, 100));
      }
      expect(replicaOff).toBe(true);
      expect((await inject({ method: 'GET', url: '/flags' })).json().flags['ff.ai.explain']).toBe(false);
      expect((await admin.call('PUT', '/admin/flags/ff.ai.tutor', { enabled: false })).status).toBe(200);
      expect((await u.api.call('POST', '/ai/threads', { title: 'kill-switch' })).status).toBe(503);
      expect((await admin.call('PUT', '/admin/flags/ff.ai.tutor', { enabled: true })).status).toBe(200);
      // ff.ai.diagnose (S12): guard chặn trước khi đọc attempt → 503 cả với id bất kỳ; bật lại → không còn 503 (404 attempt lạ)
      const anyAttempt = crypto.randomUUID();
      expect((await admin.call('PUT', '/admin/flags/ff.ai.diagnose', { enabled: false })).status).toBe(200);
      const diagOff = await u.api.call('POST', `/attempts/${anyAttempt}/diagnosis`);
      expect(diagOff.status).toBe(503);
      expect(diagOff.body.error).toMatchObject({ code: 'feature_disabled', details: { flag: 'ff.ai.diagnose' } });
      expect((await admin.call('PUT', '/admin/flags/ff.ai.diagnose', { enabled: true })).status).toBe(200);
      expect((await u.api.call('POST', `/attempts/${anyAttempt}/diagnosis`)).status).not.toBe(503);
      expect((await admin.call('PUT', '/admin/flags/ff.ai.explain', { enabled: true })).status).toBe(200);
      const on = await u.api.call('POST', '/ai/explain', { question_version_id: qv, chosen_option: 'A' });
      expect(on.status).toBe(200);
      await replica.onModuleDestroy();
    });
  });

  describe('partition', () => {
    it('ops.partition.ensure giữ ≥ 2 tháng tới cho mọi bảng partition; thiếu tháng được phát hiện (cảnh báo)', async () => {
      const now = await partitionCoverage(dbs.db, 2);
      for (const c of now) {
        expect(c.monthsAhead, c.table).toBeGreaterThanOrEqual(1);
      }
      const future = await partitionCoverage(dbs.db, 2, new Date(Date.now() + 400 * 86_400_000));
      expect(future.every((c) => c.missing.length > 0 && c.monthsAhead < 0)).toBe(true);
    });
  });
});
