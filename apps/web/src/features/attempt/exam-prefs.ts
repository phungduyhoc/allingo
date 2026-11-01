'use client';

import * as React from 'react';

/**
 * Tuỳ chọn hiển thị Exam Mode của người học (theo trình duyệt): cỡ chữ 3 mức và tỉ lệ đoạn văn/câu hỏi (Part 6–7).
 * Lưu localStorage; mọi truy cập bọc try/catch (chế độ riêng tư, bị chặn, dữ liệu hỏng → mặc định).
 */

/** Hệ số phóng to nội dung đề (CSS zoom) cho 3 mức cỡ chữ */
export const FONT_SCALES = [1, 1.15, 1.3] as const;
export type FontLevel = 0 | 1 | 2;

export interface ExamPrefs {
  font: FontLevel;
  /** Phần chiều ngang dành cho đoạn văn (0.3–0.7) */
  split: number;
}

export const SPLIT_MIN = 0.3;
export const SPLIT_MAX = 0.7;
export const DEFAULT_EXAM_PREFS: ExamPrefs = { font: 0, split: 0.5 };
export const EXAM_PREFS_KEY = 'allingo.exam.prefs';

export function clampSplit(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_EXAM_PREFS.split;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(v * 1000) / 1000));
}

export function toFontLevel(v: unknown): FontLevel {
  return v === 1 || v === 2 ? v : 0;
}

/** Tăng/giảm cỡ chữ, dừng ở hai đầu */
export function stepFont(level: FontLevel, delta: 1 | -1): FontLevel {
  return toFontLevel(Math.min(2, Math.max(0, level + delta)));
}

export function parseExamPrefs(raw: string | null | undefined): ExamPrefs {
  if (!raw) return { ...DEFAULT_EXAM_PREFS };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ExamPrefs, unknown>> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_EXAM_PREFS };
    return { font: toFontLevel(v.font), split: clampSplit(v.split) };
  } catch {
    return { ...DEFAULT_EXAM_PREFS };
  }
}

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): PrefsStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadExamPrefs(storage: PrefsStorage | null = browserStorage()): ExamPrefs {
  try {
    return parseExamPrefs(storage?.getItem(EXAM_PREFS_KEY));
  } catch {
    return { ...DEFAULT_EXAM_PREFS };
  }
}

export function saveExamPrefs(prefs: ExamPrefs, storage: PrefsStorage | null = browserStorage()): void {
  try {
    storage?.setItem(EXAM_PREFS_KEY, JSON.stringify({ font: toFontLevel(prefs.font), split: clampSplit(prefs.split) }));
  } catch {
    /* localStorage đầy/bị chặn – chỉ giữ trong phiên */
  }
}

/** Hook tuỳ chọn: đọc một lần khi mount (màn làm bài chỉ render ở client), ghi khi đổi */
export function useExamPrefs(): [ExamPrefs, (patch: Partial<ExamPrefs>, opts?: { persist?: boolean }) => void] {
  const [prefs, setPrefs] = React.useState<ExamPrefs>(() => loadExamPrefs());
  const update = React.useCallback((patch: Partial<ExamPrefs>, opts: { persist?: boolean } = {}) => {
    setPrefs((prev) => {
      const next: ExamPrefs = { font: toFontLevel(patch.font ?? prev.font), split: clampSplit(patch.split ?? prev.split) };
      if (opts.persist !== false) saveExamPrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}
