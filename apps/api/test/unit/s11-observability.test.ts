import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { classifySql, instrumentSql, type QueryInfo } from '@allingo/db';
import { buildLoggerOptions } from '../../src/shared/telemetry/logger.js';
import { redactDeep, redactString, REDACTED } from '../../src/shared/telemetry/redact.js';
import { parseDsn, SentryReporter, type SentryTransport } from '../../src/shared/telemetry/error-reporter.js';
import { MetricsRegistry } from '../../src/shared/telemetry/metrics.js';
import { outgoingTraceparent, parseTraceparent, runWithContext, currentTraceId } from '../../src/shared/telemetry/request-context.js';
import { backpressureDecision } from '../../src/worker/worker.runner.js';

// Giá trị PII/bí mật mẫu – không được xuất hiện trong log/sự kiện
const EMAIL = 'nguyen.van.a+test@example.com';
const PHONE = '0912345678';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWZha2UtMTIzNDU2';
const OTP = '482913';
const TAX = '0312345678-001';
const COOKIE = 'allingo_at=abcdef0123456789; allingo_rt=zyxwvu9876543210';
const SECRETS = [EMAIL, PHONE, JWT, OTP, TAX, 'abcdef0123456789', 'zyxwvu9876543210', 'Sup3r$ecret!'];

function capture(): { logger: pino.Logger; lines: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const logger = pino(buildLoggerOptions({ LOG_LEVEL: 'trace', APP_ENV: 'test' }), stream);
  return { logger, lines: () => chunks.join('') };
}

describe('S11 – log redaction (pino)', () => {
  it('không lộ email/phone/token/cookie/authorization/otp/tax_code ở mọi độ sâu, trong message và lỗi', () => {
    const { logger, lines } = capture();
    logger.info({ email: EMAIL, phone: PHONE, otp: OTP, tax_code: TAX, password: 'Sup3r$ecret!' }, 'flat');
    logger.info({ req: { headers: { authorization: `Bearer ${JWT}`, cookie: COOKIE, 'x-internal-token': 'abcdef0123456789' } } }, 'headers');
    logger.info({ user: { profile: { contact: { email: EMAIL, phoneNumber: PHONE } } }, buyer: { buyer_tax_code: TAX } }, 'nested');
    logger.info(`người dùng ${EMAIL} gọi ${PHONE} với token ${JWT}`);
    logger.warn({ url: `/v1/auth/callback?code=${OTP}&state=x`, refresh_token: 'zyxwvu9876543210' }, 'query');
    logger.error({ err: new Error(`SMTP từ chối ${EMAIL}`) }, 'error');
    logger.info({ list: [{ email: EMAIL }, { access_token: JWT }] }, 'array');
    const out = lines();
    for (const s of SECRETS) expect(out, `lộ ${s}`).not.toContain(s);
    expect(out).toContain(REDACTED);
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[jwt]');
    // Trường không nhạy cảm giữ nguyên (code lỗi, status, route)
    logger.info({ code: 'rate_limited', status: 429, route: '/v1/attempts/:attemptId/answers' }, 'ok');
    expect(lines()).toContain('rate_limited');
    expect(lines()).toContain('/v1/attempts/:attemptId/answers');
  });

  it('trace_id của ngữ cảnh request vào mọi dòng log (mixin)', () => {
    const { logger, lines } = capture();
    runWithContext({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true }, () => logger.info('in-request'));
    const line = JSON.parse(lines().trim().split('\n').at(-1)!);
    expect(line.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(line.span_id).toBe('00f067aa0ba902b7');
  });

  it('redactDeep: không sửa đối tượng gốc, chịu vòng tham chiếu, Buffer, giữ id/số', () => {
    const o: Record<string, unknown> = { id: 'u1', email: EMAIL, n: 3, buf: Buffer.from('xyz') };
    o.self = o;
    const r = redactDeep<Record<string, unknown>>(o);
    expect(o.email).toBe(EMAIL);
    expect(r).toMatchObject({ id: 'u1', email: REDACTED, n: 3, buf: '[buffer 3B]', self: '[circular]' });
  });

  it('redactString: email, số VN (+84/0), JWT, Bearer, tham số bí mật trong URL', () => {
    expect(redactString(`liên hệ ${EMAIL}`)).toBe('liên hệ [email]');
    expect(redactString('gọi +84 912 345 678 hoặc 0912.345.678')).toBe('gọi [phone] hoặc [phone]');
    expect(redactString(`Authorization: Bearer abcdefghijklmnop`)).toBe('Authorization: Bearer [redacted]');
    expect(redactString(`/cb?vnp_SecureHash=deadbeefcafe&x=1`)).toBe('/cb?vnp_SecureHash=[redacted]&x=1');
    expect(redactString('attempt 7d9f1c2e-1111-4222-8333-944455556666 điểm 495')).toBe('attempt 7d9f1c2e-1111-4222-8333-944455556666 điểm 495');
  });
});

describe('S11 – metrics registry', () => {
  it('histogram RED theo route render đúng định dạng + collector chạy trước render, collector lỗi không chặn', async () => {
    const reg = new MetricsRegistry();
    const h = reg.histogram('http_server_request_duration_seconds', 'test', ['method', 'route', 'status'], [0.1, 0.2]);
    h.observe({ method: 'PUT', route: '/v1/attempts/:attemptId/answers', status: '204' }, 0.15);
    const g = reg.gauge('bullmq_queue_jobs', 'test', ['queue', 'state']);
    reg.registerCollector('q', () => g.set({ queue: 'grading', state: 'waiting' }, 7));
    reg.registerCollector('bad', () => {
      throw new Error('boom');
    });
    const text = await reg.collectAndRender(200);
    expect(text).toContain('http_server_request_duration_seconds_bucket{method="PUT",route="/v1/attempts/:attemptId/answers",status="204",le="0.1"} 0');
    expect(text).toContain('http_server_request_duration_seconds_bucket{method="PUT",route="/v1/attempts/:attemptId/answers",status="204",le="0.2"} 1');
    expect(text).toContain('bullmq_queue_jobs{queue="grading",state="waiting"} 7');
  });

  it('classifySql: op + bảng chính (nhãn cardinality thấp)', () => {
    expect(classifySql('select "id" from "learn"."attempts" where "id" = $1')).toEqual({ op: 'select', table: 'learn.attempts' });
    expect(classifySql('insert into "learn"."attempt_answers" ("a") values ($1)')).toEqual({ op: 'insert', table: 'learn.attempt_answers' });
    expect(classifySql('update "billing"."orders" set "status" = $1')).toEqual({ op: 'update', table: 'billing.orders' });
    expect(classifySql('VACUUM')).toEqual({ op: 'other', table: '-' });
  });

  it('instrumentSql: đo unsafe(), tagged template, transaction con (begin) – không đổi kết quả', async () => {
    const seen: QueryInfo[] = [];
    const mk = (tag: string) => {
      const q = (strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve([{ tag, text: strings.join('?') }]);
      return Object.assign(q, {
        unsafe: (text: string) => {
          const p = Promise.resolve([{ tag, text }]) as Promise<unknown[]> & { values: () => Promise<unknown[]> };
          p.values = () => p;
          return p;
        },
        begin: async (cb: (tx: unknown) => Promise<unknown>) => cb(mk('tx')),
        options: { max: 3 },
      });
    };
    const client = instrumentSql(mk('root'), (q) => seen.push(q));
    expect(await client.unsafe('select 1').values()).toEqual([{ tag: 'root', text: 'select 1' }]);
    expect(await client`select ${1}`).toEqual([{ tag: 'root', text: 'select ?' }]);
    const inner = await client.begin(async (tx) => (tx as typeof client).unsafe('update x set y = 1'));
    expect(inner).toEqual([{ tag: 'tx', text: 'update x set y = 1' }]);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen.map((s) => s.sql)).toEqual(['select 1', 'select $?', 'update x set y = 1']);
    expect(seen.every((s) => s.ok && s.ms >= 0)).toBe(true);
    expect(client.options.max).toBe(3);
  });
});

describe('S11 – trace context', () => {
  it('parseTraceparent hợp lệ / không hợp lệ', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true });
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
  });

  it('outgoingTraceparent lấy trace của ngữ cảnh (job BullMQ nối với request)', () => {
    expect(outgoingTraceparent(() => 'aaaaaaaaaaaaaaaa')).toBeNull();
    const tp = runWithContext({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: null, sampled: true }, () => outgoingTraceparent(() => 'aaaaaaaaaaaaaaaa'));
    expect(tp).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-aaaaaaaaaaaaaaaa-01');
    expect(runWithContext({ traceId: 'abc123abc123abc123abc123abc123ab', spanId: 'bbbbbbbbbbbbbbbb', sampled: false }, () => currentTraceId())).toBe('abc123abc123abc123abc123abc123ab');
  });
});

describe('S11 – Sentry adapter (transport giả)', () => {
  it('parseDsn', () => {
    expect(parseDsn('https://pubkey123@o1.ingest.sentry.io/4507')).toEqual({ publicKey: 'pubkey123', host: 'o1.ingest.sentry.io', protocol: 'https', projectId: '4507', pathPrefix: '' });
    expect(parseDsn('https://k@sentry.allingo.vn/self/12')).toMatchObject({ pathPrefix: '/self', projectId: '12' });
    expect(parseDsn('not a dsn')).toBeNull();
    expect(parseDsn('https://o1.ingest.sentry.io/4507')).toBeNull();
  });

  it('tắt khi không có DSN; bật → envelope có release/environment/trace_id, PII đã che', async () => {
    expect(new SentryReporter({ environment: 'test', release: 'r1', service: 'api' }).capture(new Error('x'))).toBeNull();
    const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const transport: SentryTransport = async (url, init) => {
      sent.push({ url, headers: init.headers, body: init.body });
      return { status: 200 };
    };
    const r = new SentryReporter({ dsn: 'https://pubkey123@o1.ingest.sentry.io/4507', environment: 'staging', release: 'allingo@abc1234', service: 'allingo-api', transport });
    const id = runWithContext({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true }, () =>
      r.capture(Object.assign(new Error(`payment failed for ${EMAIL} token ${JWT}`), { code: 'payment_failed' }), { tags: { queue: 'grading', note: `phone ${PHONE}` }, extra: { email: EMAIL, otp: OTP, order_id: 'o-1' }, request: { method: 'POST', route: '/v1/orders/:orderId/pay', status: 500 } }),
    );
    await r.flush();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://o1.ingest.sentry.io/api/4507/envelope/');
    expect(sent[0]!.headers['x-sentry-auth']).toContain('sentry_key=pubkey123');
    const [, , evLine] = sent[0]!.body.trim().split('\n');
    const ev = JSON.parse(evLine!);
    expect(ev).toMatchObject({ release: 'allingo@abc1234', environment: 'staging', level: 'error', tags: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', service: 'allingo-api', route: '/v1/orders/:orderId/pay', error_code: 'payment_failed', queue: 'grading' } });
    expect(ev.contexts.trace.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ev.extra).toEqual({ email: REDACTED, otp: REDACTED, order_id: 'o-1' });
    for (const s of SECRETS) expect(sent[0]!.body, `lộ ${s}`).not.toContain(s);
    expect(ev.exception.values[0].value).toContain('[email]');
    expect(ev.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  });

  it('transport lỗi không ném ra ngoài', async () => {
    const r = new SentryReporter({ dsn: 'https://k@h.example/1', environment: 'test', release: 'r', service: 's', transport: async () => Promise.reject(new Error('net down')) });
    expect(r.capture(new Error('x'))).not.toBeNull();
    await expect(r.flush(500)).resolves.toBeUndefined();
  });
});

describe('S11 – backpressure hàng đợi', () => {
  it('dừng khi grading ≥ ngưỡng, chạy lại khi ≤ ngưỡng/2 (trễ chống dao động)', () => {
    expect(backpressureDecision(false, 199, 200)).toBe(false);
    expect(backpressureDecision(false, 200, 200)).toBe(true);
    expect(backpressureDecision(true, 150, 200)).toBe(true);
    expect(backpressureDecision(true, 100, 200)).toBe(false);
  });
});

describe('S11 – exception filter → Sentry (5xx không chủ đích), envelope không lộ chi tiết', () => {
  it('lỗi 500: envelope internal + trace_id, báo Sentry (đã che), AppError 503 không báo', async () => {
    const { AppExceptionFilter } = await import('../../src/shared/http/exception.filter.js');
    const { setErrorReporter } = await import('../../src/shared/telemetry/error-reporter.js');
    const { FeatureDisabled } = await import('../../src/shared/http/errors.js');
    const sent: string[] = [];
    setErrorReporter(new SentryReporter({ dsn: 'https://k@sentry.example/9', environment: 'test', release: 'r', service: 'allingo-api', transport: async (_u, init) => (sent.push(init.body), { status: 200 }) }));
    const run = (exception: unknown) => {
      const out: { status?: number; headers: Record<string, string>; body?: { error: { code: string; message: string; trace_id?: string; details?: Record<string, unknown> } } } = { headers: {} };
      const reply = {
        status(s: number) {
          out.status = s;
          return reply;
        },
        header(k: string, v: string) {
          out.headers[k] = v;
          return reply;
        },
        send(b: typeof out.body) {
          out.body = b;
          return reply;
        },
      };
      const req = { method: 'POST', url: '/v1/orders/x/pay?token=abc', traceId: 'abcdabcdabcdabcdabcdabcdabcdabcd', routeOptions: { url: '/v1/orders/:orderId/pay' } };
      new AppExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => req }) } as never);
      return out;
    };
    const r = run(new Error(`DB down for ${EMAIL}`));
    expect(r.status).toBe(500);
    expect(r.body?.error).toEqual({ code: 'internal', message: 'Internal server error', trace_id: 'abcdabcdabcdabcdabcdabcdabcdabcd' });
    await new Promise((res) => setTimeout(res, 10));
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(EMAIL);
    expect(sent[0]).toContain('/v1/orders/:orderId/pay');
    const d = run(new FeatureDisabled('ff.ai.explain'));
    expect(d.status).toBe(503);
    expect(d.headers['retry-after']).toBe('60');
    expect(d.body?.error.details).toMatchObject({ flag: 'ff.ai.explain', message_key: 'errors.feature_disabled' });
    await new Promise((res) => setTimeout(res, 10));
    expect(sent).toHaveLength(1);
    setErrorReporter({ enabled: false, capture: () => null, flush: async () => undefined });
  });
});
