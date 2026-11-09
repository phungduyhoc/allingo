import { ieltsLrBand, ieltsRoundOverall, SCALE_INFO, toeicLrEstimate, type ScoreRange, type ToeicLrEstimate } from './index.js';
import { suggestToeicTarget, type TargetSuggestion } from './adaptive-diagnostic.js';

/**
 * C1 – quy đổi điểm theo chương trình (ADR-0038): test engine/thống kê gọi một hàm chung thay cho nhánh `program === 'toeic'`.
 * Mọi thang là ƯỚC TÍNH của Allingo (không phải bảng chính thức ETS/IELTS/JLPT/HSK) – giao diện luôn ghi "ước tính".
 *  - toeic_lr: Part → Listening/Reading, mỗi kỹ năng 5–495, tổng 10–990 khi đủ hai kỹ năng (giữ nguyên hành vi S4).
 *  - band (IELTS – sẵn cho C3): band Listening/Reading từ số câu đúng quy về /40 (`ieltsLrBand`), overall = trung bình band các kỹ
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
    for (const skill of ['listening', 'reading'] as const) {
      const a = agg.get(skill);
      if (!a || a.max_marks <= 0) continue;
      bands[skill] = ieltsLrBand(a.marks, a.max_marks);
      skills[skill] = { scaled: bands[skill], range: null };
    }
    for (const code of Object.keys(input.bySection)) {
      const skill = input.skillOf(code);
      if (skill && bands[skill] !== undefined) sections[code] = bands[skill]!;
    }
    const present = Object.values(bands);
    const overall = present.length ? Math.min(9, Math.max(0, ieltsRoundOverall(present.reduce((x, y) => x + y, 0) / present.length))) : null;
    const raw = Object.fromEntries([...agg.entries()].map(([k, v]) => [k, { correct: v.marks, total: v.max_marks }]));
    return {
      value: overall,
      scale: { ...SCALE_INFO.ielts, band: overall, bands, raw, partial: IELTS_SKILLS.some((s) => bands[s] === undefined) },
      toeic: null,
      skills,
      sections,
    };
  }
  const info = SCALE_INFO[input.program as keyof typeof SCALE_INFO];
  return { value: null, scale: info ? { ...info, implemented: false } : { program: input.program, implemented: false }, toeic: null, skills: {}, sections };
}

/**
 * Gợi ý mục tiêu khả thi theo chương trình: TOEIC dùng mô phỏng tốc độ tăng điểm (S9); chương trình khác chưa có mô hình → null
 * (giao diện giữ mục tiêu người học nhập).
 */
export function suggestTargetFor(kind: ScaleKind, input: Parameters<typeof suggestToeicTarget>[0]): TargetSuggestion | null {
  return kind === 'toeic_lr' ? suggestToeicTarget(input) : null;
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
