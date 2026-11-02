import { createHash } from 'node:crypto';
import type { Env } from '../../../config/env.js';
import { getLogger } from '../../../shared/telemetry/logger.js';

/**
 * Đích sự kiện phễu (Sprint 10): PostHog (HTTP capture), bộ nhớ (test) hoặc không gì. KHÔNG gửi PII: distinct_id = sha256(muối:
 * user_id) (32 hex) hoặc anonymous_id của trình duyệt; thuộc tính chỉ là mã/số (gói, chương trình, kênh, UTM).
 */
export interface FunnelCapture {
  event: string;
  distinct_id: string;
  /** Khoá idempotent (vd `order_paid:<order_id>`) → uuid xác định – PostHog bỏ trùng theo uuid */
  dedupe_key: string;
  properties: Record<string, string | number | boolean | null>;
  timestamp: string;
}

export interface AnalyticsSink {
  readonly name: 'posthog' | 'memory' | 'none';
  readonly enabled: boolean;
  capture(e: FunnelCapture): Promise<boolean>;
}

export const ANALYTICS_SINK = Symbol('ANALYTICS_SINK');

/** sha256(muối:user_id) – 32 ký tự hex; muối = ANALYTICS_HASH_SALT hoặc dẫn xuất AUTH_SECRET */
export function hashUserId(userId: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${userId}`).digest('hex').slice(0, 32);
}

export function analyticsSalt(env: Pick<Env, 'ANALYTICS_HASH_SALT' | 'AUTH_SECRET'>): string {
  return env.ANALYTICS_HASH_SALT || createHash('sha256').update(`allingo-analytics:${env.AUTH_SECRET}`).digest('hex');
}

/** UUID dạng v4 xác định từ khoá (để PostHog bỏ trùng khi gửi lại) */
export function deterministicUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class MemoryAnalyticsSink implements AnalyticsSink {
  readonly name = 'memory' as const;
  readonly enabled = true;
  readonly events: FunnelCapture[] = [];
  capture(e: FunnelCapture): Promise<boolean> {
    this.events.push(e);
    return Promise.resolve(true);
  }
  clear(): void {
    this.events.length = 0;
  }
}

export class NoopAnalyticsSink implements AnalyticsSink {
  readonly name = 'none' as const;
  readonly enabled = false;
  capture(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export class PostHogSink implements AnalyticsSink {
  readonly name = 'posthog' as const;
  readonly enabled = true;
  private readonly logger = getLogger({ component: 'analytics.posthog' });

  constructor(
    private readonly key: string,
    private readonly host: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async capture(e: FunnelCapture): Promise<boolean> {
    const body = { api_key: this.key, event: e.event, distinct_id: e.distinct_id, uuid: deterministicUuid(e.dedupe_key), timestamp: e.timestamp, properties: { ...e.properties, $lib: 'allingo-api', $process_person_profile: false } };
    try {
      const res = await this.fetchImpl(`${this.host.replace(/\/+$/, '')}/i/v0/e/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
      if (!res.ok) this.logger.warn({ status: res.status, event: e.event }, 'posthog capture rejected');
      return res.ok;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message.slice(0, 120), event: e.event }, 'posthog capture failed');
      return false;
    }
  }
}

export function createAnalyticsSink(env: Env): AnalyticsSink {
  const mode = env.ANALYTICS_SINK === 'auto' ? (env.APP_ENV === 'test' ? 'memory' : env.POSTHOG_KEY ? 'posthog' : 'none') : env.ANALYTICS_SINK;
  if (mode === 'memory') return new MemoryAnalyticsSink();
  if (mode === 'posthog') {
    if (!env.POSTHOG_KEY) {
      getLogger({ component: 'analytics' }).warn('ANALYTICS_SINK=posthog but POSTHOG_KEY is empty → funnel events disabled');
      return new NoopAnalyticsSink();
    }
    return new PostHogSink(env.POSTHOG_KEY, env.POSTHOG_HOST);
  }
  return new NoopAnalyticsSink();
}
