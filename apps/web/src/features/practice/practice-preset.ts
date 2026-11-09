import { autoSectionCodes, DEFAULT_PROGRAM } from '@allingo/schemas/program/registry';

export const PRACTICE_SECTIONS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] as const;
/** C1: mã phần thi luyện tập – theo registry của chương trình (TOEIC Part 1–7, IELTS listening_p1…reading_p3) */
export type PracticeSection = string;

/** Phần thi luyện tập (tự chấm) của chương trình */
export function practiceSectionsFor(program: string): string[] {
  return autoSectionCodes(program);
}

/** Phần mặc định khi mở trang: TOEIC Part 5 (như GĐ1), chương trình khác → phần Reading đầu tiên */
export function defaultPracticeSection(program: string): string {
  const all = practiceSectionsFor(program);
  if (program === DEFAULT_PROGRAM && all.includes('part5')) return 'part5';
  return all.find((c) => c.startsWith('reading')) ?? all[0] ?? 'part5';
}

const CODE_RE = /^[a-z0-9_:-]{1,64}$/;

export interface PracticePreset {
  section: PracticeSection | null;
  subskill: string | null;
  topic: string | null;
}

/** Tham số chọn sẵn từ URL (gợi ý luyện ở màn Kết quả): ?section=part5&subskill=verb_tense&topic=office – giá trị lạ bị bỏ */
export function practicePresetFrom(params: Pick<URLSearchParams, 'get'> | null | undefined, program: string = DEFAULT_PROGRAM): PracticePreset {
  const isSection = (v: string | null): v is PracticeSection => !!v && practiceSectionsFor(program).includes(v);
  const section = params?.get('section') ?? null;
  const subskill = params?.get('subskill') ?? null;
  const topic = params?.get('topic') ?? null;
  return {
    section: isSection(section) ? section : null,
    subskill: subskill && CODE_RE.test(subskill) ? subskill : null,
    topic: topic && CODE_RE.test(topic) ? topic : null,
  };
}
