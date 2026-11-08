import { WEEKDAY_CODES, type PlanWeek, type StudyPlan } from '@allingo/schemas/api/learning-plan';
import { levelForXp } from '@allingo/schemas/product/xp';

/**
 * Định dạng tiến độ / dự báo / ngày của lộ trình (thuần, có test). Ngày lộ trình là ngày LỊCH của người học (YYYY-MM-DD) – luôn
 * định dạng với timeZone UTC để không lệch ngày theo múi giờ máy.
 */

export type Tone = 'success' | 'gold' | 'destructive' | 'muted' | 'primary';
export type Forecast = StudyPlan['progress']['forecast'];

/** % hiển thị: số nguyên trong [0, 100] (API trả 1 chữ số thập phân) */
export function pct(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const FORECAST_TONE: Record<Forecast, Tone> = { on_track: 'success', slightly_behind: 'gold', behind: 'destructive', not_started: 'muted' };
export function forecastTone(f: string | null | undefined): Tone {
  return f ? (FORECAST_TONE[f as Forecast] ?? 'muted') : 'muted';
}

/** Thanh tiến độ tới ngày thi: không có ngày thi → null; còn 0 ngày → "hôm nay" */
export function examCountdown(p: Pick<StudyPlan['progress'], 'exam_pct' | 'days_to_exam'>): { pct: number; daysLeft: number; when: 'today' | 'days' } | null {
  if (p.days_to_exam === null || p.days_to_exam === undefined) return null;
  return { pct: pct(p.exam_pct ?? 0), daysLeft: Math.max(0, p.days_to_exam), when: p.days_to_exam <= 0 ? 'today' : 'days' };
}

/** Tải tuần so ngân sách (phút) – `over` khi tải vượt ngân sách (sau đổi ngày/áp dụng đề xuất server vẫn giữ ≤ ngân sách) */
export function loadView(week: Pick<PlanWeek, 'load_minutes' | 'budget_minutes'>): { load: number; budget: number; pct: number; over: boolean } {
  const budget = Math.max(0, week.budget_minutes);
  const load = Math.max(0, week.load_minutes);
  return { load, budget, pct: budget ? pct((load / budget) * 100) : 0, over: budget > 0 && load > budget };
}

/** Cấp độ XP (bảng chung `levelForXp` của @allingo/schemas): tiến độ trong cấp hiện tại */
export function xpLevelView(total: number, apiLevel?: number, apiNextAt?: number): { level: number; floor: number; next: number; pct: number; toNext: number } {
  const l = levelForXp(total);
  const level = apiLevel ?? l.level;
  const next = apiNextAt ?? l.next_at;
  const floor = apiLevel && apiLevel !== l.level ? 50 * (level - 1) * level : l.current_floor;
  const span = Math.max(1, next - floor);
  return { level, floor, next, pct: pct(((total - floor) / span) * 100), toNext: Math.max(0, next - total) };
}

const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const intlLocale = (locale: string) => (locale === 'vi' ? 'vi-VN' : 'en-GB');

/** "Th 2, 03/11" / "Mon 03 Nov" – ngày lịch (UTC) */
export function formatDay(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit' }): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone: 'UTC' }).format(dateOf(iso));
}

/** "03/11" – ngày/tháng dạng số (vi và en-GB cùng thứ tự; ICU của Node/trình duyệt khác nhau dấu phân cách nên tự ghép) */
export function formatDayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** Khoảng ngày của tuần: "02/11 – 08/11" (locale giữ cho chữ ký thống nhất – thứ tự ngày/tháng như nhau ở vi/en-GB) */
export function formatRange(start: string, end: string, _locale?: string): string {
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** Mã thứ (mon..sun) của ngày lịch */
export function weekdayOf(iso: string): (typeof WEEKDAY_CODES)[number] {
  const d = dateOf(iso).getUTCDay(); // 0 = CN
  return WEEKDAY_CODES[(d + 6) % 7]!;
}

/** Cộng ngày cho ngày lịch YYYY-MM-DD */
export function addDaysIso(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Hôm nay theo một múi giờ IANA (dự phòng khi chưa có GET /me/plan/today) */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Tuần hiện tại (1-based `week_current` của API → phần tử), dự phòng tuần chứa hôm nay */
export function currentWeek(plan: Pick<StudyPlan, 'weeks' | 'week_current'>, today: string): PlanWeek | null {
  if (plan.week_current) return plan.weeks.find((w) => w.week_no === plan.week_current) ?? null;
  return plan.weeks.find((w) => today >= w.start_date && today <= w.end_date) ?? plan.weeks[0] ?? null;
}

/** Tuần có bài thi đầy đủ (full_test) – hiển thị huy hiệu "Thi thử" trên chip tuần */
export function weekHasFullTest(week: Pick<PlanWeek, 'days'>): boolean {
  return week.days.some((d) => d.tasks.some((t) => t.task_type === 'full_test'));
}
