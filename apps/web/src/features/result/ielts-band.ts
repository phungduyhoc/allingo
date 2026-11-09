/**
 * C3 – kết quả IELTS (thang band – `scale` của @allingo/scoring `scoreByProgram`): band từng kỹ năng 0–9 bước 0,5, overall chỉ khi
 * đủ 4 kỹ năng (`band` null khi thiếu), hình thức Reading (Academic/GT), số câu đúng theo mục (/40). Logic thuần để kiểm thử.
 */

export type IeltsModule = 'academic' | 'general_training';

export interface BandView {
  bands: { skill: string; band: number; correct: number | null; total: number | null }[];
  overall: number | null;
  module: IeltsModule | null;
}

const isBand = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 9 && Math.round(v * 2) === v * 2;
const SKILL_ORDER = ['listening', 'reading', 'writing', 'speaking'];

/** `scale` có unit = band → view; khác (TOEIC/JLPT) → null */
export function parseBandScale(scale: Record<string, unknown> | null | undefined): BandView | null {
  if (!scale || scale.unit !== 'band') return null;
  const rawBands = (scale.bands ?? {}) as Record<string, unknown>;
  const raw = (scale.raw ?? {}) as Record<string, { correct?: unknown; total?: unknown } | undefined>;
  const bands = Object.entries(rawBands)
    .filter((e): e is [string, number] => isBand(e[1]))
    .sort(([a], [b]) => (SKILL_ORDER.indexOf(a) + 1 || 99) - (SKILL_ORDER.indexOf(b) + 1 || 99))
    .map(([skill, band]) => {
      const r = raw[skill];
      return { skill, band, correct: typeof r?.correct === 'number' ? r.correct : null, total: typeof r?.total === 'number' ? r.total : null };
    });
  const readingModule = scale.module === 'academic' || scale.module === 'general_training' ? scale.module : null;
  return { bands, overall: isBand(scale.band) ? scale.band : null, module: readingModule };
}

/** Band hiển thị: luôn một chữ số thập phân ("6.5", "7.0") */
export function formatBand(band: number): string {
  return band.toFixed(1);
}

/** Số câu đúng theo mục (IELTS) – `marks/max_marks` của by_section; thiếu → số câu catalog */
export function marksTotal(bySection: Record<string, { correct: number; total: number; marks?: number; max_marks?: number }>): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const s of Object.values(bySection)) {
    correct += s.marks ?? s.correct;
    total += s.max_marks ?? s.total;
  }
  return { correct, total };
}
