/**
 * @allingo/scoring – quy đổi điểm. Mọi bảng quy đổi là ƯỚC TÍNH của Allingo (không phải bảng chính thức
 * của ETS/IELTS), UI phải ghi rõ "ước tính". Nguồn quy tắc: docs/spec/allingo-prompts.yaml#scoring_rules.
 */

export type ToeicSkill = 'listening' | 'reading';

/**
 * Bảng quy đổi TOEIC Listening/Reading: raw (0–100) → scaled (5–495), tuyến tính từng đoạn.
 * Các mốc được chọn để phản ánh đường cong quen thuộc (điểm thấp quy đổi "hào phóng", điểm cao sát trần).
 */
const TOEIC_ANCHORS: Record<ToeicSkill, ReadonlyArray<readonly [raw: number, scaled: number]>> = {
  listening: [
    [0, 5],
    [10, 35],
    [20, 95],
    [30, 160],
    [40, 220],
    [50, 275],
    [60, 325],
    [70, 370],
    [80, 420],
    [90, 465],
    [96, 490],
    [100, 495],
  ],
  reading: [
    [0, 5],
    [10, 30],
    [20, 80],
    [30, 135],
    [40, 185],
    [50, 235],
    [60, 290],
    [70, 345],
    [80, 400],
    [90, 450],
    [96, 480],
    [100, 495],
  ],
};

const interpolate = (anchors: ReadonlyArray<readonly [number, number]>, x: number): number => {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1]!;
    const [x1, y1] = anchors[i]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
};

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Quy đổi điểm thô TOEIC một kỹ năng (correct/total, mặc định total 100) → thang 5–495 (bước 5). */
export function toeicScaled(skill: ToeicSkill, correct: number, total = 100): number {
  if (total <= 0) return 5;
  const raw100 = Math.max(0, Math.min(100, (correct / total) * 100));
  return Math.max(5, Math.min(495, roundTo(interpolate(TOEIC_ANCHORS[skill], raw100), 5)));
}

export interface ToeicLrResult {
  listening: number | null;
  reading: number | null;
  total: number | null;
  /** Khoảng tin cậy ±25 mỗi kỹ năng (ước tính) */
  ci: number;
}

/** Tổng hợp L&R; thiếu một kỹ năng → total null */
export function toeicLr(parts: { listening?: { correct: number; total: number }; reading?: { correct: number; total: number } }): ToeicLrResult {
  const listening = parts.listening && parts.listening.total > 0 ? toeicScaled('listening', parts.listening.correct, parts.listening.total) : null;
  const reading = parts.reading && parts.reading.total > 0 ? toeicScaled('reading', parts.reading.correct, parts.reading.total) : null;
  const total = listening !== null && reading !== null ? listening + reading : null;
  return { listening, reading, total, ci: 25 };
}

/** TOEIC Part → kỹ năng */
export const TOEIC_PART_SKILL: Record<string, ToeicSkill> = {
  part1: 'listening',
  part2: 'listening',
  part3: 'listening',
  part4: 'listening',
  part5: 'reading',
  part6: 'reading',
  part7: 'reading',
};

/** TOEIC Speaking/Writing: raw → scaled 0–200 (bước 10). raw_max: Speaking 35, Writing 28 */
export function toeicSwScaled(kind: 'speaking' | 'writing', raw: number): number {
  const max = kind === 'speaking' ? 35 : 28;
  const r = Math.max(0, Math.min(max, raw));
  return Math.round((r / max) * 200 / 10) * 10;
}

/** Làm tròn band IELTS tổng thể từ trung bình 4 tiêu chí: .25 → .5; .75 → số nguyên kế tiếp; còn lại về 0.5 gần nhất */
export function ieltsRoundOverall(mean: number): number {
  const base = Math.floor(mean);
  const frac = Math.round((mean - base) * 100) / 100;
  if (frac < 0.25) return base;
  if (frac < 0.75) return base + 0.5;
  return base + 1;
}

export function ieltsOverall(criteria: { task: number; coherence_cohesion: number; lexical_resource: number; grammatical_range_accuracy: number }): number {
  const mean = (criteria.task + criteria.coherence_cohesion + criteria.lexical_resource + criteria.grammatical_range_accuracy) / 4;
  return Math.min(9, Math.max(0, ieltsRoundOverall(mean)));
}

/** Azure Pronunciation Assessment → band Pronunciation IELTS (bảng tạm cho PoC, hiệu chỉnh ở GĐ2) */
export function paToIeltsBand(pa: { accuracy: number; fluency: number; prosody: number }): { pa_score: number; band: number } {
  const pa_score = 0.5 * pa.accuracy + 0.25 * pa.fluency + 0.25 * pa.prosody;
  let band: number;
  if (pa_score >= 92) band = 8.0;
  else if (pa_score >= 88 && pa.prosody >= 85) band = 7.5;
  else if (pa_score >= 85) band = 7.0;
  else if (pa_score >= 80 && pa.accuracy >= 85) band = 6.5;
  else if (pa_score >= 75) band = 6.0;
  else if (pa_score >= 70 && pa.fluency >= 75) band = 5.5;
  else if (pa_score >= 65) band = 5.0;
  else if (pa_score >= 55) band = 4.0;
  else band = 3.5;
  return { pa_score: Math.round(pa_score * 10) / 10, band };
}

/** Quy đổi theo chương trình cho attempt: trả scaled + mô tả thang */
export interface ScaleInfo {
  program: string;
  unit: string;
  min: number;
  max: number;
  estimated: true;
  note: { vi: string; en: string };
}

export const SCALE_INFO: Record<'toeic' | 'ielts' | 'jlpt' | 'hsk', ScaleInfo> = {
  toeic: { program: 'toeic', unit: 'points', min: 10, max: 990, estimated: true, note: { vi: 'Điểm quy đổi là ước tính của Allingo, không phải bảng chính thức.', en: 'Scaled score is an Allingo estimate, not an official table.' } },
  ielts: { program: 'ielts', unit: 'band', min: 0, max: 9, estimated: true, note: { vi: 'Band ước tính.', en: 'Estimated band.' } },
  jlpt: { program: 'jlpt', unit: 'points', min: 0, max: 180, estimated: true, note: { vi: 'Điểm ước tính.', en: 'Estimated score.' } },
  hsk: { program: 'hsk', unit: 'points', min: 0, max: 300, estimated: true, note: { vi: 'Điểm ước tính.', en: 'Estimated score.' } },
};

/** Ước tính band IELTS Listening/Reading (Academic) từ số câu đúng /40 – bảng xấp xỉ công khai phổ biến */
export function ieltsLrBand(correct: number, total = 40): number {
  const c = Math.round((correct / total) * 40);
  const table: ReadonlyArray<readonly [number, number]> = [
    [39, 9],
    [37, 8.5],
    [35, 8],
    [32, 7.5],
    [30, 7],
    [26, 6.5],
    [23, 6],
    [18, 5.5],
    [16, 5],
    [13, 4.5],
    [10, 4],
    [8, 3.5],
    [6, 3],
    [4, 2.5],
    [0, 0],
  ];
  for (const [min, band] of table) if (c >= min) return band;
  return 0;
}
