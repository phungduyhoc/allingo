import webpush from 'web-push';

/**
 * Gửi Web Push (VAPID, RFC 8030/8291/8292). Interface để test thay bằng sender giả (phiên phát triển không có trình duyệt nhận).
 */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  statusCode: number | null;
  /** Endpoint không còn hợp lệ (404/410) → xoá đăng ký */
  gone: boolean;
  error?: string;
}

export interface PushSender {
  readonly kind: 'webpush' | 'memory';
  send(target: PushTarget, payload: string, opts: { ttlSeconds: number; topic?: string; urgency?: 'very-low' | 'low' | 'normal' | 'high' }): Promise<PushSendResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Sender thật bằng thư viện `web-push` (mã hoá aes128gcm + chữ ký VAPID ES256) */
export class WebPushSender implements PushSender {
  readonly kind = 'webpush' as const;
  constructor(private readonly vapid: { subject: string; publicKey: string; privateKey: string }) {}

  async send(target: PushTarget, payload: string, opts: { ttlSeconds: number; topic?: string; urgency?: 'very-low' | 'low' | 'normal' | 'high' }): Promise<PushSendResult> {
    try {
      const r = await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
        TTL: opts.ttlSeconds,
        urgency: opts.urgency ?? 'normal',
        ...(opts.topic ? { topic: opts.topic } : {}),
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        timeout: 10_000,
      });
      return { ok: true, statusCode: r.statusCode, gone: false };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? null;
      return { ok: false, statusCode: status, gone: status === 404 || status === 410, error: (err as Error).message.slice(0, 200) };
    }
  }

  /** Dựng request (headers mã hoá + VAPID) mà không gửi – dùng cho unit test */
  static requestDetails(target: PushTarget, payload: string, vapid: { subject: string; publicKey: string; privateKey: string }, ttlSeconds = 60) {
    return webpush.generateRequestDetails({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, { TTL: ttlSeconds, vapidDetails: vapid });
  }
}

/** Sender giả: ghi lại các lần gửi; endpoint chứa `/gone` → 410, `/fail` → 500 */
export class MemoryPushSender implements PushSender {
  readonly kind = 'memory' as const;
  readonly sent: Array<{ endpoint: string; payload: string; ttlSeconds: number }> = [];

  async send(target: PushTarget, payload: string, opts: { ttlSeconds: number }): Promise<PushSendResult> {
    if (target.endpoint.includes('/gone')) return { ok: false, statusCode: 410, gone: true, error: 'gone' };
    if (target.endpoint.includes('/fail')) return { ok: false, statusCode: 500, gone: false, error: 'push service error' };
    this.sent.push({ endpoint: target.endpoint, payload, ttlSeconds: opts.ttlSeconds });
    return { ok: true, statusCode: 201, gone: false };
  }
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
