import { Global, Module } from '@nestjs/common';

/**
 * Đồng hồ hệ thống tiêm được (Sprint 5): quota theo ngày/tháng giờ Asia/Ho_Chi_Minh, circuit breaker… dùng `Clock`
 * để test bằng đồng hồ giả (không phụ thuộc giờ máy chạy CI).
 */
export interface Clock {
  now(): number;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Đồng hồ giả cho test: đặt/tiến thời gian thủ công */
export class FakeClock implements Clock {
  constructor(private t: number = Date.now()) {}
  now(): number {
    return this.t;
  }
  set(t: number | Date): void {
    this.t = typeof t === 'number' ? t : t.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Đối tượng đồng hồ dùng chung (một instance cho cả process) – test thay bằng `useClock()` */
let current: Clock = new SystemClock();
export const clockRef: Clock = { now: () => current.now() };
export function useClock(c: Clock): () => void {
  const prev = current;
  current = c;
  return () => {
    current = prev;
  };
}

@Global()
@Module({ providers: [{ provide: CLOCK, useValue: clockRef }], exports: [CLOCK] })
export class ClockModule {}
