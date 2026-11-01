import type { Clock } from '../../../shared/clock/clock.module.js';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  /** Số lỗi trong cửa sổ để mở (mặc định 5) */
  failureThreshold: number;
  /** Cửa sổ đếm lỗi (ms, mặc định 60 s) */
  windowMs: number;
  /** Thời gian mở trước khi cho thử lại – half-open (ms, mặc định 60 s) */
  openMs: number;
}

export interface BreakerEvents {
  onOpen?: (info: { failures: number; until: number }) => void;
  onHalfOpen?: () => void;
  onClose?: () => void;
}

/**
 * Circuit breaker theo provider (S5): ≥ `failureThreshold` lỗi trong `windowMs` → OPEN (bỏ qua provider, router dùng fallback);
 * sau `openMs` → HALF_OPEN: cho đúng MỘT lời gọi thử; thành công → CLOSED, lỗi → OPEN lại.
 * Đồng hồ tiêm được để test không phải chờ 60 giây.
 */
export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt = 0;
  private stateValue: BreakerState = 'closed';
  private probeInFlight = false;

  constructor(
    private readonly opts: BreakerOptions,
    private readonly clock: Clock,
    private readonly events: BreakerEvents = {},
  ) {}

  get state(): BreakerState {
    if (this.stateValue === 'open' && this.clock.now() - this.openedAt >= this.opts.openMs) {
      this.stateValue = 'half_open';
      this.probeInFlight = false;
      this.events.onHalfOpen?.();
    }
    return this.stateValue;
  }

  /** Có được gọi provider không. HALF_OPEN chỉ cho một probe đồng thời. */
  canRequest(): boolean {
    const s = this.state;
    if (s === 'closed') return true;
    if (s === 'open') return false;
    if (this.probeInFlight) return false;
    return true;
  }

  /** Đánh dấu bắt đầu gọi (giữ chỗ probe ở HALF_OPEN) */
  begin(): void {
    if (this.state === 'half_open') this.probeInFlight = true;
  }

  onSuccess(): void {
    const prev = this.state;
    this.failures = [];
    this.probeInFlight = false;
    if (prev !== 'closed') {
      this.stateValue = 'closed';
      this.events.onClose?.();
    }
  }

  onFailure(): void {
    const now = this.clock.now();
    if (this.state === 'half_open') {
      this.trip(now, this.opts.failureThreshold);
      return;
    }
    this.failures = this.failures.filter((t) => now - t < this.opts.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.opts.failureThreshold) this.trip(now, this.failures.length);
  }

  private trip(now: number, failures: number): void {
    this.stateValue = 'open';
    this.openedAt = now;
    this.failures = [];
    this.probeInFlight = false;
    this.events.onOpen?.({ failures, until: now + this.opts.openMs });
  }

  snapshot(): { state: BreakerState; failures_in_window: number; opened_at: string | null } {
    const s = this.state;
    return { state: s, failures_in_window: this.failures.length, opened_at: s === 'closed' ? null : new Date(this.openedAt).toISOString() };
  }
}
