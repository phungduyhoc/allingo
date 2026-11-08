import type { FunnelEventInput } from '@allingo/schemas';
import { anonymousId, browserStore, hasAnalyticsConsent, type KeyValueStore } from './consent';

/**
 * Sự kiện phễu phía client (S10): `landing_view`, `signup_start`, `checkout_start` → `POST /analytics/events` (API chuyển sang
 * PostHog server-side – web KHÔNG tải SDK PostHog). Cổng đồng ý: chưa đồng ý cookie phân tích → không gửi gì (không có cả request
 * `consent: false`). Không gửi thông tin cá nhân: chỉ đường dẫn (không query) + thuộc tính kỹ thuật ngắn. Lỗi mạng bị bỏ qua.
 * Các sự kiện còn lại (`signup_done`, `diagnostic_done`, `first_attempt`, `order_paid`) do server phát từ outbox.
 */

export type ClientFunnelEvent = FunnelEventInput['event'];
export type TrackResult = 'sent' | 'no_consent' | 'duplicate' | 'failed';

export interface TrackDeps {
  store?: KeyValueStore | null;
  send?: (body: FunnelEventInput) => Promise<unknown>;
  path?: string;
}

/** Mỗi (sự kiện × đường dẫn) một lần mỗi lần tải trang */
const sentOnce = new Set<string>();

export function resetTrackedForTest(): void {
  sentOnce.clear();
}

async function defaultSend(body: FunnelEventInput): Promise<unknown> {
  const { postFunnelEvent } = await import('@/lib/s10-api');
  return postFunnelEvent(body);
}

export async function trackFunnel(event: ClientFunnelEvent, properties: FunnelEventInput['properties'] = undefined, deps: TrackDeps = {}): Promise<TrackResult> {
  const store = deps.store === undefined ? browserStore() : deps.store;
  if (!hasAnalyticsConsent(store)) return 'no_consent';
  const anon = anonymousId(store);
  if (!anon) return 'no_consent';
  const path = (deps.path ?? (typeof window !== 'undefined' ? window.location.pathname : '/')).slice(0, 512);
  const key = `${event}|${path}`;
  if (sentOnce.has(key)) return 'duplicate';
  sentOnce.add(key);
  try {
    await (deps.send ?? defaultSend)({ event, anonymous_id: anon, consent: true, path, ...(properties ? { properties } : {}) });
    return 'sent';
  } catch {
    sentOnce.delete(key);
    return 'failed';
  }
}
