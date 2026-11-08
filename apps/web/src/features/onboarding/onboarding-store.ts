import { WEEKDAY_CODES, type PlanCreateInput } from '@allingo/schemas/api/learning-plan';

/**
 * Nháp onboarding 4 bước (S9): chương trình → mục tiêu + ngày thi → giờ học/tuần + ngày học + giờ nhắc + múi giờ → chẩn đoán →
 * tạo lộ trình. Lưu `localStorage` `allingo.onboarding.v1` để đi sang màn chẩn đoán rồi quay lại (tải lại/đóng tab vẫn giữ).
 * Chỉ là tiện ích của người xem – server lưu enrollment khi bắt đầu chẩn đoán và lộ trình khi bấm "Tạo lộ trình".
 */

export type Weekday = (typeof WEEKDAY_CODES)[number];
export type OnboardingStep = 1 | 2 | 3 | 4;

export interface OnboardingDraft {
  v: 1;
  step: OnboardingStep;
  program: string;
  target_score: number | null;
  exam_date: string | null;
  weekly_minutes: number;
  study_days: Weekday[];
  reminder_time: string | null;
  timezone: string;
}

const KEY = 'allingo.onboarding.v1';
export const TARGET_PRESETS = [450, 550, 650, 750, 850] as const;
export const WEEKLY_PRESETS = [120, 180, 300, 420, 600] as const;
export const WEEKLY_MIN = 60;
export const WEEKLY_MAX = 2100;
/** Ngày thi tối đa sau hôm nay (như API: 2 năm) */
export const EXAM_MAX_DAYS = 730;

/** Tên IANA cũ mà ICU của trình duyệt còn trả (Chrome: Asia/Saigon) → tên chuẩn hiện hành */
const TZ_ALIASES: Record<string, string> = { 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Rangoon': 'Asia/Yangon', 'Asia/Katmandu': 'Asia/Kathmandu', 'Europe/Kiev': 'Europe/Kyiv' };
export const canonicalTimeZone = (tz: string): string => TZ_ALIASES[tz] ?? tz;

export function browserTimeZone(): string {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh');
  } catch {
    return 'Asia/Ho_Chi_Minh';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function defaultDraft(timezone: string = browserTimeZone()): OnboardingDraft {
  return { v: 1, step: 1, program: 'toeic', target_score: 650, exam_date: null, weekly_minutes: 300, study_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], reminder_time: '19:00', timezone };
}

export function loadDraft(): OnboardingDraft | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (d?.v !== 1) return null;
    const base = defaultDraft();
    return {
      ...base,
      ...d,
      study_days: Array.isArray(d.study_days) ? d.study_days.filter((x): x is Weekday => (WEEKDAY_CODES as readonly string[]).includes(x)) : base.study_days,
      step: ([1, 2, 3, 4] as const).includes(d.step as OnboardingStep) ? (d.step as OnboardingStep) : 1,
    };
  } catch {
    return null;
  }
}

export function saveDraft(d: OnboardingDraft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage bị chặn → chỉ giữ trong bộ nhớ */
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export type StepErrors = Partial<Record<'target_score' | 'exam_date' | 'weekly_minutes' | 'study_days' | 'reminder_time' | 'timezone', 'required' | 'range' | 'past' | 'tooFar' | 'invalid'>>;

/** Kiểm tra từng bước như API (POST /me/plan: 60–2100 phút, ngày học ≥ 1 không trùng, ngày thi sau hôm nay ≤ 2 năm, IANA hợp lệ) */
export function validateStep(d: OnboardingDraft, step: OnboardingStep, today: string): StepErrors {
  const e: StepErrors = {};
  if (step === 2) {
    if (d.target_score !== null && (!Number.isFinite(d.target_score) || d.target_score < 10 || d.target_score > 990)) e.target_score = 'range';
    if (d.exam_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.exam_date) || Number.isNaN(Date.parse(d.exam_date))) e.exam_date = 'invalid';
      else if (d.exam_date <= today) e.exam_date = 'past';
      else if (daysBetween(today, d.exam_date) > EXAM_MAX_DAYS) e.exam_date = 'tooFar';
    }
  }
  if (step === 3) {
    if (!Number.isInteger(d.weekly_minutes) || d.weekly_minutes < WEEKLY_MIN || d.weekly_minutes > WEEKLY_MAX) e.weekly_minutes = 'range';
    if (!d.study_days.length) e.study_days = 'required';
    if (d.reminder_time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.reminder_time)) e.reminder_time = 'invalid';
    if (!isValidTimeZone(d.timezone)) e.timezone = 'invalid';
  }
  return e;
}

/** Phút/ngày ghi vào enrollment (như API: phút/tuần ÷ số ngày học, 10–240) */
export function dailyMinutes(d: Pick<OnboardingDraft, 'weekly_minutes' | 'study_days'>): number {
  return Math.max(10, Math.min(240, Math.round(d.weekly_minutes / Math.max(1, d.study_days.length))));
}

/** Thân POST /me/plan; `target` ghi đè mục tiêu (chọn gợi ý khả thi sau chẩn đoán) */
export function toPlanInput(d: OnboardingDraft, target?: number | null): PlanCreateInput {
  const score = target !== undefined ? target : d.target_score;
  const days = WEEKDAY_CODES.filter((x) => d.study_days.includes(x));
  return {
    program: d.program as PlanCreateInput['program'],
    ...(score !== null && score !== undefined ? { target_score: score } : {}),
    ...(d.exam_date ? { exam_date: d.exam_date } : {}),
    weekly_minutes: d.weekly_minutes,
    study_days: days,
    reminder_time: d.reminder_time,
    timezone: d.timezone,
  };
}

/** Danh sách múi giờ gợi ý (người học Việt Nam ở trong/ngoài nước) + múi giờ trình duyệt */
export function timeZoneOptions(current: string): string[] {
  const common = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];
  return [...new Set([canonicalTimeZone(current), browserTimeZone(), ...common])].filter(isValidTimeZone);
}
