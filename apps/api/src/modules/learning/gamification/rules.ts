import { addDays, daysBetween } from '@allingo/planner';

/**
 * Luật gamification thuần (Sprint 9 – FR-GM-*): chuỗi ngày học theo LỊCH CỦA NGƯỜI HỌC (múi giờ iam.users.timezone),
 * "đóng băng" tự động 1 ngày lỡ / 7 ngày cho Pro (A139), rule engine huy hiệu từ `learn.badges.rule` (JSON seed).
 */

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  /** Ngày học gần nhất (YYYY-MM-DD theo giờ người học) */
  lastActiveDate: string | null;
  /** Ngày sớm nhất được dùng đóng băng lần tới (null = có sẵn) */
  freezeAvailableAt: string | null;
  freezesUsed: number;
}

/** Số ngày giữa hai lần dùng đóng băng */
export const STREAK_FREEZE_COOLDOWN_DAYS = 7;

export const freezeReady = (s: Pick<StreakState, 'freezeAvailableAt'> | null, today: string): boolean => !s?.freezeAvailableAt || s.freezeAvailableAt <= today;

/**
 * Ghi nhận một hoạt động học trong ngày `today`:
 * - cùng ngày → không đổi; hôm qua → +1;
 * - lỡ đúng 1 ngày + được đóng băng (Pro) + đóng băng sẵn sàng → +1, dùng đóng băng (hồi lại sau 7 ngày);
 * - lỡ ≥ 1 ngày còn lại → bắt đầu lại 1;
 * - `today` sớm hơn ngày học gần nhất (đổi múi giờ lùi) → không đổi.
 */
export function applyStudyDay(prev: StreakState | null, today: string, canFreeze: boolean): { next: StreakState; incremented: boolean; freezeUsed: boolean; reset: boolean } {
  if (!prev || !prev.lastActiveDate) {
    const base = prev ?? { currentStreak: 0, longestStreak: 0, lastActiveDate: null, freezeAvailableAt: null, freezesUsed: 0 };
    const next = { ...base, currentStreak: 1, longestStreak: Math.max(1, base.longestStreak), lastActiveDate: today };
    return { next, incremented: true, freezeUsed: false, reset: false };
  }
  const gap = daysBetween(prev.lastActiveDate, today);
  if (gap <= 0) return { next: prev, incremented: false, freezeUsed: false, reset: false };
  if (gap === 1) {
    const cur = prev.currentStreak + 1;
    return { next: { ...prev, currentStreak: cur, longestStreak: Math.max(prev.longestStreak, cur), lastActiveDate: today }, incremented: true, freezeUsed: false, reset: false };
  }
  if (gap === 2 && canFreeze && freezeReady(prev, today) && prev.currentStreak > 0) {
    const cur = prev.currentStreak + 1;
    return {
      next: { ...prev, currentStreak: cur, longestStreak: Math.max(prev.longestStreak, cur), lastActiveDate: today, freezesUsed: prev.freezesUsed + 1, freezeAvailableAt: addDays(today, STREAK_FREEZE_COOLDOWN_DAYS) },
      incremented: true,
      freezeUsed: true,
      reset: false,
    };
  }
  return { next: { ...prev, currentStreak: 1, longestStreak: Math.max(prev.longestStreak, 1), lastActiveDate: today }, incremented: true, freezeUsed: false, reset: true };
}

/**
 * Chuỗi hiển thị hôm nay (DB chỉ cập nhật khi có hoạt động): đã học hôm nay → giữ; học hôm qua → giữ nhưng `at_risk`;
 * lỡ đúng hôm qua mà còn đóng băng (Pro) → giữ, `at_risk` (học hôm nay sẽ dùng đóng băng); còn lại → 0 (đã mất).
 */
export function effectiveStreak(s: StreakState | null, today: string, canFreeze: boolean): { current: number; longest: number; at_risk: boolean; freeze_available: boolean; studied_today: boolean } {
  const freeze_available = canFreeze && freezeReady(s, today);
  if (!s?.lastActiveDate) return { current: 0, longest: s?.longestStreak ?? 0, at_risk: false, freeze_available, studied_today: false };
  const gap = daysBetween(s.lastActiveDate, today);
  if (gap <= 0) return { current: s.currentStreak, longest: s.longestStreak, at_risk: false, freeze_available, studied_today: true };
  if (gap === 1) return { current: s.currentStreak, longest: s.longestStreak, at_risk: s.currentStreak > 0, freeze_available, studied_today: false };
  if (gap === 2 && freeze_available && s.currentStreak > 0) return { current: s.currentStreak, longest: s.longestStreak, at_risk: true, freeze_available, studied_today: false };
  return { current: 0, longest: s.longestStreak, at_risk: false, freeze_available, studied_today: false };
}

// ----------------------------------------------------------------------------- huy hiệu

/** Dữ kiện cho rule engine (learning tính từ test-engine + streak) */
export interface BadgeFacts {
  attempts_graded: number;
  full_tests_graded: number;
  answered_total: number;
  longest_streak: number;
  current_streak: number;
  /** Điểm cao nhất − điểm đầu tiên (bài exam/diagnostic có thang điểm) */
  score_delta: number;
}

/** Dạng rule seed (learn.badges.rule): {event, count, kind?} | {streak} | {answered} | {score_delta} */
export type BadgeRule = { event?: string; count?: number; kind?: string; streak?: number; answered?: number; score_delta?: number };

/** Đánh giá một rule: đạt chưa + tiến độ (null = rule không hiểu → không bao giờ trao) */
export function evaluateBadgeRule(rule: BadgeRule, f: BadgeFacts): { earned: boolean; progress: { current: number; target: number } | null } {
  const mk = (current: number, target: number) => ({ earned: target > 0 && current >= target, progress: { current: Math.min(current, target), target } });
  if (typeof rule.streak === 'number') return mk(Math.max(f.longest_streak, f.current_streak), rule.streak);
  if (typeof rule.answered === 'number') return mk(f.answered_total, rule.answered);
  if (typeof rule.score_delta === 'number') return mk(Math.max(0, f.score_delta), rule.score_delta);
  if (rule.event === 'attempt.graded' && typeof rule.count === 'number') return mk(rule.kind === 'full' ? f.full_tests_graded : f.attempts_graded, rule.count);
  return { earned: false, progress: null };
}
