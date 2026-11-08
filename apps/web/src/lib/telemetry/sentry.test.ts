import { describe, expect, it } from 'vitest';
import { ApiError } from '@allingo/api-client';
import { SentryClient, envelopeUrl, parseDsn, parseStack } from './sentry';
import { REDACTED, scrubDeep, scrubString, scrubUrl } from './scrub';
import { getPageTraceId, pageTraceparent, rotatePageTrace } from './trace';

/** Transport giả: ghi lại từng envelope (URL + các item đã parse) */
function fakeTransport() {
  const sent: Array<{ url: string; beacon: boolean; header: Record<string, unknown>; items: Array<{ type: string; payload: Record<string, unknown> }> }> = [];
  const transport = (url: string, body: string, opts: { beacon: boolean }) => {
    const lines = body.trim().split('\n');
    const items: Array<{ type: string; payload: Record<string, unknown> }> = [];
    for (let i = 1; i < lines.length; i += 2) items.push({ type: (JSON.parse(lines[i]!) as { type: string }).type, payload: JSON.parse(lines[i + 1]!) as Record<string, unknown> });
    sent.push({ url, beacon: opts.beacon, header: JSON.parse(lines[0]!) as Record<string, unknown>, items });
  };
  return { sent, transport };
}

const DSN = 'https://abc123@o1.ingest.sentry.io/42';
const client = (extra: Partial<ConstructorParameters<typeof SentryClient>[0]> = {}) => {
  const t = fakeTransport();
  let now = 1_700_000_000_000;
  const c = new SentryClient({ dsn: DSN, release: 'allingo-web@test', environment: 'test', transport: t.transport, now: () => (now += 1000), random: () => 0, ...extra });
  return { c, sent: t.sent };
};

describe('che PII trước khi gửi (S11)', () => {
  it('chuỗi: email, SĐT VN, JWT, Bearer, tham số bí mật trong URL', () => {
    const s = scrubString('user an.nguyen@example.com phone 0912 345 678 / +84912345678 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk Bearer abcdefghijklmnop https://x.vn/a?token=SECRET&ok=1');
    expect(s).not.toMatch(/an\.nguyen|0912 345 678|84912345678|eyJhbGci|abcdefghijklmnop|SECRET/);
    expect(s).toContain('[email]');
    expect(s).toContain('[phone]');
    expect(s).toContain('[jwt]');
    expect(s).toContain('Bearer [redacted]');
    expect(s).toContain('token=[redacted]&ok=1');
  });

  it('đối tượng: theo tên khoá ở mọi độ sâu, không sửa bản gốc, chịu vòng tham chiếu', () => {
    const src: Record<string, unknown> = { email: 'a@b.vn', nested: { password: 'p', guest_token: 't', ok: 'fine', list: [{ phone: '0912345678' }] }, note: 'nội dung ghi chú' };
    src.self = src;
    const out = scrubDeep<Record<string, unknown>>(src);
    expect(out.email).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).password).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).guest_token).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).ok).toBe('fine');
    expect(((out.nested as Record<string, unknown>).list as Array<Record<string, unknown>>)[0]!.phone).toBe(REDACTED);
    expect(out.note).toBe(REDACTED);
    expect(out.self).toBe('[circular]');
    expect(src.email).toBe('a@b.vn');
  });

  it('URL: bỏ query/hash, id → :id, mã giới thiệu → :code', () => {
    expect(scrubUrl('https://allingo.vn/vi/attempts/3f2b8c1e-1d2a-4b3c-8d4e-123456789abc/review?focus=x#y')).toBe('https://allingo.vn/vi/attempts/:id/review');
    expect(scrubUrl('/vi/notifications/manage?token=abc&unsubscribe=1')).toBe('/vi/notifications/manage');
    expect(scrubUrl('/vi/r/MINH2026')).toBe('/vi/r/:code');
    expect(scrubUrl('/vi/account/orders/1234567')).toBe('/vi/account/orders/:id');
  });
});

describe('Sentry envelope không SDK', () => {
  it('DSN → URL envelope xác thực qua query (dùng được sendBeacon); DSN sai → null', () => {
    const d = parseDsn(DSN)!;
    expect(d).toEqual({ publicKey: 'abc123', protocol: 'https', host: 'o1.ingest.sentry.io', pathPrefix: '', projectId: '42' });
    expect(envelopeUrl(d)).toBe('https://o1.ingest.sentry.io/api/42/envelope/?sentry_key=abc123&sentry_version=7&sentry_client=allingo.web%2F1.0.0');
    expect(parseDsn('https://o1.ingest.sentry.io/42')).toBeNull();
    expect(parseDsn('ftp://k@h/1')).toBeNull();
    expect(parseDsn('')).toBeNull();
    expect(() => new SentryClient({ dsn: 'nope', release: 'r', environment: 'e' })).toThrow();
  });

  it('lỗi: release/environment, trace_id của ApiError, mã lỗi, stack đã che, không lặp lại cùng lỗi', () => {
    const { c, sent } = client();
    const err = new ApiError(500, { error: { code: 'internal', message: 'boom for an@example.com', trace_id: '0af7651916cd43dd8448eb211c80319c' } });
    const id = c.captureException(err, { extra: { email: 'x@y.vn', count: 2 } });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(sent).toHaveLength(1);
    const ev = sent[0]!.items[0]!;
    expect(ev.type).toBe('event');
    expect(ev.payload.release).toBe('allingo-web@test');
    expect(ev.payload.environment).toBe('test');
    expect((ev.payload.tags as Record<string, string>).trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect((ev.payload.tags as Record<string, string>).error_code).toBe('internal');
    expect((ev.payload.contexts as { trace: { trace_id: string } }).trace.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(JSON.stringify(ev.payload)).not.toContain('an@example.com');
    expect(JSON.stringify(ev.payload)).not.toContain('x@y.vn');
    expect((ev.payload.extra as Record<string, unknown>).count).toBe(2);
    expect(sent[0]!.header.event_id).toBe(id);
    // cùng lỗi lần 2 trong lượt xem → không gửi
    expect(c.captureException(err)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('lỗi thường: trace_id của lượt xem (cùng traceparent request ghi); lấy mẫu 0 → không gửi', () => {
    rotatePageTrace('/vi/a');
    const { c, sent } = client({ getTraceId: getPageTraceId });
    c.captureException(new TypeError('x is undefined'));
    expect((sent[0]!.items[0]!.payload.tags as Record<string, string>).trace_id).toBe(getPageTraceId());
    expect(pageTraceparent()).toMatch(new RegExp(`^00-${getPageTraceId()}-[0-9a-f]{16}-01$`));
    const before = getPageTraceId();
    rotatePageTrace('/vi/a');
    expect(getPageTraceId()).toBe(before);
    rotatePageTrace('/vi/b');
    expect(getPageTraceId()).not.toBe(before);
    const sampled = client({ sampleRate: 0, random: () => 0.5 });
    expect(sampled.c.captureException(new Error('y'))).toBeNull();
    expect(sampled.sent).toHaveLength(0);
  });

  it('phiên (crash-free): init ok → errored → crashed → kết thúc gửi bằng beacon', () => {
    const { c, sent } = client();
    c.startSession();
    c.captureException(new Error('handled'));
    c.captureException(new Error('boom'), { handled: false });
    c.endSession();
    const sessions = sent.flatMap((s) => s.items.filter((i) => i.type === 'session').map((i) => ({ ...(i.payload as { status: string; init: boolean; errors: number; attrs: Record<string, string> }), beacon: s.beacon })));
    expect(sessions.map((s) => [s.status, s.init, s.errors])).toEqual([
      ['ok', true, 0],
      ['errored', false, 1],
      ['crashed', false, 2],
      ['crashed', false, 2],
    ]);
    expect(sessions.at(-1)!.beacon).toBe(true);
    expect(sessions[0]!.attrs.release).toBe('allingo-web@test');
    const ex = sent.find((s) => s.items[0]!.type === 'event' && JSON.stringify(s.items[0]!.payload).includes('boom'))!;
    expect(((ex.items[0]!.payload.exception as { values: Array<{ mechanism: { handled: boolean } }> }).values[0]!.mechanism.handled)).toBe(false);
  });

  it('phiên không lỗi → exited', () => {
    const { c, sent } = client();
    c.startSession();
    c.endSession();
    c.endSession();
    expect(sent.map((s) => s.items[0]!.payload.status)).toEqual(['ok', 'exited']);
  });

  it('Web Vitals: gom theo route, gửi transaction có measurements khi đổi route / rời trang', () => {
    const { c, sent } = client();
    c.setRoute('/vi/toeic/dashboard');
    c.recordVital({ name: 'LCP', value: 812.4 });
    c.recordVital({ name: 'CLS', value: 0.01234 });
    c.recordVital({ name: 'INP', value: 64 });
    c.recordVital({ name: 'BOGUS', value: 1 });
    c.setRoute('/vi/attempts/3f2b8c1e-1d2a-4b3c-8d4e-123456789abc');
    expect(sent).toHaveLength(1);
    const tx = sent[0]!.items[0]!;
    expect(tx.type).toBe('transaction');
    expect(tx.payload.transaction).toBe('/vi/toeic/dashboard');
    expect(tx.payload.measurements).toEqual({ lcp: { value: 812, unit: 'millisecond' }, cls: { value: 0.0123, unit: '' }, inp: { value: 64, unit: 'millisecond' } });
    c.recordVital({ name: 'TTFB', value: 120 });
    c.endSession();
    const last = sent.at(-1)!;
    expect(last.beacon).toBe(true);
    expect(last.items[0]!.payload.transaction).toBe('/vi/attempts/:id');
    // không có số đo → không gửi transaction rỗng
    const n = sent.length;
    c.flushVitals(false);
    expect(sent).toHaveLength(n);
  });

  it('stack V8/Firefox → khung (cũ → mới), URL đã che', () => {
    const frames = parseStack('Error: x\n    at render (http://localhost:3000/_next/static/chunks/abc.js?token=1:10:5)\n    at http://localhost:3000/vi/attempts/3f2b8c1e-1d2a-4b3c-8d4e-123456789abc:1:2\nfoo@http://localhost:3000/_next/static/chunks/def.js:3:4');
    expect(frames.map((f) => [f.function, f.filename, f.lineno])).toEqual([
      ['foo', 'http://localhost:3000/_next/static/chunks/def.js', 3],
      [undefined, 'http://localhost:3000/vi/attempts/:id', 1],
      ['render', 'http://localhost:3000/_next/static/chunks/abc.js', 10],
    ]);
  });
});
