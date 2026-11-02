'use client';

import * as React from 'react';
import { ApiError } from '@allingo/api-client';
import { useMyAttempts } from './queries';

/**
 * Khoá Exam Mode phía giao diện (CLAUDE.md §5.8, ADR-0028): khi người học có attempt `mode = exam` đang `in_progress`,
 * API trả 403 `exam_mode_locked` cho giải thích, gia sư, tra từ và ghi chú (ghi). Web ẩn các nút này TRƯỚC khi gọi
 * (hỏi `/me/attempts?status=in_progress&mode=exam`) và khoá ngay khi gặp một 403 bất kỳ (bài thi mở ở thiết bị/tab khác).
 * Server luôn là nơi quyết định – đây chỉ là hiển thị.
 */

interface ApiLock {
  attemptId: string | null;
  at: number;
}

let apiLock: ApiLock | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Ghi nhận 403 `exam_mode_locked` (kèm `details.attempt_id` nếu có) → mọi nút trợ giúp ẩn ngay */
export function markExamLocked(attemptId?: string | null): void {
  apiLock = { attemptId: attemptId ?? null, at: Date.now() };
  emit();
}

/** Lỗi bất kỳ là 403 exam_mode_locked? → ghi nhận và trả true */
export function handleExamLockedError(err: unknown): boolean {
  if (err instanceof ApiError && err.code === 'exam_mode_locked') {
    const id = err.details && typeof err.details.attempt_id === 'string' ? err.details.attempt_id : null;
    markExamLocked(id);
    return true;
  }
  return false;
}

/** Chỉ dùng trong test */
export function resetExamLockForTest(): void {
  apiLock = null;
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => apiLock;
const getServerSnapshot = (): ApiLock | null => null;

/**
 * Quyết định khoá (thuần – có test): có bài thi đang làm trong danh sách → khoá; có 403 từ API mới hơn lần tải danh sách
 * gần nhất → khoá (danh sách cũ hơn chưa biết bài thi). Danh sách tải SAU 403 mà không còn bài thi → mở lại (đã nộp).
 */
export function examLockDecision(input: {
  openExamId: string | null;
  listUpdatedAt: number;
  apiLock: ApiLock | null;
}): { locked: boolean; attemptId: string | null } {
  if (input.openExamId) return { locked: true, attemptId: input.openExamId };
  if (input.apiLock && input.apiLock.at >= input.listUpdatedAt)
    return { locked: true, attemptId: input.apiLock.attemptId };
  return { locked: false, attemptId: null };
}

/**
 * `exceptAttemptId`: bỏ qua chính attempt đang xem (Review của một bài exam đã nộp không bao giờ trùng, nhưng giữ cho
 * an toàn). `pending` = chưa biết (đang tải danh sách lần đầu) – UI có thể ẩn nút trong lúc chờ.
 */
export function useExamLock(exceptAttemptId?: string): { locked: boolean; attemptId: string | null; pending: boolean } {
  const exams = useMyAttempts({ status: 'in_progress', mode: 'exam' }, { staleTime: 0, refetchOnWindowFocus: true });
  const lock = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const openExam =
    exams.data?.data.find((a) => a.status === 'in_progress' && a.mode === 'exam' && a.id !== exceptAttemptId) ?? null;
  const decision = examLockDecision({
    openExamId: openExam?.id ?? null,
    listUpdatedAt: exams.dataUpdatedAt,
    apiLock: lock,
  });
  // 403 mới hơn danh sách → tải lại danh sách để biết attempt nào (nút "Tiếp tục bài thi")
  const refetch = exams.refetch;
  React.useEffect(() => {
    if (lock && lock.at > exams.dataUpdatedAt) void refetch();
  }, [exams.dataUpdatedAt, lock, refetch]);
  return { ...decision, pending: exams.isPending };
}
