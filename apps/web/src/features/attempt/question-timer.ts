'use client';

import * as React from 'react';

/**
 * timed_drill (Sprint 4): giới hạn giây MỖI câu. Server chỉ trả `expires_at` = Σ giây (theo Part hoặc `per_question_sec`),
 * nên ngân sách mỗi câu suy ra = tổng / số câu. Hết giờ câu → tự sang câu kế (một lần mỗi câu); vẫn quay lại sửa được
 * tới khi hết giờ cả lượt (server chốt theo `expires_at`).
 */
export function timedDrillBudgetSec(startedAt: string, expiresAt: string | null, count: number): number | null {
  if (!expiresAt || count <= 0) return null;
  const total = (Date.parse(expiresAt) - Date.parse(startedAt)) / 1000;
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.max(5, Math.round(total / count));
}

/** Thời gian còn lại của câu (ms) khi đã dùng `spentMs` */
export function questionRemainingMs(budgetSec: number, spentMs: number): number {
  return Math.max(0, budgetSec * 1000 - spentMs);
}

const KEY = (attemptId: string) => `allingo.qtimer.${attemptId}`;

export interface QuestionTimer {
  /** null khi không áp dụng (không phải timed_drill, hoặc câu Listening do chuỗi phát điều khiển) */
  budgetSec: number | null;
  remainingMs: () => number;
}

export function useQuestionTimer({ attemptId, questionId, budgetSec, onTimeout }: { attemptId: string; questionId: string; budgetSec: number | null; onTimeout: (questionId: string) => void }): QuestionTimer {
  const spentRef = React.useRef<Record<string, number> | null>(null);
  const enteredRef = React.useRef<{ id: string; at: number } | null>(null);
  const firedRef = React.useRef<Set<string>>(new Set());
  const onTimeoutRef = React.useRef(onTimeout);
  React.useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const load = React.useCallback(() => {
    if (spentRef.current) return spentRef.current;
    try {
      spentRef.current = JSON.parse(window.localStorage.getItem(KEY(attemptId)) ?? '{}') as Record<string, number>;
    } catch {
      spentRef.current = {};
    }
    return spentRef.current;
  }, [attemptId]);

  const remainingMs = React.useCallback(() => {
    if (budgetSec === null) return Infinity;
    const spent = load()[questionId] ?? 0;
    const live = enteredRef.current?.id === questionId ? Date.now() - enteredRef.current.at : 0;
    return questionRemainingMs(budgetSec, spent + live);
  }, [budgetSec, load, questionId]);

  React.useEffect(() => {
    if (budgetSec === null) return;
    const spent = load();
    enteredRef.current = { id: questionId, at: Date.now() };
    // Quay lại câu đã hết giờ (hoặc tải lại trang) → không tự chuyển nữa, vẫn cho sửa đáp án
    if (questionRemainingMs(budgetSec, spent[questionId] ?? 0) <= 0) firedRef.current.add(questionId);
    const save = () => {
      const e = enteredRef.current;
      if (!e) return;
      const now = Date.now();
      spent[e.id] = (spent[e.id] ?? 0) + (now - e.at);
      enteredRef.current = { id: e.id, at: now };
      try {
        window.localStorage.setItem(KEY(attemptId), JSON.stringify(spent));
      } catch {
        /* bỏ qua */
      }
    };
    const id = window.setInterval(() => {
      save();
      if (questionRemainingMs(budgetSec, spent[questionId] ?? 0) <= 0 && !firedRef.current.has(questionId)) {
        firedRef.current.add(questionId);
        onTimeoutRef.current(questionId);
      }
    }, 500);
    return () => {
      window.clearInterval(id);
      save();
      enteredRef.current = null;
    };
  }, [attemptId, budgetSec, load, questionId]);

  return { budgetSec, remainingMs };
}
