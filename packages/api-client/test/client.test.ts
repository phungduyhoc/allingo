import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, postJsonOrSse, readSse, unwrap } from '../src/index.js';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

describe('ApiError / unwrap', () => {
  it('đọc envelope lỗi chuẩn { error: { code, message, trace_id } }', () => {
    const e = new ApiError(402, { error: { code: 'insufficient_credits', message: 'Not enough', trace_id: 't-1', details: { required: 1 } } });
    expect(e.status).toBe(402);
    expect(e.code).toBe('insufficient_credits');
    expect(e.message).toBe('Not enough');
    expect(e.traceId).toBe('t-1');
    expect(e.details).toEqual({ required: 1 });
  });

  it('suy ra mã lỗi theo HTTP status khi body rỗng', () => {
    expect(new ApiError(401, undefined).code).toBe('unauthorized');
    expect(new ApiError(403, undefined).code).toBe('forbidden');
    expect(new ApiError(404, undefined).code).toBe('not_found');
    expect(new ApiError(500, undefined).code).toBe('internal');
  });

  it('unwrap ném ApiError khi response không ok', () => {
    expect(() => unwrap({ error: { error: { code: 'x', message: 'y' } }, response: json(400, {}) })).toThrow(ApiError);
    expect(unwrap({ data: { ok: true }, response: json(200, {}) })).toEqual({ ok: true });
  });
});

describe('readSse', () => {
  it('ghép sự kiện bị cắt giữa chunk và parse JSON data', async () => {
    const r = sse(['event: start\ndata: {"a":1}\n\nevent: del', 'ta\ndata: {"text":"xin "}\n\nevent: delta\ndata: {"text":"chào"}\n\nevent: done\ndata: {}\n\n']);
    const events = [];
    for await (const ev of readSse(r)) events.push(ev);
    expect(events.map((e) => e.event)).toEqual(['start', 'delta', 'delta', 'done']);
    expect(events[1]?.data).toEqual({ text: 'xin ' });
  });

  it('giữ chuỗi thô khi data không phải JSON, bỏ qua chunk không có data', async () => {
    const r = sse(['event: ping\n\nevent: raw\ndata: hello\n\n']);
    const events = [];
    for await (const ev of readSse(r)) events.push(ev);
    expect(events).toEqual([{ event: 'raw', data: 'hello' }]);
  });
});

describe('postJsonOrSse', () => {
  it('trả kind=json khi cache hit, kind=sse khi stream, ném ApiError khi lỗi', async () => {
    const calls: RequestInit[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      const body = JSON.parse(init?.body as string) as { v: number };
      if (body.v === 1) return json(200, { cached: true });
      if (body.v === 2) return sse(['event: result\ndata: {"ok":true}\n\n']);
      return json(403, { error: { code: 'exam_mode_locked', message: 'locked' } });
    }) as unknown as typeof fetch;

    const a = await postJsonOrSse('http://api', '/ai/explain', { v: 1 }, { fetch: fetchMock });
    expect(a.kind).toBe('json');
    expect(calls[0]?.credentials).toBe('include');
    expect((calls[0]?.headers as Record<string, string>).Accept).toContain('text/event-stream');

    const b = await postJsonOrSse('http://api', '/ai/explain', { v: 2 }, { fetch: fetchMock });
    expect(b.kind).toBe('sse');
    if (b.kind === 'sse') {
      const evs = [];
      for await (const ev of b.events) evs.push(ev);
      expect(evs[0]).toEqual({ event: 'result', data: { ok: true } });
    }

    await expect(postJsonOrSse('http://api', '/ai/explain', { v: 3 }, { fetch: fetchMock })).rejects.toMatchObject({ status: 403, code: 'exam_mode_locked' });
  });
});

describe('createApiClient', () => {
  it('bearer mode: gắn Authorization, refresh 1 lần khi 401 rồi gọi lại', async () => {
    let access = 'old';
    const store = {
      getAccessToken: () => access,
      getRefreshToken: () => 'rt-1',
      setTokens: (t: { access_token: string } | null) => {
        access = t?.access_token ?? '';
      },
    };
    const seen: { url: string; auth: string | null; body: string | null }[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const auth = req.headers.get('authorization');
      seen.push({ url: req.url, auth, body: req.method === 'POST' ? await req.text() : null });
      if (req.url.endsWith('/auth/refresh')) return json(200, { access_token: 'new', refresh_token: 'rt-2', expires_in: 900 });
      if (auth === 'Bearer new') return json(200, { id: 'u1' });
      return json(401, { error: { code: 'unauthorized', message: 'expired' } });
    }) as unknown as typeof fetch;

    const client = createApiClient({ baseUrl: 'http://api', mode: 'bearer', tokenStore: store, fetch: fetchMock });
    const res = await client.GET('/me');
    expect(res.response.status).toBe(200);
    expect(res.data).toEqual({ id: 'u1' });
    expect(seen.map((s) => s.auth)).toEqual(['Bearer old', null, 'Bearer new']);
    expect(seen[1]?.url).toBe('http://api/auth/refresh');
    expect(JSON.parse(seen[1]?.body ?? '{}')).toEqual({ refresh_token: 'rt-1' });
    expect(access).toBe('new');
  });

  it('cookie mode: gọi onUnauthorized khi refresh thất bại, không retry', async () => {
    const onUnauthorized = vi.fn();
    let n = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      n++;
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/auth/refresh')) return json(401, { error: { code: 'unauthorized', message: 'no cookie' } });
      return json(401, { error: { code: 'unauthorized', message: 'expired' } });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://api', fetch: fetchMock, onUnauthorized });
    const res = await client.GET('/me');
    expect(res.response.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(n).toBe(2);
  });
});
