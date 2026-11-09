import { ieltsListeningBand, ieltsReadingBand, ieltsRoundOverall, SCALE_INFO, toeicLrEstimate, type IeltsModule, type ScoreRange, type ToeicLrEstimate } from './index.js';
import { suggestToeicTarget, type TargetSuggestion } from './adaptive-diagnostic.js';

/**
 * C1 – quy đổi điểm theo chương trình (ADR-0038): test engine/thống kê gọi một hàm chung thay cho nhánh `program === 'toeic'`.
 * Mọi thang là ƯỚC TÍNH của Allingo (không phải bảng chính thức ETS/IELTS/JLPT/HSK) – giao diện luôn ghi "ước tính".
 *  - toeic_lr: Part → Listening/Reading, mỗi kỹ năng 5–495, tổng 10–990 khi đủ hai kỹ năng (giữ nguyên hành vi S4).
 *  - band (IELTS – sẵn cho C3): band Listening/Reading từ số câu đúng quy về /40 (`ieltsListeningBand`/`ieltsReadingBand` – Reading tách Academic/GT), overall (C3: chỉ khi đủ 4 kỹ năng) = trung bình band các kỹ
 *    năng có mặt làm tròn theo quy tắc .25/.75 (`ieltsRoundOverall`); thiếu kỹ năng → `partial: true`.
 *  - points (JLPT/HSK – GĐ3): chỉ khai báo thang, chưa quy đổi (`value = null`).
 */

export type ScaleKind = 'toeic_lr' | 'band' | 'points';

export interface SectionMarks {
  /** Số câu hỏi đúng (IELTS: theo mục đánh số – markCount) */
  marks: number;
  max_marks: number;
}

export interface ProgramScoreInput {
  program: string;
  kind: ScaleKind;
  /** Điểm thô theo phần thi */
  bySection: Readonly<Record<string, SectionMarks>>;
  /** Phần thi → kỹ năng (registry chương trình; null → bỏ qua khi quy đổi) */
  skillOf: (sectionCode: string) => string | null;
  /** C3 – IELTS: hình thức Reading (catalog.test_sets.level); thiếu → academic */
  module?: IeltsModule | null;
}

export interface SkillScore {
  scaled: number | null;
  range: ScoreRange | null;
}

export interface ProgramScore {
  /** learn.attempts.scaled_score (TOEIC: tổng hoặc kỹ năng có mặt; IELTS: overall/band kỹ năng duy nhất) */
  value: number | null;
  /** AttemptResult.scale – thang + điểm thành phần */
  scale: Record<string, unknown>;
  /** TOEIC L&R (AttemptResult.scaled) – null với chương trình khác */
  toeic: ToeicLrEstimate | null;
  /** Điểm quy đổi từng kỹ năng (by_skill.*.scaled / range) */
  skills: Record<string, SkillScore>;
  /** Điểm quy đổi gắn cho từng phần thi (by_section.*.score – TOEIC: điểm kỹ năng của Part) */
  sections: Record<string, number | null>;
}

function aggregate(input: ProgramScoreInput): Map<string, SectionMarks> {
  const agg = new Map<string, SectionMarks>();
  for (const [code, s] of Object.entries(input.bySection)) {
    const skill = input.skillOf(code);
    if (!skill) continue;
    const a = agg.get(skill) ?? { marks: 0, max_marks: 0 };
    a.marks += s.marks;
    a.max_marks += s.max_marks;
    agg.set(skill, a);
  }
  return agg;
}

const IELTS_SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const;

export function scoreByProgram(input: ProgramScoreInput): ProgramScore {
  const agg = aggregate(input);
  const sections: Record<string, number | null> = Object.fromEntries(Object.keys(input.bySection).map((c) => [c, null]));
  if (input.kind === 'toeic_lr') {
    const part = (skill: 'listening' | 'reading') => {
      const a = agg.get(skill);
      return a && a.max_marks > 0 ? { correct: a.marks, total: a.max_marks } : undefined;
    };
    const r = toeicLrEstimate({ listening: part('listening'), reading: part('reading') });
    for (const code of Object.keys(input.bySection)) {
      const skill = input.skillOf(code);
      if (skill === 'listening' || skill === 'reading') sections[code] = r[skill];
    }
    const skills: Record<string, SkillScore> = {
      listening: { scaled: r.listening, range: r.ranges.listening },
      reading: { scaled: r.reading, range: r.ranges.reading },
    };
    const value = r.total ?? r.listening ?? r.reading;
    const hasAny = r.listening !== null || r.reading !== null;
    return {
      value,
      scale: { ...SCALE_INFO.toeic, listening: r.listening, reading: r.reading, total: r.total, ci: r.half_width, range: r.range, partial: r.total === null },
      toeic: hasAny ? r : null,
      skills,
      sections,
    };
  }
  if (input.kind === 'band') {
    const bands: Record<string, number> = {};
    const skills: Record<string, SkillScore> = {};
    const module: IeltsModule = input.module === 'general_training' ? 'general_training' : 'academic';
    for (const skill of ['listening', 'reading'] as const) {
      const a = agg.get(skill);
      if (!a || a.max_marks <= 0) continue;
      bands[skill] = skill === 'reading' ? ieltsReadingBand(a.marks, a.max_marks, module) : ieltsListeningBand(a.marks, a.max_marks);
      skills[skill] = { scaled: bands[skill], range: null };
    }
    for (const code of Object.keys(input.bySection)) {
      const skill = input.skillOf(code);
      if (skill && bands[skill] !== undefined) sections[code] = bands[skill]!;
    }
    const present = Object.values(bands);
    // C3: overall chỉ tính khi đủ 4 kỹ năng; bài một kỹ năng → band kỹ năng đó; bài 2–3 kỹ năng → không có điểm tổng (null)
    const complete = IELTS_SKILLS.every((s) => bands[s] !== undefined);
    const overall = complete ? Math.min(9, Math.max(0, ieltsRoundOverall(present.reduce((x, y) => x + y, 0) / present.length))) : null;
    const value = complete ? overall : present.length === 1 ? present[0]! : null;
    const raw = Object.fromEntries([...agg.entries()].map(([k, v]) => [k, { correct: v.marks, total: v.max_marks }]));
    return {
      value,
      scale: { ...SCALE_INFO.ielts, band: overall, bands, raw, module: bands.reading !== undefined ? module : null, partial: !complete },
      toeic: null,
      skills,
      sections,
    };
  }
  const info = SCALE_INFO[input.program as keyof typeof SCALE_INFO];
  return { value: null, scale: info ? { ...info, implemented: false } : { program: input.program, implemented: false }, toeic: null, skills: {}, sections };
}

/**
 * Gợi ý mục tiêu khả thi theo chương trình: TOEIC dùng mô phỏng tốc độ tăng điểm (S9); band IELTS (C3) dùng mô hình đơn giản
 * `suggestBandTarget`; chương trình khác chưa có mô hình → null (giao diện giữ mục tiêu người học nhập).
 */
export function suggestTargetFor(kind: ScaleKind, input: Parameters<typeof suggestToeicTarget>[0]): TargetSuggestion | null {
  if (kind === 'toeic_lr') return suggestToeicTarget(input);
  if (kind === 'band') return suggestBandTarget(input);
  return null;
}

/** Band tăng mỗi giờ học (ƯỚC TÍNH Allingo: ≈ +0,5 band sau ~55 giờ ở band 5–6), giảm dần khi band cao; tỷ lệ tuân thủ kế hoạch 80 % */
const BAND_GAIN_PER_HOUR = 0.009;
const BAND_ADHERENCE = 0.8;
const BAND_DEFAULT_WEEKS = 12;
const floorHalf = (x: number) => Math.floor(x * 2 + 1e-9) / 2;

function projectBand(current: number, weeks: number, weeklyMinutes: number): number {
  let b = current;
  for (let w = 0; w < weeks; w++) b = Math.min(9, b + (weeklyMinutes / 60) * BAND_ADHERENCE * BAND_GAIN_PER_HOUR * Math.min(1, Math.max(0.25, (9 - b) / 3)));
  return b;
}

/**
 * C3 – gợi ý band mục tiêu IELTS từ band hiện tại, số tuần đến ngày thi (không có → 12 tuần) và phút học/tuần; làm tròn xuống 0,5.
 * `required_weekly_minutes` = phút/tuần tối thiểu để đạt `desired` (≤ 35 giờ/tuần), giống TOEIC.
 */
export function suggestBandTarget(input: { current: number; today: string; examDate: string | null; weeklyMinutes: number; desired?: number | null }): TargetSuggestion {
  const days = input.examDate ? Math.round((Date.parse(`${input.examDate}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) / 86_400_000) : null;
  const weeks = days !== null ? Math.max(0, Math.floor(days / 7)) : BAND_DEFAULT_WEEKS;
  const current = Math.min(9, Math.max(0, input.current));
  const suggested = Math.min(9, Math.max(floorHalf(current), floorHalf(projectBand(current, weeks, input.weeklyMinutes))));
  const desired = input.desired ?? null;
  let feasible: boolean | null = null;
  let required: number | null = null;
  let reason: TargetSuggestion['reason'] = input.examDate ? 'no_target' : 'no_exam_date';
  if (desired !== null) {
    feasible = desired <= suggested;
    if (feasible) reason = 'feasible';
    else {
      for (let m = input.weeklyMinutes + 30; m <= 2100; m += 30) {
        if (floorHalf(projectBand(current, weeks, m)) >= desired) {
          required = m;
          break;
        }
      }
      reason = required !== null ? 'stretch' : 'unreachable';
    }
  }
  return { current, suggested, desired, feasible, weeks_left: weeks, weekly_minutes: input.weeklyMinutes, required_weekly_minutes: required, reason };
}

/** Ước tính band một kỹ năng từ bài chẩn đoán ngắn: band ± khoảng (ít câu → rộng hơn) */
export interface BandEstimate {
  score: number;
  low: number;
  high: number;
}

/**
 * C3/A253 – ước tính band IELTS từ bài chẩn đoán ngắn (registry `diagnostic = generic`): tỷ lệ câu đúng từng kỹ năng quy về /40
 * rồi tra bảng (Listening; Reading theo module); khoảng ±0,5 khi ≥ 10 câu đã làm của kỹ năng, ±1 khi ít hơn. Không có overall
 * (overall IELTS cần đủ 4 kỹ năng) – `current` cho gợi ý mục tiêu = trung bình band L/R làm tròn .25/.75.
 */
export function estimateIeltsDiagnostic(served: ReadonlyArray<{ skill: string; correct: boolean | null }>, module: IeltsModule = 'academic'): { listening: BandEstimate | null; reading: BandEstimate | null; current: number | null; answered: number } {
  const est = (skill: 'listening' | 'reading'): BandEstimate | null => {
    const done = served.filter((s) => s.skill === skill && s.correct !== null);
    if (!done.length) return null;
    const correct = done.filter((s) => s.correct).length;
    const score = skill === 'reading' ? ieltsReadingBand(correct, done.length, module) : ieltsListeningBand(correct, done.length);
    const w = done.length >= 10 ? 0.5 : 1;
    return { score, low: Math.max(0, score - w), high: Math.min(9, score + w) };
  };
  const listening = est('listening');
  const reading = est('reading');
  const present = [listening, reading].filter((x): x is BandEstimate => x !== null).map((x) => x.score);
  return { listening, reading, current: present.length ? ieltsRoundOverall(present.reduce((a, b) => a + b, 0) / present.length) : null, answered: served.filter((s) => s.correct !== null).length };
}

/**
 * Nhóm mục tiêu ẩn danh cho thống kê "người cùng mục tiêu" (percentile): TOEIC theo trăm ("600-695"), band theo 0,5 ("6.5"),
 * thang điểm khác theo chục.
 */
export function targetBucketFor(kind: ScaleKind, target: number | null): { label: string; lo: number; hi: number } | null {
  if (target === null || !Number.isFinite(target)) return null;
  if (kind === 'band') {
    const lo = Math.floor(target * 2) / 2;
    return { label: lo.toFixed(1), lo, hi: lo + 0.5 };
  }
  const step = kind === 'toeic_lr' ? 100 : 10;
  const lo = Math.floor(target / step) * step;
  return { label: `${lo}-${lo + step - (kind === 'toeic_lr' ? 5 : 1)}`, lo, hi: lo + step };
}
