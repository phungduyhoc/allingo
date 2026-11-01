import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { Forbidden } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare Turnstile ở register/login/otp. TURNSTILE_SECRET trống (dev/test) → bỏ qua. */
@Injectable()
export class TurnstileService {
  private readonly logger = getLogger({ component: 'iam.turnstile' });
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return !!this.env.TURNSTILE_SECRET;
  }

  async assert(token: string | undefined, ip: string | null | undefined, action: string): Promise<void> {
    if (!this.enabled) return;
    if (!token) throw new Forbidden('Turnstile token required', { reason: 'turnstile_missing', action });
    const body = new URLSearchParams({ secret: this.env.TURNSTILE_SECRET!, response: token, ...(ip ? { remoteip: ip } : {}) });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: ctrl.signal });
      const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (!json.success) throw new Forbidden('Turnstile verification failed', { reason: 'turnstile_failed', codes: json['error-codes'] ?? [] });
    } catch (err) {
      if (err instanceof Forbidden) throw err;
      // Lỗi mạng tới Cloudflare: không chặn người dùng thật, ghi cảnh báo (fail-open có chủ đích; siết lại ở S11)
      this.logger.warn({ err: (err as Error).message, action }, 'turnstile verify unreachable (fail-open)');
    } finally {
      clearTimeout(timer);
    }
  }
}
