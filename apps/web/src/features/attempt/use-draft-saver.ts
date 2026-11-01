'use client';

import * as React from 'react';
import { saveAnswers } from '@/lib/queries';
import { DraftQueue, type DraftEntry, type DraftStatus } from './draft-queue';
import type { AttemptAnswersPut } from '@/lib/types';

export interface DraftSaver {
  queue: DraftQueue;
  status: DraftStatus;
  lastSavedAt: number | null;
  pending: number;
  enqueue: (entry: DraftEntry) => void;
  setMeta: (meta: { section_elapsed_sec?: Record<string, number>; ui_state?: AttemptAnswersPut['ui_state'] }) => void;
  /** Gửi ngay (khi đổi câu/nộp bài); nuốt lỗi – hàng đợi tự giữ lại */
  flushNow: () => Promise<void>;
}

const AUTOSAVE_MS = 10_000;
const DEBOUNCE_MS = 800;

/**
 * Kết nối DraftQueue với vòng đời trang: tự lưu mỗi 10 s, debounce khi vừa đổi đáp án,
 * flush khi ẩn tab/đóng trang, gửi lại khi có mạng trở lại.
 */
export function useDraftSaver(attemptId: string, enabled: boolean): DraftSaver {
  const [status, setStatus] = React.useState<DraftStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState(0);
  const queue = React.useMemo(
    () =>
      new DraftQueue({
        attemptId,
        flush: (body) => saveAnswers(attemptId, body),
        storage: typeof window === 'undefined' ? null : window.localStorage,
        onStatus: (s, info) => {
          setStatus(s);
          setLastSavedAt(info.lastSavedAt);
          setPending(info.pending);
        },
      }),
    [attemptId],
  );
  const debounceRef = React.useRef<number | null>(null);

  const flushNow = React.useCallback(async () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    try {
      await queue.flush();
    } catch {
      /* giữ trong hàng đợi, thử lại ở chu kỳ sau */
    }
  }, [queue]);

  const scheduleDebounced = React.useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void flushNow(), DEBOUNCE_MS);
  }, [flushNow]);

  const enqueue = React.useCallback(
    (entry: DraftEntry) => {
      queue.enqueue(entry);
      setPending(queue.pendingCount);
      scheduleDebounced();
    },
    [queue, scheduleDebounced],
  );

  const setMeta = React.useCallback((meta: Parameters<DraftQueue['setMeta']>[0]) => queue.setMeta(meta), [queue]);

  React.useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => void flushNow(), AUTOSAVE_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushNow();
    };
    const onOnline = () => void flushNow();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.hasPending) {
        void flushNow();
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Nháp còn tồn từ phiên trước (offline) → gửi ngay
    if (queue.hasPending) void flushNow();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [enabled, flushNow, queue]);

  return { queue, status, lastSavedAt, pending, enqueue, setMeta, flushNow };
}
