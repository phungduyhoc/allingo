'use client';

import * as React from 'react';
import { saveAnswers } from '@/lib/queries';
import { ApiError } from '@allingo/api-client';
import { getErrorStatus } from '@/lib/errors';
import { DraftQueue, type DraftEntry, type DraftStatus } from './draft-queue';
import { browserDraftStore, type DraftStoreKind } from './draft-store';
import type { AttemptAnswersPut } from '@/lib/types';

export interface DraftSaver {
  queue: DraftQueue;
  /** Đã khôi phục nháp cục bộ (IndexedDB) – chỉ dựng màn hình làm bài sau khi ready */
  ready: boolean;
  status: DraftStatus;
  lastSavedAt: number | null;
  pending: number;
  /** Đã mất mạng/lỗi lưu và chưa đồng bộ lại xong – banner "Đang lưu lại…" */
  recovering: boolean;
  storeKind: DraftStoreKind | 'none';
  /** `immediate`: gửi ngay không chờ debounce (Practice cần phản hồi đúng/sai tức thì) */
  enqueue: (entry: DraftEntry, opts?: { immediate?: boolean }) => void;
  setMeta: (meta: { section_elapsed_sec?: Record<string, number>; ui_state?: AttemptAnswersPut['ui_state'] }) => void;
  /** Gửi ngay (khi đổi câu/nộp bài); nuốt lỗi – hàng đợi tự giữ lại */
  flushNow: () => Promise<void>;
}

const AUTOSAVE_MS = 10_000;
const DEBOUNCE_MS = 800;

export interface DraftSaverOptions {
  enabled: boolean;
  /** Server từ chối lưu vì bài đã đóng (409: hết giờ + ân hạn 30 s, hoặc đã nộp) – gọi một lần */
  onClosed?: (error: unknown) => void;
  /** C3: section của câu (bỏ nháp của section đã khoá khi server trả 409 section_locked) */
  sectionOf?: (questionId: string) => string | undefined;
  /** C3: server báo các section đã hết giờ (409 section_locked) */
  onSectionLocked?: (sectionCodes: string[]) => void;
}

/**
 * Kết nối DraftQueue với vòng đời trang: tự lưu mỗi 10 s, debounce khi vừa đổi đáp án,
 * flush khi ẩn tab/đóng trang, gửi lại khi có mạng trở lại. Nháp chưa gửi nằm trong IndexedDB (fallback bộ nhớ).
 */
export function useDraftSaver(attemptId: string, { enabled, onClosed, sectionOf, onSectionLocked }: DraftSaverOptions): DraftSaver {
  const [status, setStatus] = React.useState<DraftStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);
  const onClosedRef = React.useRef(onClosed);
  React.useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);


  const queue = React.useMemo(
    () =>
      new DraftQueue({
        attemptId,
        flush: (body) => saveAnswers(attemptId, body),
        isClosedError: (err) => getErrorStatus(err) === 409 && !isSectionLockedError(err),

        store: typeof window === 'undefined' ? null : browserDraftStore(),
        legacyStorage: legacyLocalStorage(),
        onStatus: (s, info) => {
          if (s === 'offline' || s === 'error') setRecovering(true);
          else if (s === 'saved') setRecovering(false);
          setStatus(s);
          setLastSavedAt(info.lastSavedAt);
          setPending(info.pending);
        },
      }),
    [attemptId],
  );
  const debounceRef = React.useRef<number | null>(null);

  // C3: 409 section_locked → bỏ nháp của section đã hết giờ (không đóng cả bài), báo trang làm bài khoá section
  React.useEffect(() => {
    queue.setRejectedEntries((err, batch) => {
      if (!isSectionLockedError(err)) return null;
      const codes = lockedSectionsOf(err);
      const ids = batch.filter((e) => !codes.length || codes.includes(sectionOf?.(e.question_id) ?? '')).map((e) => e.question_id);
      if (codes.length) onSectionLocked?.(codes);
      return ids;
    });
  }, [onSectionLocked, queue, sectionOf]);

  // 409 khi lưu → báo nơi dùng (nộp & chuyển trang)
  React.useEffect(() => queue.onClosed((err) => onClosedRef.current?.(err)), [queue]);

  React.useEffect(() => {
    let alive = true;
    void queue.ready.then(() => {
      if (!alive) return;
      setPending(queue.pendingCount);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [queue]);

  const flushNow = React.useCallback(async () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (queue.closed) return;
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
    (entry: DraftEntry, opts?: { immediate?: boolean }) => {
      queue.enqueue(entry);
      setPending(queue.pendingCount);
      if (opts?.immediate) void flushNow();
      else scheduleDebounced();
    },
    [flushNow, queue, scheduleDebounced],
  );

  const setMeta = React.useCallback((meta: Parameters<DraftQueue['setMeta']>[0]) => queue.setMeta(meta), [queue]);

  React.useEffect(() => {
    if (!enabled || !ready) return;
    const interval = window.setInterval(() => void flushNow(), AUTOSAVE_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushNow();
    };
    const onOnline = () => void flushNow();
    const onOffline = () => {
      setRecovering(true);
      if (queue.hasPending) setStatus('offline');
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!queue.hasPending || queue.closed) return;
      void flushNow();
      // Nháp đã nằm bền trong IndexedDB → không cần hỏi; chỉ cảnh báo khi đang dùng bộ nhớ (mất khi đóng tab)
      if (queue.storeKind !== 'indexeddb') e.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Nháp còn tồn từ phiên trước (offline) → gửi ngay
    if (queue.hasPending) void flushNow();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [enabled, flushNow, queue, ready]);

  return { queue, ready, status, lastSavedAt, pending, recovering, storeKind: ready ? queue.storeKind : 'none', enqueue, setMeta, flushNow };
}

function legacyLocalStorage(): Pick<Storage, 'getItem' | 'removeItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Trạng thái mạng của trình duyệt (navigator.onLine + sự kiện online/offline) */
export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * C3: 409 lưu đáp án vào section (kỹ năng) đã hết giờ – API: `conflict` + `details.reason = 'section_locked'` (server vẫn lưu phần hợp lệ
 * của lô); chấp nhận cả mã riêng `section_locked`.
 */
export function isSectionLockedError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && (err.code === 'section_locked' || (err.details as { reason?: unknown } | undefined)?.reason === 'section_locked');
}

/** Mã section bị khoá trong `details` (`section_codes[]` hoặc `section_code`) */
export function lockedSectionsOf(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const d = (err.details ?? {}) as { section_codes?: unknown; section_code?: unknown };
  if (Array.isArray(d.section_codes)) return d.section_codes.filter((x): x is string => typeof x === 'string');
  return typeof d.section_code === 'string' ? [d.section_code] : [];
}
