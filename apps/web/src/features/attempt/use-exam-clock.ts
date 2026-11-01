'use client';

import * as React from 'react';
import { clockTone, computeClockOffset, crossedAnnouncement, remainingMs, type ClockTone } from './clock';

export interface ExamClock {
  remaining: number | null;
  tone: ClockTone;
  expired: boolean;
  /** Mốc phút vừa vượt qua (10/5/1) để thông báo aria-live, null nếu không */
  announcement: number | null;
}

export interface ExamClockHandlers {
  /** Gọi đúng một lần khi về 0 */
  onExpire?: () => void;
  /** Gọi mỗi khi vượt mốc cảnh báo (phút còn lại) – hiển thị toast */
  onWarning?: (minutes: number) => void;
}

/** Đồng hồ đếm ngược theo server_time/expires_at (không tin đồng hồ máy khách) */
export function useExamClock(expiresAt: string | null, serverTime: string, handlers: ExamClockHandlers = {}): ExamClock {
  const offset = React.useMemo(() => computeClockOffset(serverTime), [serverTime]);
  const [remainingState, setRemainingState] = React.useState<number | null>(() => remainingMs(expiresAt, offset));
  const [announcement, setAnnouncement] = React.useState<number | null>(null);
  const expiredRef = React.useRef(false);
  const handlersRef = React.useRef(handlers);
  React.useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  React.useEffect(() => {
    if (!expiresAt) return;
    let prev: number | null = remainingMs(expiresAt, offset);
    const tick = () => {
      const next = remainingMs(expiresAt, offset);
      const mark = crossedAnnouncement(prev, next);
      if (mark !== null) {
        setAnnouncement(mark);
        handlersRef.current.onWarning?.(mark);
      }
      prev = next;
      setRemainingState(next);
      if (next !== null && next <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        handlersRef.current.onExpire?.();
      }
    };
    const id = window.setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expiresAt, offset]);

  const remaining = expiresAt ? remainingState : null;
  return { remaining, tone: clockTone(remaining), expired: remaining !== null && remaining <= 0, announcement };
}
