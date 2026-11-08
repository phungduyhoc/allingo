import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { getLogger } from './logger.js';
import { redactDeep, redactString } from './redact.js';
import { currentContext, currentTraceId } from './request-context.js';

/**
 * Báo lỗi (S11): adapter Sentry tối giản qua Envelope HTTP API – không thêm SDK (`@sentry/node` 9+ tự dựng OTel riêng,
 * xung đột NodeSDK của ADR-0015/0026). Bật khi có `SENTRY_DSN`; mọi sự kiện đi qua `redactDeep` (không email/phone/
 * token/cookie), có `release` (SENTRY_RELEASE | GIT_SHA | npm_package_version), `environment`, tag `trace_id`/`service`.
 * Không gửi body request, không user id thô (chỉ `user.id` băm nếu caller truyền).
 */
export interface ErrorContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
  level?: 'fatal' | 'error' | 'warning';
  /** id người dùng đã băm (không bao giờ id thô/email) */
  userHash?: string;
  request?: { method?: string; route?: string; status?: number };
  fingerprint?: string[];
}

export interface ErrorReporter {
  readonly enabled: boolean;
  capture(err: unknown, ctx?: ErrorContext): string | null;
  flush(timeoutMs?: number): Promise<void>;
}

export type SentryTransport = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ status: number }>;

export interface ParsedDsn {
  publicKey: string;
  host: string;
  protocol: string;
  projectId: string;
  pathPrefix: string;
}

/** DSN `https://<publicKey>@<host>/<projectId>` (cho phép tiền tố đường dẫn khi tự host) */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split('/').filter(Boolean);
    const projectId = parts.pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    return { publicKey: u.username, host: u.host, protocol: u.protocol.replace(':', ''), projectId, pathPrefix: parts.length ? `/${parts.join('/')}` : '' };
  } catch {
    return null;
  }
}

function frames(stack: string | undefined): Array<{ function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }> {
  if (!stack) return [];
  const out: Array<{ function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }> = [];
  for (const line of stack.split('\n').slice(1, 40)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!;
    out.push({ function: m[1], filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes('node_modules') && !filename.startsWith('node:') });
  }
  // Sentry: khung gọi theo thứ tự cũ → mới
  return out.reverse();
}

export class SentryReporter implements ErrorReporter {
  readonly enabled: boolean;
  private readonly dsn: ParsedDsn | null;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly logger = getLogger({ component: 'sentry' });

  constructor(
    private readonly opts: { dsn?: string; environment: string; release: string; service: string; sampleRate?: number; transport?: SentryTransport },
  ) {
    this.dsn = opts.dsn ? parseDsn(opts.dsn) : null;
    this.enabled = !!this.dsn;
    if (opts.dsn && !this.dsn) this.logger.warn('SENTRY_DSN invalid – error reporting disabled');
  }

  private get transport(): SentryTransport {
    return this.opts.transport ?? (async (url, init) => ({ status: (await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })).status }));
  }

  /** Dựng sự kiện Sentry đã che PII (public để test) */
  buildEvent(err: unknown, ctx: ErrorContext = {}): Record<string, unknown> {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
    const traceId = currentTraceId();
    const rc = currentContext();
    const eventId = randomBytes(16).toString('hex');
    const tags: Record<string, string> = { service: this.opts.service };
    for (const [k, v] of Object.entries(ctx.tags ?? {})) if (v !== undefined && v !== null) tags[k] = redactString(String(v)).slice(0, 200);
    if (traceId) tags.trace_id = traceId;
    if (ctx.request?.route) tags.route = ctx.request.route;
    if (ctx.request?.status) tags.status = String(ctx.request.status);
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === 'string') tags.error_code = code.slice(0, 100);
    return {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: ctx.level ?? 'error',
      logger: this.opts.service,
      server_name: os.hostname(),
      release: this.opts.release,
      environment: this.opts.environment,
      tags,
      ...(ctx.fingerprint ? { fingerprint: ctx.fingerprint } : {}),
      ...(ctx.userHash ? { user: { id: ctx.userHash } } : {}),
      ...(ctx.request ? { request: { method: ctx.request.method, url: ctx.request.route } } : {}),
      ...(traceId ? { contexts: { trace: { trace_id: traceId, span_id: rc?.spanId ?? randomBytes(8).toString('hex'), op: rc?.job ? 'queue.process' : 'http.server' } } } : {}),
      extra: redactDeep(ctx.extra ?? {}),
      exception: { values: [{ type: e.name, value: redactString(e.message ?? ''), stacktrace: { frames: frames(e.stack ? redactString(e.stack) : undefined) } }] },
    };
  }

  capture(err: unknown, ctx: ErrorContext = {}): string | null {
    if (!this.enabled || !this.dsn) return null;
    if (this.opts.sampleRate !== undefined && this.opts.sampleRate < 1 && Math.random() > this.opts.sampleRate) return null;
    const event = this.buildEvent(err, ctx);
    const d = this.dsn;
    const url = `${d.protocol}://${d.host}${d.pathPrefix}/api/${d.projectId}/envelope/`;
    const header = JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: `${d.protocol}://${d.publicKey}@${d.host}${d.pathPrefix}/${d.projectId}` });
    const body = `${header}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
    const p = this.transport(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_client=allingo-reporter/1.0, sentry_key=${d.publicKey}` },
      body,
    })
      .then((r) => {
        if (r.status >= 400) this.logger.warn({ status: r.status }, 'sentry rejected event');
      })
      .catch((ex: Error) => this.logger.warn({ err: ex.message }, 'sentry send failed'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
    return event.event_id as string;
  }

  async flush(timeoutMs = 2000): Promise<void> {
    if (!this.pending.size) return;
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}

/** Reporter của process (khởi tạo ở bootstrap/worker); mặc định tắt */
let reporter: ErrorReporter = { enabled: false, capture: () => null, flush: async () => undefined };

export function setErrorReporter(r: ErrorReporter): void {
  reporter = r;
}
export function getErrorReporter(): ErrorReporter {
  return reporter;
}

export function releaseTag(): string {
  return process.env.SENTRY_RELEASE || process.env.GIT_SHA || `allingo@${process.env.npm_package_version ?? '0.1.0'}`;
}
