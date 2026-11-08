import { newSpanId, newTraceId, randomHex, traceparent } from './sentry-ids';
import { scrubDeep, scrubString, scrubUrl } from './scrub';

/**
 * Sentry cho web KHÔNG dùng SDK (S11, như `apps/api/src/shared/telemetry/error-reporter.ts`): gửi Envelope HTTP (`/api/<project>/
 * envelope/?sentry_key=…` – xác thực qua query nên dùng được `sendBeacon` khi rời trang). Bật khi có `NEXT_PUBLIC_SENTRY_DSN`.
 *  - Lỗi: exception + stack (đã che PII), tag `trace_id` (API `error.trace_id` nếu là ApiError, không thì trace của lượt xem trang
 *    – cùng trace với header `traceparent` web gửi cho request ghi), `release`, `environment`, URL đã bỏ query/id.
 *  - Release health: phiên (session) mỗi lượt tải trang – `ok` → `errored` (lỗi đã bắt) / `crashed` (lỗi không bắt được) → `exited`
 *    khi rời trang ⇒ crash-free sessions cho S12.
 *  - Web Vitals RUM: LCP/INP/CLS/FCP/TTFB gom theo lượt xem, gửi một sự kiện `transaction` (op `pageload`, `measurements`) khi trang
 *    ẩn/đổi route. Không gửi body request, không user id/email (chỉ id ẩn danh của phiên Sentry).
 */

export interface ParsedDsn {
  publicKey: string;
  protocol: string;
  host: string;
  pathPrefix: string;
  projectId: string;
}

export function parseDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split('/').filter(Boolean);
    const projectId = parts.pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId) || !/^https?:$/.test(u.protocol)) return null;
    return { publicKey: u.username, protocol: u.protocol.replace(':', ''), host: u.host, pathPrefix: parts.length ? `/${parts.join('/')}` : '', projectId };
  } catch {
    return null;
  }
}

export const SDK_NAME = 'allingo.web';
export const SDK_VERSION = '1.0.0';

export function envelopeUrl(d: ParsedDsn): string {
  return `${d.protocol}://${d.host}${d.pathPrefix}/api/${d.projectId}/envelope/?sentry_key=${encodeURIComponent(d.publicKey)}&sentry_version=7&sentry_client=${SDK_NAME}%2F${SDK_VERSION}`;
}

export type SentryTransport = (url: string, body: string, opts: { beacon: boolean }) => void | Promise<unknown>;

/** Mặc định: `sendBeacon` khi rời trang (không bị huỷ), còn lại `fetch keepalive` (không cookie) */
export const defaultTransport: SentryTransport = (url, body, { beacon }) => {
  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    if (navigator.sendBeacon(url, body)) return;
  }
  return fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => undefined);
};

const hex = randomHex;
export { newSpanId, newTraceId, traceparent };

interface Frame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** Stack V8 (`at fn (url:line:col)`) và Firefox/Safari (`fn@url:line:col`) → khung Sentry (cũ → mới) */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const line of stack.split('\n').slice(0, 50)) {
    const v8 = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    const gecko = v8 ? null : /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line);
    const m = v8 ?? gecko;
    if (!m) continue;
    const filename = scrubUrl(m[2]!);
    out.push({ function: m[1] || undefined, filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !/node_modules|\/_next\/static\/chunks\/(?:framework|turbopack)/.test(filename) });
  }
  return out.reverse();
}

export interface CaptureContext {
  level?: 'fatal' | 'error' | 'warning';
  /** Lỗi không được bắt (window.onerror / unhandledrejection) → phiên `crashed` */
  handled?: boolean;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

export interface SentryClientOptions {
  dsn: string;
  release: string;
  environment: string;
  /** 0–1, lấy mẫu sự kiện lỗi (mặc định 1) */
  sampleRate?: number;
  /** 0–1, lấy mẫu Web Vitals (mặc định 1) */
  vitalsSampleRate?: number;
  transport?: SentryTransport;
  /** Trace của lượt xem do `trace.ts` quản lý (dùng chung với header `traceparent`); không có → client tự sinh */
  getTraceId?: () => string;
  /** Giờ (test) */
  now?: () => number;
  random?: () => number;
}

export interface VitalMetric {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
}

const VITAL_UNITS: Record<string, string> = { LCP: 'millisecond', FCP: 'millisecond', INP: 'millisecond', TTFB: 'millisecond', FID: 'millisecond', CLS: '' };

/** Thuộc tính ApiError (không import @allingo/api-client để module nhẹ) */
function apiErrorInfo(err: unknown): { code?: string; status?: number; traceId?: string } {
  if (!err || typeof err !== 'object') return {};
  const e = err as { name?: unknown; code?: unknown; status?: unknown; traceId?: unknown };
  if (e.name !== 'ApiError') return {};
  return { code: typeof e.code === 'string' ? e.code : undefined, status: typeof e.status === 'number' ? e.status : undefined, traceId: typeof e.traceId === 'string' ? e.traceId : undefined };
}

export class SentryClient {
  readonly dsn: ParsedDsn;
  private readonly url: string;
  private readonly transport: SentryTransport;
  private readonly now: () => number;
  private readonly random: () => number;
  private ownTraceId = newTraceId();
  private route = '/';
  private session: { sid: string; started: number; errors: number; status: 'ok' | 'errored' | 'crashed'; sent: boolean } | null = null;
  private vitals = new Map<string, number>();
  private vitalsSampled: boolean;
  private seen = new Set<string>();

  constructor(private readonly opts: SentryClientOptions) {
    const d = parseDsn(opts.dsn);
    if (!d) throw new Error('invalid Sentry DSN');
    this.dsn = d;
    this.url = envelopeUrl(d);
    this.transport = opts.transport ?? defaultTransport;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.vitalsSampled = this.random() < (opts.vitalsSampleRate ?? 1);
  }

  /** Trace của lượt xem hiện tại (header `traceparent` cho request ghi dùng cùng trace) */
  get traceId(): string {
    return this.opts.getTraceId?.() ?? this.ownTraceId;
  }

  /** Đổi route (client navigation): gửi Web Vitals của lượt xem cũ (trace mới do `trace.ts` xoay vòng) */
  setRoute(pathname: string): void {
    const next = scrubUrl(pathname);
    if (next === this.route) return;
    this.flushVitals(false);
    this.route = next;
    if (!this.opts.getTraceId) this.ownTraceId = newTraceId();
  }

  private header(eventId?: string): string {
    const d = this.dsn;
    return JSON.stringify({ ...(eventId ? { event_id: eventId } : {}), sent_at: new Date(this.now()).toISOString(), dsn: `${d.protocol}://${d.publicKey}@${d.host}${d.pathPrefix}/${d.projectId}`, sdk: { name: SDK_NAME, version: SDK_VERSION } });
  }

  private send(items: Array<{ type: string; payload: unknown }>, eventId: string | undefined, beacon: boolean): void {
    const body = [this.header(eventId), ...items.flatMap((i) => [JSON.stringify({ type: i.type }), JSON.stringify(i.payload)])].join('\n') + '\n';
    try {
      void this.transport(this.url, body, { beacon });
    } catch {
      /* không để lỗi báo cáo làm hỏng trang */
    }
  }

  private baseContext(): Record<string, unknown> {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
    return {
      platform: 'javascript',
      release: this.opts.release,
      environment: this.opts.environment,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      request: { url: typeof location !== 'undefined' ? scrubUrl(location.href) : this.route, headers: ua ? { 'User-Agent': ua } : undefined },
    };
  }

  /** Dựng sự kiện lỗi đã che PII (public để test) */
  buildErrorEvent(err: unknown, ctx: CaptureContext = {}): Record<string, unknown> {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
    const api = apiErrorInfo(err);
    const traceId = api.traceId && /^[0-9a-f]{32}$/.test(api.traceId) ? api.traceId : this.traceId;
    const tags: Record<string, string> = { route: this.route, trace_id: traceId };
    if (api.code) tags.error_code = api.code;
    if (api.status) tags.status = String(api.status);
    if (api.traceId) tags.api_trace_id = scrubString(api.traceId).slice(0, 64);
    for (const [k, v] of Object.entries(ctx.tags ?? {})) if (v !== undefined && v !== null) tags[k] = scrubString(String(v)).slice(0, 200);
    return {
      event_id: hex(16),
      timestamp: this.now() / 1000,
      level: ctx.level ?? 'error',
      ...this.baseContext(),
      transaction: this.route,
      tags,
      contexts: { trace: { trace_id: traceId, span_id: newSpanId(), op: 'pageload' } },
      extra: scrubDeep(ctx.extra ?? {}),
      exception: {
        values: [
          {
            type: e.name || 'Error',
            value: scrubString(e.message ?? ''),
            mechanism: { type: ctx.handled === false ? 'onerror' : 'generic', handled: ctx.handled !== false },
            stacktrace: { frames: parseStack(e.stack ? scrubString(e.stack) : undefined) },
          },
        ],
      },
    };
  }

  /** Báo lỗi; trả event_id hoặc null (bị lấy mẫu bỏ / trùng lặp trong lượt xem) */
  captureException(err: unknown, ctx: CaptureContext = {}): string | null {
    this.trackSessionError(ctx.handled === false);
    const event = this.buildErrorEvent(err, ctx);
    const values = (event.exception as { values: Array<{ type: string; value: string; stacktrace: { frames: Frame[] } }> }).values[0]!;
    // Cùng lỗi lặp lại (vòng render, interval) chỉ gửi một lần mỗi lượt xem
    const key = `${values.type}:${values.value}:${values.stacktrace.frames.at(-1)?.filename ?? ''}:${values.stacktrace.frames.at(-1)?.lineno ?? ''}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    if (this.random() >= (this.opts.sampleRate ?? 1)) return null;
    this.send([{ type: 'event', payload: event }], event.event_id as string, false);
    return event.event_id as string;
  }

  // -------------------------------------------------------------------- phiên (crash-free)

  startSession(): void {
    if (this.session) return;
    this.session = { sid: hex(16), started: this.now(), errors: 0, status: 'ok', sent: false };
    this.sendSession(true, false);
  }

  private trackSessionError(crashed: boolean): void {
    const s = this.session;
    if (!s) return;
    s.errors += 1;
    const before = s.status;
    if (crashed) s.status = 'crashed';
    else if (s.status === 'ok') s.status = 'errored';
    if (s.status !== before) this.sendSession(false, false);
  }

  private sendSession(init: boolean, end: boolean): void {
    const s = this.session;
    if (!s) return;
    const status = end && s.status === 'ok' ? 'exited' : s.status;
    this.send(
      [
        {
          type: 'session',
          payload: {
            sid: s.sid,
            init,
            started: new Date(s.started).toISOString(),
            timestamp: new Date(this.now()).toISOString(),
            status,
            errors: s.errors,
            duration: Math.max(0, (this.now() - s.started) / 1000),
            attrs: { release: this.opts.release, environment: this.opts.environment, ...(typeof navigator !== 'undefined' ? { user_agent: navigator.userAgent } : {}) },
          },
        },
      ],
      undefined,
      end,
    );
  }

  /** Rời trang: đóng phiên (exited nếu không lỗi) + gửi Web Vitals còn lại – qua sendBeacon */
  endSession(): void {
    this.flushVitals(true);
    if (this.session && !this.session.sent) {
      this.sendSession(false, true);
      this.session.sent = true;
    }
  }

  // -------------------------------------------------------------------- Web Vitals

  recordVital(m: VitalMetric): void {
    if (!this.vitalsSampled || !(m.name in VITAL_UNITS) || !Number.isFinite(m.value)) return;
    this.vitals.set(m.name, m.value);
  }

  /** Dựng sự kiện transaction chứa measurements (public để test); không có số đo → null */
  buildVitalsEvent(): Record<string, unknown> | null {
    if (!this.vitals.size) return null;
    const measurements: Record<string, { value: number; unit: string }> = {};
    for (const [k, v] of this.vitals) measurements[k.toLowerCase()] = { value: k === 'CLS' ? Number(v.toFixed(4)) : Math.round(v), unit: VITAL_UNITS[k]! };
    const end = this.now() / 1000;
    const start = (typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin : this.now()) / 1000;
    return {
      event_id: hex(16),
      type: 'transaction',
      ...this.baseContext(),
      transaction: this.route,
      transaction_info: { source: 'route' },
      start_timestamp: Math.min(start, end),
      timestamp: end,
      tags: { route: this.route },
      contexts: { trace: { trace_id: this.traceId, span_id: newSpanId(), op: 'pageload', status: 'ok' } },
      measurements,
      spans: [],
    };
  }

  flushVitals(beacon: boolean): void {
    const ev = this.buildVitalsEvent();
    this.vitals.clear();
    if (ev) this.send([{ type: 'transaction', payload: ev }], ev.event_id as string, beacon);
  }
}
